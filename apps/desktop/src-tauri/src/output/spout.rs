// Spout2 の送り手の仕組み（Spout 2.007 以降の受け手と互換。SDK は使わず、同じ名前の共有のものを作る）。
//
// - 共有メモリ "SpoutSenderNames": 送り手の名前の一覧。256 バイトの枠が並び、空の枠で終わる（名前の昇順）。
//   枠の数の上限はレジストリ HKCU\Software\Leading Edge\Spout の MaxSenders（無ければ 64）
// - 共有メモリ "ActiveSenderName": いま選ばれている送り手の名前（256 バイト）
// - 共有メモリ「送り手の名前」: SharedTextureInfo（280 バイト）。共有テクスチャのハンドル（DXGI の共有ハンドル、32 ビット）、
//   幅・高さ・DXGI の形式・usage・説明（送り手の実行ファイルのパス）・partnerId
// - 共有メモリごとのミューテックス "<名前>_mutex"（読み書きの間だけ持つ）
// - 共有テクスチャのミューテックス "<送り手の名前>_SpoutAccessMutex"（テクスチャに書く間・受け手が読む間だけ持つ）
// - フレームの数のセマフォ "<送り手の名前>_Count_Semaphore"（送るたびに 1 増やす。受け手が新しいフレームかを見分ける）

use std::collections::BTreeSet;
use std::ffi::CString;
use windows::core::PCSTR;
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, ERROR_SUCCESS, HANDLE, INVALID_HANDLE_VALUE,
    WAIT_ABANDONED, WAIT_OBJECT_0,
};
use windows::Win32::System::LibraryLoader::GetModuleFileNameA;
use windows::Win32::System::Memory::{
    CreateFileMappingA, MapViewOfFile, OpenFileMappingA, UnmapViewOfFile, VirtualQuery,
    FILE_MAP_ALL_ACCESS, MEMORY_BASIC_INFORMATION, MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READWRITE,
};
use windows::Win32::System::Registry::{RegGetValueA, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
use windows::Win32::System::Threading::{
    CreateMutexA, CreateSemaphoreA, ReleaseMutex, ReleaseSemaphore, WaitForSingleObject,
};

pub const SENDER_NAME: &str = "2D Liver";
pub const NAME_LEN: usize = 256;
pub const SENDER_NAMES_MAP: &str = "SpoutSenderNames";
pub const ACTIVE_SENDER_MAP: &str = "ActiveSenderName";
pub const INFO_SIZE: usize = 280;
pub const DEFAULT_MAX_SENDERS: usize = 64;
pub const DXGI_FORMAT_B8G8R8A8_UNORM: u32 = 87;
const LOCK_TIMEOUT_MS: u32 = 67; // Spout と同じ（60fps の 4 フレーム）

// ---- 名前の一覧（共有メモリの中身。OS を使わないのでどこでもテストできる） ----

// 空の枠までの名前を読む
pub fn read_names(buf: &[u8], max: usize) -> Vec<Vec<u8>> {
    let mut names = Vec::new();
    for slot in buf.as_chunks::<NAME_LEN>().0.iter().take(max) {
        if slot[0] == 0 {
            break;
        }
        let len = slot[..NAME_LEN - 1]
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(NAME_LEN - 1);
        names.push(slot[..len].to_vec());
    }
    names
}

// 名前を昇順に書き、残りの枠を空にする
pub fn write_names(buf: &mut [u8], names: &BTreeSet<Vec<u8>>, max: usize) {
    let slots = (buf.len() / NAME_LEN).min(max);
    let mut i = 0;
    for name in names.iter().take(slots) {
        let slot = &mut buf[i * NAME_LEN..(i + 1) * NAME_LEN];
        slot.fill(0);
        let len = name.len().min(NAME_LEN - 1);
        slot[..len].copy_from_slice(&name[..len]);
        i += 1;
    }
    buf[i * NAME_LEN..slots * NAME_LEN].fill(0);
}

// ---- 送り手の情報（SharedTextureInfo） ----

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SenderInfo {
    pub share_handle: u32,
    pub width: u32,
    pub height: u32,
    pub format: u32,
    pub usage: u32,
    pub description: [u8; 256], // Spout 2.007 からは送り手の実行ファイルのパス（バイトの文字列）
    pub partner_id: u32,        // 0: GPU のテクスチャで共有する
}

impl SenderInfo {
    pub fn to_bytes(self) -> [u8; INFO_SIZE] {
        let mut b = [0u8; INFO_SIZE];
        b[0..4].copy_from_slice(&self.share_handle.to_le_bytes());
        b[4..8].copy_from_slice(&self.width.to_le_bytes());
        b[8..12].copy_from_slice(&self.height.to_le_bytes());
        b[12..16].copy_from_slice(&self.format.to_le_bytes());
        b[16..20].copy_from_slice(&self.usage.to_le_bytes());
        b[20..276].copy_from_slice(&self.description);
        b[276..280].copy_from_slice(&self.partner_id.to_le_bytes());
        b
    }

    #[cfg(test)]
    pub fn from_bytes(b: &[u8]) -> Option<Self> {
        if b.len() < INFO_SIZE {
            return None;
        }
        let u = |i: usize| u32::from_le_bytes([b[i], b[i + 1], b[i + 2], b[i + 3]]);
        let mut description = [0u8; 256];
        description.copy_from_slice(&b[20..276]);
        Some(Self {
            share_handle: u(0),
            width: u(4),
            height: u(8),
            format: u(12),
            usage: u(16),
            description,
            partner_id: u(276),
        })
    }
}

// ---- 名前つきの共有メモリ ----

fn cstring(name: &str) -> Result<CString, String> {
    if name.is_empty() || name.len() >= NAME_LEN {
        return Err(format!("名前の長さが合わない: {name}"));
    }
    CString::new(name).map_err(|_| format!("名前に NUL が入っている: {name}"))
}

fn pcstr(c: &CString) -> PCSTR {
    PCSTR(c.as_ptr().cast())
}

struct SharedMemory {
    map: HANDLE,
    view: MEMORY_MAPPED_VIEW_ADDRESS,
    len: usize,
    mutex: Option<HANDLE>,
}

struct Lock<'a> {
    memory: &'a SharedMemory,
    held: bool,
}

impl Lock<'_> {
    // ロックの中で中身を読み書きする
    #[allow(clippy::mut_from_ref)]
    fn bytes(&self) -> &mut [u8] {
        // SAFETY: view は len バイトの書き込める領域。ほかのプロセスとの順番は名前つきのミューテックスで守る
        unsafe {
            std::slice::from_raw_parts_mut(self.memory.view.Value.cast::<u8>(), self.memory.len)
        }
    }
}

impl Drop for Lock<'_> {
    fn drop(&mut self) {
        if let (true, Some(m)) = (self.held, self.memory.mutex) {
            unsafe {
                let _ = ReleaseMutex(m);
            }
        }
    }
}

impl SharedMemory {
    // 作る（すでにあれば開く）。2 つ目の値は、すでにあったか
    fn create(name: &str, size: usize) -> Result<(Self, bool), String> {
        let c = cstring(name)?;
        let map = unsafe {
            CreateFileMappingA(
                INVALID_HANDLE_VALUE,
                None,
                PAGE_READWRITE,
                0,
                size as u32,
                pcstr(&c),
            )
        }
        .map_err(|e| format!("共有メモリ {name} を作れない: {e}"))?;
        let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
        Ok((Self::map(map, name)?, existed))
    }

    fn open(name: &str) -> Option<Self> {
        let c = cstring(name).ok()?;
        let map = unsafe { OpenFileMappingA(FILE_MAP_ALL_ACCESS.0, false, pcstr(&c)) }.ok()?;
        Self::map(map, name).ok()
    }

    fn map(map: HANDLE, name: &str) -> Result<Self, String> {
        let view = unsafe { MapViewOfFile(map, FILE_MAP_ALL_ACCESS, 0, 0, 0) };
        if view.Value.is_null() {
            unsafe {
                let _ = CloseHandle(map);
            }
            return Err(format!("共有メモリ {name} を開けない"));
        }
        // 実際の大きさ（ほかのアプリが作ったものは、こちらの思う大きさと違うことがある）
        let mut info = MEMORY_BASIC_INFORMATION::default();
        let got = unsafe {
            VirtualQuery(
                Some(view.Value),
                &mut info,
                std::mem::size_of::<MEMORY_BASIC_INFORMATION>(),
            )
        };
        let len = if got == 0 { 0 } else { info.RegionSize };
        let mutex_name = CString::new(format!("{name}_mutex"))
            .map_err(|_| "名前に NUL が入っている".to_string())?;
        let mutex = unsafe { CreateMutexA(None, false, pcstr(&mutex_name)) }.ok();
        Ok(Self {
            map,
            view,
            len,
            mutex,
        })
    }

    // 少し待ってもロックできなければ、何度か試す。それでもだめならロックなしで進める（ほかのアプリが固まっている）
    fn lock(&self) -> Lock<'_> {
        let Some(m) = self.mutex else {
            return Lock {
                memory: self,
                held: false,
            };
        };
        for _ in 0..15 {
            let r = unsafe { WaitForSingleObject(m, LOCK_TIMEOUT_MS) };
            if r == WAIT_OBJECT_0 || r == WAIT_ABANDONED {
                return Lock {
                    memory: self,
                    held: true,
                };
            }
        }
        eprintln!("Spout の共有メモリのロックを取れないまま進める");
        Lock {
            memory: self,
            held: false,
        }
    }
}

impl Drop for SharedMemory {
    fn drop(&mut self) {
        unsafe {
            let _ = UnmapViewOfFile(self.view);
            let _ = CloseHandle(self.map);
            if let Some(m) = self.mutex {
                let _ = CloseHandle(m);
            }
        }
    }
}

fn max_senders() -> usize {
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    let r = unsafe {
        RegGetValueA(
            HKEY_CURRENT_USER,
            PCSTR(c"Software\\Leading Edge\\Spout".as_ptr().cast()),
            PCSTR(c"MaxSenders".as_ptr().cast()),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    if r == ERROR_SUCCESS && value > 0 {
        value as usize
    } else {
        DEFAULT_MAX_SENDERS
    }
}

fn executable_path() -> [u8; 256] {
    let mut buf = [0u8; 260];
    let n = unsafe { GetModuleFileNameA(None, &mut buf) } as usize;
    let mut out = [0u8; 256];
    let n = n.min(255);
    out[..n].copy_from_slice(&buf[..n]);
    out
}

fn sender_alive(name: &[u8]) -> bool {
    std::str::from_utf8(name)
        .ok()
        .and_then(SharedMemory::open)
        .is_some()
}

// ---- 送り手 ----

pub struct SpoutSender {
    name: String,
    names: SharedMemory, // 開いている間は一覧が消えないように持っておく
    active: SharedMemory,
    info: SharedMemory,
    access_mutex: HANDLE,
    frame_count: Option<HANDLE>,
}

// 共有テクスチャに書いている間だけ持つ。離すとミューテックスを返す
pub struct TextureAccess<'a> {
    sender: &'a SpoutSender,
}

impl Drop for TextureAccess<'_> {
    fn drop(&mut self) {
        unsafe {
            let _ = ReleaseMutex(self.sender.access_mutex);
        }
    }
}

impl SpoutSender {
    // base の名前で送り手を作る。同じ名前の送り手が動いていれば base_1、base_2… にする（Spout と同じ）
    pub fn create(
        base: &str,
        width: u32,
        height: u32,
        share_handle: u32,
        format: u32,
    ) -> Result<Self, String> {
        let wanted = max_senders();
        let (names, _) = SharedMemory::create(SENDER_NAMES_MAP, wanted * NAME_LEN)?;
        let max = wanted.min(names.len / NAME_LEN);
        let name = {
            let lock = names.lock();
            let buf = lock.bytes();
            let mut list: BTreeSet<Vec<u8>> = read_names(buf, max).into_iter().collect();
            let mut candidate = base.to_string();
            let mut i = 1;
            while list.contains(candidate.as_bytes()) && sender_alive(candidate.as_bytes()) {
                candidate = format!("{base}_{i}");
                i += 1;
            }
            cstring(&candidate)?;
            if !list.contains(candidate.as_bytes()) && list.len() >= max {
                return Err(format!("Spout の送り手の数が上限（{max}）に達している"));
            }
            list.insert(candidate.clone().into_bytes());
            write_names(buf, &list, max);
            candidate
        };
        let (active, _) = SharedMemory::create(ACTIVE_SENDER_MAP, NAME_LEN)?;
        let mut sender = match SharedMemory::create(&name, INFO_SIZE) {
            Ok((info, _)) => {
                let access_name =
                    CString::new(format!("{name}_SpoutAccessMutex")).unwrap_or_default();
                let access_mutex = unsafe { CreateMutexA(None, false, pcstr(&access_name)) };
                let count_name =
                    CString::new(format!("{name}_Count_Semaphore")).unwrap_or_default();
                let frame_count =
                    unsafe { CreateSemaphoreA(None, 1, i32::MAX, pcstr(&count_name)) }.ok();
                match access_mutex {
                    Ok(access_mutex) => Self {
                        name,
                        names,
                        active,
                        info,
                        access_mutex,
                        frame_count,
                    },
                    Err(e) => {
                        remove_name(&names, &active, &name);
                        return Err(format!("Spout のミューテックスを作れない: {e}"));
                    }
                }
            }
            Err(e) => {
                remove_name(&names, &active, &name);
                return Err(e);
            }
        };
        sender.update(width, height, share_handle, format);
        sender.set_active();
        Ok(sender)
    }

    pub fn name(&self) -> &str {
        &self.name
    }

    // 大きさや共有テクスチャが変わったら書き直す
    pub fn update(&mut self, width: u32, height: u32, share_handle: u32, format: u32) {
        let info = SenderInfo {
            share_handle,
            width,
            height,
            format,
            usage: 0,
            description: executable_path(),
            partner_id: 0,
        };
        let lock = self.info.lock();
        let buf = lock.bytes();
        if buf.len() >= INFO_SIZE {
            buf[..INFO_SIZE].copy_from_slice(&info.to_bytes());
        }
    }

    fn set_active(&self) {
        let lock = self.active.lock();
        let buf = lock.bytes();
        let n = self
            .name
            .len()
            .min(NAME_LEN - 1)
            .min(buf.len().saturating_sub(1));
        buf[..n].copy_from_slice(&self.name.as_bytes()[..n]);
        buf[n] = 0;
    }

    // 共有テクスチャに書く前に呼ぶ。受け手が読んでいて取れなければ None（このフレームは書かない）
    pub fn access_texture(&self) -> Option<TextureAccess<'_>> {
        let r = unsafe { WaitForSingleObject(self.access_mutex, LOCK_TIMEOUT_MS) };
        if r == WAIT_OBJECT_0 || r == WAIT_ABANDONED {
            Some(TextureAccess { sender: self })
        } else {
            None
        }
    }

    // 共有テクスチャに書き終えたら呼ぶ（フレームの数を 1 増やす）
    pub fn frame_sent(&self) {
        if let Some(s) = self.frame_count {
            unsafe {
                let _ = ReleaseSemaphore(s, 1, None);
            }
        }
    }
}

// 一覧から名前を消す。アクティブな送り手だったら、残りの最初の送り手にする（無ければ空にする）
fn remove_name(names: &SharedMemory, active: &SharedMemory, name: &str) {
    let remaining = {
        let lock = names.lock();
        let buf = lock.bytes();
        let max = buf.len() / NAME_LEN;
        let mut list: BTreeSet<Vec<u8>> = read_names(buf, max).into_iter().collect();
        list.remove(name.as_bytes());
        write_names(buf, &list, max);
        list.into_iter().next()
    };
    let lock = active.lock();
    let buf = lock.bytes();
    let current_len = buf.iter().take(NAME_LEN).position(|&b| b == 0).unwrap_or(0);
    if &buf[..current_len] == name.as_bytes() {
        let len = NAME_LEN.min(buf.len());
        buf[..len].fill(0);
        if let Some(next) = remaining {
            let n = next.len().min(NAME_LEN - 1);
            buf[..n].copy_from_slice(&next[..n]);
        }
    }
}

impl Drop for SpoutSender {
    fn drop(&mut self) {
        remove_name(&self.names, &self.active, &self.name);
        unsafe {
            let _ = CloseHandle(self.access_mutex);
            if let Some(s) = self.frame_count {
                let _ = CloseHandle(s);
            }
        }
    }
}

// ---- 受け手の側から見る（テスト用。Spout の受け手と同じ読み方） ----

#[cfg(test)]
pub fn sender_names() -> Vec<String> {
    let Some(names) = SharedMemory::open(SENDER_NAMES_MAP) else {
        return Vec::new();
    };
    let lock = names.lock();
    read_names(lock.bytes(), names.len / NAME_LEN)
        .into_iter()
        .map(|n| String::from_utf8_lossy(&n).into_owned())
        .collect()
}

#[cfg(test)]
pub fn active_sender_name() -> Option<String> {
    let active = SharedMemory::open(ACTIVE_SENDER_MAP)?;
    let lock = active.lock();
    let buf = lock.bytes();
    let len = buf.iter().take(NAME_LEN).position(|&b| b == 0)?;
    (len > 0).then(|| String::from_utf8_lossy(&buf[..len]).into_owned())
}

#[cfg(test)]
pub fn sender_info(name: &str) -> Option<SenderInfo> {
    let info = SharedMemory::open(name)?;
    let lock = info.lock();
    SenderInfo::from_bytes(lock.bytes())
}

// 受け手が共有テクスチャを読む間に持つミューテックス（Spout の受け手と同じ名前のものを開く）
#[cfg(test)]
pub struct ReceiverAccess {
    mutex: HANDLE,
}

#[cfg(test)]
impl ReceiverAccess {
    pub fn open(name: &str) -> Option<Self> {
        let c = CString::new(format!("{name}_SpoutAccessMutex")).ok()?;
        // 送り手が作っていなければ作ってしまうので、すでにあったかで見分ける
        let mutex = unsafe { CreateMutexA(None, false, pcstr(&c)) }.ok()?;
        if unsafe { GetLastError() } != ERROR_ALREADY_EXISTS {
            unsafe {
                let _ = CloseHandle(mutex);
            }
            return None;
        }
        Some(Self { mutex })
    }

    pub fn lock(&self) -> bool {
        let r = unsafe { WaitForSingleObject(self.mutex, LOCK_TIMEOUT_MS) };
        r == WAIT_OBJECT_0 || r == WAIT_ABANDONED
    }

    pub fn unlock(&self) {
        unsafe {
            let _ = ReleaseMutex(self.mutex);
        }
    }
}

#[cfg(test)]
impl Drop for ReceiverAccess {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.mutex);
        }
    }
}

// フレームの数（受け手が読むのと同じやり方: 1 減らして戻し、前の値を得る）。セマフォが無ければ None
#[cfg(test)]
pub fn frame_count(name: &str) -> Option<i32> {
    let c = CString::new(format!("{name}_Count_Semaphore")).ok()?;
    let s = unsafe { CreateSemaphoreA(None, 1, i32::MAX, pcstr(&c)) }.ok()?;
    let existed = unsafe { GetLastError() } == ERROR_ALREADY_EXISTS;
    let mut count = None;
    if existed && unsafe { WaitForSingleObject(s, 0) } == WAIT_OBJECT_0 {
        let mut previous = 0;
        if unsafe { ReleaseSemaphore(s, 1, Some(&mut previous)) }.is_ok() {
            count = Some(previous + 1);
        }
    }
    unsafe {
        let _ = CloseHandle(s);
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(names: &[&str]) -> BTreeSet<Vec<u8>> {
        names.iter().map(|n| n.as_bytes().to_vec()).collect()
    }

    #[test]
    fn 名前の一覧を読み書きする() {
        let mut buf = vec![0xAAu8; NAME_LEN * 4];
        write_names(&mut buf, &set(&["b", "2D Liver", "a"]), 4);
        assert_eq!(
            read_names(&buf, 4),
            vec![b"2D Liver".to_vec(), b"a".to_vec(), b"b".to_vec()]
        );
        assert_eq!(&buf[NAME_LEN * 3..], &vec![0u8; NAME_LEN][..]); // 残りの枠は空
        write_names(&mut buf, &set(&["a"]), 4);
        assert_eq!(read_names(&buf, 4), vec![b"a".to_vec()]);
        write_names(&mut buf, &set(&[]), 4);
        assert!(read_names(&buf, 4).is_empty());
    }

    #[test]
    fn 上限より多くは書かない() {
        let mut buf = vec![0u8; NAME_LEN * 2];
        write_names(&mut buf, &set(&["a", "b", "c"]), 2);
        assert_eq!(read_names(&buf, 2), vec![b"a".to_vec(), b"b".to_vec()]);
    }

    #[test]
    fn 送り手の情報は_280_バイト() {
        let mut description = [0u8; 256];
        description[..3].copy_from_slice(b"a:\\");
        let info = SenderInfo {
            share_handle: 0x1234,
            width: 1920,
            height: 1080,
            format: DXGI_FORMAT_B8G8R8A8_UNORM,
            usage: 0,
            description,
            partner_id: 0,
        };
        let bytes = info.to_bytes();
        assert_eq!(bytes.len(), 280);
        assert_eq!(&bytes[0..4], &0x1234u32.to_le_bytes());
        assert_eq!(&bytes[12..16], &87u32.to_le_bytes());
        assert_eq!(SenderInfo::from_bytes(&bytes), Some(info));
    }
}
