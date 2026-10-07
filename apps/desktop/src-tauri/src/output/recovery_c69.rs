// カード69（Spout2 の復帰と GPU の選択・I-031）のテスト。テストの担当は CL（実装の担当は CO）
// - 失敗を差し込める仮のデバイス（FakeGpu）で、デバイスの消失・描画の失敗・素材の転送の失敗から作り直して
//   送信が続くこと、続けて失敗するときの待ち時間（100ms から倍にし、5 秒で止める）、最新の素材の送り直し、
//   同じ送り手の名前で登録し直すことを確かめる
// - 本物の D3D11 のデバイス・共有テクスチャを、差し込んだ消失で捨てて作り直し、別のデバイス（受け手の代わり）が
//   新しい共有テクスチャから最新の絵を読めることを確かめる

use super::d3d11::{create_device, create_device_with_adapter, read_texture, Renderer};
use super::frame::{Background, BlendMode, Frame, Item, TextureData, View};
use super::image::{encode_png, Image};
use super::recovery::{Backend, RecoveringOutput};
use super::worker::Status;
use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashSet};
use std::rc::Rc;
use windows::Win32::Foundation::HANDLE;
use windows::Win32::Graphics::Direct3D11::ID3D11Texture2D;

// ---- 失敗を差し込める仮のデバイス ----

// 仮のデバイスたちの記録と、差し込む失敗。デバイスの番号は作った順に 0, 1, 2…
struct World {
    opened: usize,
    attempts: Vec<u64>,        // 作り直しを試した時刻
    open_failures: u32,        // この回数だけ、作り直し（デバイスを作る）に失敗する
    dropped: Vec<usize>,       // 捨てたデバイス
    lost: HashSet<usize>,      // デバイスが失われた（GetDeviceRemovedReason が失敗を返す）
    reset: HashSet<usize>,     // 描画・共有テクスチャへの書き込みが失敗する
    no_upload: HashSet<usize>, // 素材のテクスチャを作れない
    busy: bool,                // 受け手が共有テクスチャを読んでいる（書けない）
    uploads: Vec<(usize, u32, Image)>,
    removals: Vec<(usize, u32)>,
    sent: Vec<usize>, // 送れたフレーム（送ったデバイスの番号）
    // 動いている送り手の名前 → デバイスの番号（Spout の送り手の一覧の代わり）
    senders: BTreeMap<String, usize>,
    sender_base: String, // 送り手を作るときの名前（worker は最初に決まった名前で作り直す）
}

type Shared = Rc<RefCell<World>>;

fn world() -> Shared {
    Rc::new(RefCell::new(World {
        opened: 0,
        attempts: vec![],
        open_failures: 0,
        dropped: vec![],
        lost: HashSet::new(),
        reset: HashSet::new(),
        no_upload: HashSet::new(),
        busy: false,
        uploads: vec![],
        removals: vec![],
        sent: vec![],
        senders: BTreeMap::new(),
        sender_base: "2D Liver".into(),
    }))
}

struct FakeGpu {
    id: usize,
    sender: String,
    world: Shared,
}

impl Drop for FakeGpu {
    fn drop(&mut self) {
        let mut w = self.world.borrow_mut();
        w.dropped.push(self.id);
        if w.senders.get(&self.sender) == Some(&self.id) {
            w.senders.remove(&self.sender);
        }
    }
}

impl Backend for FakeGpu {
    fn device_error(&self) -> Option<String> {
        let w = self.world.borrow();
        w.lost
            .contains(&self.id)
            .then(|| format!("DXGI_ERROR_DEVICE_REMOVED（デバイス{}）", self.id))
    }
    fn set_texture(&mut self, id: u32, image: &Image) -> Result<(), String> {
        let mut w = self.world.borrow_mut();
        if w.no_upload.contains(&self.id) {
            return Err(format!("共有テクスチャを作れない（デバイス{}）", self.id));
        }
        w.uploads.push((self.id, id, image.clone()));
        Ok(())
    }
    fn remove_texture(&mut self, id: u32) {
        self.world.borrow_mut().removals.push((self.id, id));
    }
    fn render(&mut self, _: &Frame) -> Result<bool, String> {
        let mut w = self.world.borrow_mut();
        if w.reset.contains(&self.id) {
            return Err(format!("DXGI_ERROR_DEVICE_RESET（デバイス{}）", self.id));
        }
        if w.busy {
            return Ok(false);
        }
        w.sent.push(self.id);
        Ok(true)
    }
}

// デバイス・共有テクスチャ・送り手を作る（worker の open の代わり）。
// 同じ名前の送り手が動いていれば _1、_2… を付ける（Spout と同じ）
fn create(world: &Shared) -> FakeGpu {
    let mut w = world.borrow_mut();
    let id = w.opened;
    w.opened += 1;
    let base = w.sender_base.clone();
    let mut name = base.clone();
    let mut i = 1;
    while w.senders.contains_key(&name) {
        name = format!("{base}_{i}");
        i += 1;
    }
    w.senders.insert(name.clone(), id);
    drop(w);
    FakeGpu {
        id,
        sender: name,
        world: world.clone(),
    }
}

// 作り直しの口（RecoveringOutput::render に渡す）。試した時刻を記録し、open_failures の回数だけ失敗する
fn reopen(world: &Shared, now_ms: u64) -> impl FnMut() -> Result<FakeGpu, String> + '_ {
    move || {
        {
            let mut w = world.borrow_mut();
            w.attempts.push(now_ms);
            if w.open_failures > 0 {
                w.open_failures -= 1;
                return Err("D3D11CreateDevice が失敗した".into());
            }
        }
        Ok(create(world))
    }
}

fn frame() -> Frame {
    Frame {
        view: View {
            scale: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
        },
        background: Background::Transparent,
        items: vec![],
    }
}

// 1×1 の PNG（乗算していない RGBA）
fn png(rgba: [u8; 4]) -> TextureData {
    TextureData::Png(encode_png(1, 1, &rgba))
}

// 1×1 の画像（乗算済みの RGBA）
fn img(rgba: [u8; 4]) -> Image {
    Image {
        width: 1,
        height: 1,
        pixels: rgba.to_vec(),
    }
}

// そのデバイスへ送った素材（番号の順）
fn uploads_to(world: &Shared, device: usize) -> Vec<(u32, Image)> {
    let mut list: Vec<(u32, Image)> = world
        .borrow()
        .uploads
        .iter()
        .filter(|(d, _, _)| *d == device)
        .map(|(_, id, image)| (*id, image.clone()))
        .collect();
    list.sort_by_key(|(id, _)| *id);
    list
}

#[test]
fn デバイスが失われたら捨てて100ms後に作り直し最新の素材を送って送信を続ける() {
    let world = world();
    let mut output = RecoveringOutput::new(create(&world));
    output.set_texture(7, png([255, 0, 0, 255]), 0).unwrap();
    output.render(&frame(), 0, reopen(&world, 0));
    output.render(&frame(), 16, reopen(&world, 16));
    assert_eq!(world.borrow().sent, vec![0, 0]);
    assert_eq!(uploads_to(&world, 0), vec![(7, img([255, 0, 0, 255]))]);

    // 33ms のフレームでデバイスの消失を見つける。そのフレームは送らず、デバイスを捨てる
    world.borrow_mut().lost.insert(0);
    output.render(&frame(), 33, reopen(&world, 33));
    let s = output.status(33);
    assert_eq!(s.state, "recovering");
    assert_eq!(
        s.message.as_deref(),
        Some("DXGI_ERROR_DEVICE_REMOVED（デバイス0）")
    );
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (2, 1, 0));
    assert_eq!(world.borrow().dropped, vec![0]);
    assert!(output.backend().is_none());

    // 100ms たつまでは作り直さない（届いたフレームは捨てる）
    for t in [50, 100, 132] {
        output.render(&frame(), t, reopen(&world, t));
    }
    assert_eq!(world.borrow().attempts, Vec::<u64>::new());
    assert_eq!(world.borrow().sent, vec![0, 0]);

    // 133ms で作り直し、素材を送り直してから、そのフレームを送る
    output.render(&frame(), 133, reopen(&world, 133));
    assert_eq!(world.borrow().attempts, vec![133]);
    assert_eq!(uploads_to(&world, 1), vec![(7, img([255, 0, 0, 255]))]);
    assert_eq!(world.borrow().sent, vec![0, 0, 1]);
    let s = output.status(133);
    assert_eq!(s.state, "running");
    assert_eq!(s.message, None);
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (3, 1, 1));

    // その後は新しいデバイスで送り続ける（作り直しは繰り返さない）
    output.render(&frame(), 150, reopen(&world, 150));
    assert_eq!(world.borrow().sent, vec![0, 0, 1, 1]);
    assert_eq!(world.borrow().attempts, vec![133]);
    assert_eq!(world.borrow().dropped, vec![0]);
    assert_eq!(output.backend().map(|b| b.id), Some(1));
}

#[test]
fn 描画や共有テクスチャへの書き込みが失敗したときも作り直して送信が戻る() {
    let world = world();
    let mut output = RecoveringOutput::new(create(&world));
    output.set_texture(1, png([0, 0, 255, 255]), 0).unwrap();
    output.render(&frame(), 0, reopen(&world, 0));
    assert_eq!(world.borrow().sent, vec![0]);

    world.borrow_mut().reset.insert(0);
    output.render(&frame(), 20, reopen(&world, 20));
    let s = output.status(20);
    assert_eq!(s.state, "recovering");
    assert_eq!(
        s.message.as_deref(),
        Some("DXGI_ERROR_DEVICE_RESET（デバイス0）")
    );
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (1, 1, 0));
    assert_eq!(world.borrow().dropped, vec![0]);

    output.render(&frame(), 119, reopen(&world, 119));
    assert_eq!(world.borrow().attempts, Vec::<u64>::new());
    output.render(&frame(), 120, reopen(&world, 120));
    assert_eq!(world.borrow().attempts, vec![120]);
    assert_eq!(uploads_to(&world, 1), vec![(1, img([0, 0, 255, 255]))]);
    assert_eq!(world.borrow().sent, vec![0, 1]);
    let s = output.status(120);
    assert_eq!(s.state, "running");
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (2, 1, 1));
}

#[test]
fn 素材の転送でデバイスの失敗が分かっても素材を覚えておき作り直したデバイスへ送る() {
    let world = world();
    world.borrow_mut().no_upload.insert(0);
    let mut output = RecoveringOutput::new(create(&world));
    let error = output
        .set_texture(3, png([0, 255, 0, 255]), 40)
        .unwrap_err();
    assert_eq!(error, "共有テクスチャを作れない（デバイス0）");
    let s = output.status(40);
    assert_eq!(s.state, "recovering");
    assert_eq!(s.message.as_deref(), Some(error.as_str()));
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (0, 1, 0));
    assert_eq!(world.borrow().dropped, vec![0]);

    output.render(&frame(), 139, reopen(&world, 139));
    assert_eq!(world.borrow().attempts, Vec::<u64>::new());
    output.render(&frame(), 140, reopen(&world, 140));
    assert_eq!(world.borrow().attempts, vec![140]);
    assert_eq!(uploads_to(&world, 1), vec![(3, img([0, 255, 0, 255]))]);
    assert_eq!(world.borrow().sent, vec![1]);
    let s = output.status(140);
    assert_eq!(s.state, "running");
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (1, 1, 1));
}

#[test]
fn 続けて失敗すると待ち時間を100msから倍に広げ5秒で止めて諦めずに試し続ける() {
    let world = world();
    let mut output = RecoveringOutput::new(create(&world));
    output.set_texture(1, png([255, 255, 0, 255]), 0).unwrap();
    {
        let mut w = world.borrow_mut();
        w.lost.insert(0);
        w.open_failures = 9; // 9 回続けて作り直せない（10 回目で作れる）
    }
    // 1ms ごとにフレームが届く
    for t in 0..=26_400u64 {
        output.render(&frame(), t, reopen(&world, t));
        if t == 20_000 {
            let s = output.status(t);
            assert_eq!(s.state, "recovering");
            assert_eq!(s.message.as_deref(), Some("D3D11CreateDevice が失敗した"));
            assert_eq!((s.sent_frames, s.failures, s.recoveries), (0, 9, 0));
        }
    }
    let attempts = world.borrow().attempts.clone();
    assert_eq!(
        attempts,
        vec![100, 300, 700, 1_500, 3_100, 6_300, 11_300, 16_300, 21_300, 26_300]
    );
    let waits: Vec<u64> = attempts.windows(2).map(|p| p[1] - p[0]).collect();
    assert_eq!(
        waits,
        vec![200, 400, 800, 1_600, 3_200, 5_000, 5_000, 5_000, 5_000]
    );
    // 10 回目で作り直せたら、素材を送り直し、26300ms〜26400ms の 101 フレームを送る
    assert_eq!(output.backend().map(|b| b.id), Some(1));
    assert_eq!(uploads_to(&world, 1), vec![(1, img([255, 255, 0, 255]))]);
    let s = output.status(26_400);
    assert_eq!(s.state, "running");
    assert_eq!(s.message, None);
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (101, 10, 1));

    // 送れるようになったら、次の失敗の待ち時間は 100ms からやり直す
    world.borrow_mut().lost.insert(1);
    for t in 26_401..=26_600u64 {
        output.render(&frame(), t, reopen(&world, t));
    }
    assert_eq!(world.borrow().attempts.last(), Some(&26_501));
    assert_eq!(world.borrow().attempts.len(), 11);
    assert_eq!(output.backend().map(|b| b.id), Some(2));
    let s = output.status(26_600);
    assert_eq!(s.state, "running");
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (201, 11, 2));
}

#[test]
fn 復旧を待つ間に届いた素材の差し替え削除追加を反映し作り直したデバイスには最新の素材だけを送る() {
    let world = world();
    let mut output = RecoveringOutput::new(create(&world));
    output.set_texture(1, png([255, 0, 0, 255]), 0).unwrap();
    output.set_texture(2, png([0, 255, 0, 255]), 0).unwrap();
    output.render(&frame(), 0, reopen(&world, 0));
    world.borrow_mut().lost.insert(0);
    output.render(&frame(), 10, reopen(&world, 10));
    assert_eq!(output.status(10).state, "recovering");

    // デバイスが無い間の変更は覚えるだけ（失敗にはしない）
    output.set_texture(1, png([0, 0, 255, 255]), 20).unwrap();
    output.remove_texture(2);
    output
        .set_texture(
            3,
            TextureData::Rgba {
                width: 1,
                height: 1,
                pixels: vec![255, 255, 255, 128],
            },
            30,
        )
        .unwrap();
    assert_eq!(output.status(30).failures, 1);
    assert_eq!(world.borrow().removals, Vec::<(usize, u32)>::new());

    output.render(&frame(), 110, reopen(&world, 110));
    assert_eq!(world.borrow().attempts, vec![110]);
    // 差し替えた青・追加した白（半透明は乗算済みにして送る）だけを送る。消した 2 は送らない
    assert_eq!(
        uploads_to(&world, 1),
        vec![(1, img([0, 0, 255, 255])), (3, img([128, 128, 128, 128]))]
    );
    assert_eq!(world.borrow().sent, vec![0, 1]);
    assert_eq!(output.status(110).state, "running");
}

#[test]
fn 作り直したデバイスへ素材を送れなければそのデバイスも捨て間を広げて試し直す() {
    let world = world();
    let mut output = RecoveringOutput::new(create(&world));
    output.set_texture(4, png([255, 0, 0, 255]), 0).unwrap();
    {
        let mut w = world.borrow_mut();
        w.lost.insert(0);
        w.no_upload.insert(1); // 最初に作り直したデバイスも素材を受け取れない
    }
    output.render(&frame(), 0, reopen(&world, 0));
    output.render(&frame(), 100, reopen(&world, 100));
    assert_eq!(world.borrow().attempts, vec![100]);
    assert_eq!(world.borrow().dropped, vec![0, 1]);
    // 捨てたデバイスの送り手は一覧に残らない
    assert_eq!(world.borrow().senders, BTreeMap::new());
    assert!(output.backend().is_none());
    let s = output.status(100);
    assert_eq!(s.state, "recovering");
    assert_eq!(
        s.message.as_deref(),
        Some("共有テクスチャを作れない（デバイス1）")
    );
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (0, 2, 0));

    // 2 回目の失敗なので 200ms 待つ
    output.render(&frame(), 299, reopen(&world, 299));
    assert_eq!(world.borrow().attempts, vec![100]);
    output.render(&frame(), 300, reopen(&world, 300));
    assert_eq!(world.borrow().attempts, vec![100, 300]);
    assert_eq!(uploads_to(&world, 2), vec![(4, img([255, 0, 0, 255]))]);
    assert_eq!(world.borrow().sent, vec![2]);
    let s = output.status(300);
    assert_eq!(s.state, "running");
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (1, 2, 1));
}

#[test]
fn 作り直す前に古い送り手を消すので同じ送り手の名前で登録し直す() {
    let world = world();
    // ほかのアプリが「2D Liver」で送っているので、このアプリの送り手は「2D Liver_1」になる
    world
        .borrow_mut()
        .senders
        .insert("2D Liver".into(), usize::MAX);
    let first = create(&world);
    assert_eq!(first.sender, "2D Liver_1");
    // worker と同じく、復旧では最初に決まった名前で作る
    world.borrow_mut().sender_base = first.sender.clone();
    let mut output = RecoveringOutput::new(first);
    output.render(&frame(), 0, reopen(&world, 0));
    world.borrow_mut().lost.insert(0);
    output.render(&frame(), 10, reopen(&world, 10));
    output.render(&frame(), 110, || {
        // 作り直すときには、古いデバイスと送り手はもう無い
        assert_eq!(world.borrow().dropped, vec![0]);
        assert!(!world.borrow().senders.contains_key("2D Liver_1"));
        reopen(&world, 110)()
    });
    assert_eq!(world.borrow().attempts, vec![110]);
    assert_eq!(
        output.backend().map(|b| b.sender.as_str()),
        Some("2D Liver_1")
    );
    assert_eq!(
        world.borrow().senders,
        BTreeMap::from([
            ("2D Liver".to_string(), usize::MAX),
            ("2D Liver_1".to_string(), 1)
        ])
    );
    assert_eq!(world.borrow().sent, vec![0, 1]);
}

#[test]
fn 受け手が読んでいて書けなかったフレームは送信にも失敗にも数えず送信fpsは送れた数から出す() {
    let world = world();
    let mut output = RecoveringOutput::new(create(&world));
    // 50ms ごとの 20 フレームのうち、4 フレームに 1 つは受け手が読んでいて書けない
    for i in 1..=20u64 {
        world.borrow_mut().busy = i % 4 == 0;
        output.render(&frame(), i * 50, reopen(&world, i * 50));
    }
    let s = output.status(1_000);
    assert_eq!(s.state, "running");
    assert_eq!(s.message, None);
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (15, 0, 0));
    assert_eq!(s.elapsed_seconds, 1.0);
    assert_eq!(s.send_fps, 15.0);
    assert_eq!(world.borrow().sent.len(), 15);
    assert_eq!(world.borrow().attempts, Vec::<u64>::new());
    assert_eq!(world.borrow().dropped, Vec::<usize>::new());
}

#[test]
fn 送信の状態は画面と計測が読む名前で返す() {
    let world = world();
    let mut output = RecoveringOutput::new(create(&world));
    output.render(&frame(), 0, reopen(&world, 0));
    world.borrow_mut().lost.insert(0);
    output.render(&frame(), 500, reopen(&world, 500));
    let status = Status {
        recovery: output.status(2_000),
        sender_name: "2D Liver_1".into(),
        adapter_id: "00000000:0000abcd".into(),
        adapter_fallback: true,
    };
    // apps/desktop/src/output/spout/sink.ts の SpoutTelemetry と同じ形（平ら・camelCase）
    assert_eq!(
        serde_json::to_value(&status).unwrap(),
        serde_json::json!({
            "state": "recovering",
            "message": "DXGI_ERROR_DEVICE_REMOVED（デバイス0）",
            "sentFrames": 1,
            "failures": 1,
            "recoveries": 0,
            "elapsedSeconds": 2.0,
            "sendFps": 0.5,
            "senderName": "2D Liver_1",
            "adapterId": "00000000:0000abcd",
            "adapterFallback": true
        })
    );
}

// ---- 本物の D3D11 のデバイス・共有テクスチャ（GPU が要る） ----

const WIDTH: u32 = 32;
const HEIGHT: u32 = 16;

// worker の送り手の代わり。描いた絵を共有テクスチャへ書く（Spout の一覧には載せない）
struct RealGpu {
    renderer: Renderer,
    lost: Rc<Cell<bool>>, // 失敗を差し込む（本物の消失は起こせないので）
}

impl Backend for RealGpu {
    fn device_error(&self) -> Option<String> {
        if self.lost.get() {
            Some("差し込んだデバイスの消失".into())
        } else {
            self.renderer.device_error()
        }
    }
    fn set_texture(&mut self, id: u32, image: &Image) -> Result<(), String> {
        self.renderer.set_texture(id, image)
    }
    fn remove_texture(&mut self, id: u32) {
        self.renderer.remove_texture(id);
    }
    fn render(&mut self, frame: &Frame) -> Result<bool, String> {
        self.renderer.render(frame)?;
        self.renderer.publish();
        Ok(true)
    }
}

fn open_real(lost: &Rc<Cell<bool>>) -> Result<RealGpu, String> {
    let renderer = Renderer::new(
        create_device_with_adapter(false, None)?,
        WIDTH,
        HEIGHT,
        true,
    )?;
    renderer.publish();
    Ok(RealGpu {
        renderer,
        lost: lost.clone(),
    })
}

// 素材 1 を [x0, y0, x1, y1] の四角に描くフレーム
fn rect_frame(r: [f32; 4]) -> Frame {
    let [x0, y0, x1, y1] = r;
    Frame {
        view: View {
            scale: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
        },
        background: Background::Transparent,
        items: vec![Item {
            part: 0,
            texture: 1,
            positions: vec![x0, y0, x1, y0, x1, y1, x0, y1],
            uvs: vec![0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0],
            indices: vec![0, 1, 2, 0, 2, 3],
            opacity: 1.0,
            blend: BlendMode::Normal,
            mask: None,
        }],
    }
}

// 別のデバイス（受け手の代わり）で共有テクスチャを開き、RGBA で読む
fn read_shared(handle: u32) -> Vec<u8> {
    let receiver = create_device(true).unwrap();
    let mut shared: Option<ID3D11Texture2D> = None;
    unsafe {
        receiver
            .device
            .OpenSharedResource(
                HANDLE(handle as usize as *mut core::ffi::c_void),
                &mut shared,
            )
            .expect("共有テクスチャを開けない");
    }
    let bgra = read_texture(&receiver.device, &receiver.context, &shared.unwrap()).unwrap();
    bgra.as_chunks::<4>()
        .0
        .iter()
        .flat_map(|p| [p[2], p[1], p[0], p[3]])
        .collect()
}

fn pixel(rgba: &[u8], x: u32, y: u32) -> [u8; 4] {
    let i = ((y * WIDTH + x) * 4) as usize;
    [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
}

#[test]
fn 本物のデバイスと共有テクスチャを作り直し受け手が新しい共有テクスチャから最新の絵を読める() {
    let first_lost = Rc::new(Cell::new(false));
    let mut output = RecoveringOutput::new(open_real(&first_lost).unwrap());
    let red: Vec<u8> = (0..16).flat_map(|_| [255u8, 0, 0, 255]).collect();
    output
        .set_texture(1, TextureData::Png(encode_png(4, 4, &red)), 0)
        .unwrap();
    // 左半分に赤
    output.render(&rect_frame([0.0, 0.0, 16.0, 16.0]), 0, || {
        Err("まだ作り直さない".into())
    });
    assert_eq!(output.status(0).sent_frames, 1);
    let old_handle = output.backend().unwrap().renderer.share_handle().unwrap();
    let before = read_shared(old_handle);
    assert_eq!(pixel(&before, 8, 8), [255, 0, 0, 255]);
    assert_eq!(pixel(&before, 24, 8), [0, 0, 0, 0]);

    // デバイスの消失を差し込む。古いデバイス・共有テクスチャを捨て、100ms 後に作り直す
    first_lost.set(true);
    let later_lost = Rc::new(Cell::new(false));
    output.render(&rect_frame([16.0, 0.0, 32.0, 16.0]), 1_000, || {
        Err("100ms 待たずに作り直そうとした".into())
    });
    assert!(output.backend().is_none());
    assert_eq!(output.status(1_000).state, "recovering");
    // 右半分に赤（最新のフレーム）。素材は作り直したデバイスへ送り直されている
    output.render(&rect_frame([16.0, 0.0, 32.0, 16.0]), 1_100, || {
        open_real(&later_lost)
    });
    let s = output.status(1_100);
    assert_eq!(s.state, "running");
    assert_eq!((s.sent_frames, s.failures, s.recoveries), (2, 1, 1));
    let new_handle = output.backend().unwrap().renderer.share_handle().unwrap();
    let after = read_shared(new_handle);
    assert_eq!(pixel(&after, 8, 8), [0, 0, 0, 0]);
    assert_eq!(pixel(&after, 24, 8), [255, 0, 0, 255]);
}
