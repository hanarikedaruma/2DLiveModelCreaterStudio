// Spout2 の送信を受け持つスレッド。D3D11 のデバイス・共有テクスチャ・送り手はこのスレッドの中だけで使う。
// フレームは最新のものだけを描く（描くのが追いつかなければ古いものを捨てる）。テクスチャは届いた順に必ず反映する

use super::d3d11::{create_device_with_adapter, Renderer};
use super::frame::{decode_frame, decode_textures};
use super::image;
use super::recovery::{Backend, RecoveringOutput, RecoveryStatus};
use super::spout::{SpoutSender, DXGI_FORMAT_B8G8R8A8_UNORM};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;

enum Command {
    Textures(Vec<u8>, Sender<Result<Vec<String>, String>>),
    Frame(Vec<u8>),
    Stop,
}

pub struct StartOptions {
    pub sender_name: String,
    pub width: u32,
    pub height: u32,
    pub adapter_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Started {
    pub sender_name: String, // 同じ名前の送り手があれば _1 などが付く
    pub msaa_samples: u32,
    pub adapter_id: String,
    pub adapter_fallback: bool,
    started_at: Instant,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    #[serde(flatten)]
    pub recovery: RecoveryStatus,
    pub sender_name: String,
    pub adapter_id: String,
    pub adapter_fallback: bool,
}

pub struct Worker {
    tx: Sender<Command>,
    thread: Option<JoinHandle<()>>,
    pub started: Started,
    status: Arc<Mutex<Option<Status>>>,
}

impl Worker {
    pub fn start(options: StartOptions) -> Result<Worker, String> {
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let status = Arc::new(Mutex::new(None));
        let shared_status = status.clone();
        let thread = std::thread::Builder::new()
            .name("spout2-output".into())
            .spawn(move || run(options, rx, ready_tx, shared_status))
            .map_err(|e| format!("Spout2 のスレッドを作れない: {e}"))?;
        match ready_rx.recv() {
            Ok(Ok(started)) => Ok(Worker {
                tx,
                thread: Some(thread),
                started,
                status,
            }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => {
                let _ = thread.join();
                Err("Spout2 のスレッドが止まった".into())
            }
        }
    }

    // テクスチャを足す・差し替える・消す。読めなかった画像の知らせを返す（読み終わるまで待つ）
    #[cfg(test)]
    pub fn set_textures(&self, bytes: Vec<u8>) -> Result<Vec<String>, String> {
        self.handle().set_textures(bytes)
    }

    #[cfg(test)]
    pub fn submit(&self, bytes: Vec<u8>) -> Result<(), String> {
        self.handle().submit(bytes)
    }

    // ほかのスレッドから送るための口（Worker のロックを持ったまま待たないように）
    pub fn handle(&self) -> WorkerHandle {
        WorkerHandle {
            tx: self.tx.clone(),
        }
    }

    pub fn stop(mut self) {
        self.shutdown();
    }
    pub fn status(&self) -> Option<Status> {
        let mut status = self.status.lock().ok()?.clone()?;
        status.recovery.elapsed_seconds = self.started.started_at.elapsed().as_secs_f64();
        status.recovery.send_fps = if status.recovery.elapsed_seconds > 0.0 {
            status.recovery.sent_frames as f64 / status.recovery.elapsed_seconds
        } else {
            0.0
        };
        Some(status)
    }

    fn shutdown(&mut self) {
        let _ = self.tx.send(Command::Stop);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[derive(Clone)]
pub struct WorkerHandle {
    tx: Sender<Command>,
}

const STOPPED: &str = "Spout2 の送信が止まっている";

impl WorkerHandle {
    pub fn set_textures(&self, bytes: Vec<u8>) -> Result<Vec<String>, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Command::Textures(bytes, reply_tx))
            .map_err(|_| STOPPED.to_string())?;
        reply_rx.recv().map_err(|_| STOPPED.to_string())?
    }

    pub fn submit(&self, bytes: Vec<u8>) -> Result<(), String> {
        self.tx
            .send(Command::Frame(bytes))
            .map_err(|_| STOPPED.to_string())
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct Output {
    // 送り手を先に消してから、共有テクスチャを解放する（フィールドは宣言順に破棄）。
    sender: SpoutSender,
    renderer: Renderer,
    adapter_id: String,
    adapter_fallback: bool,
}

fn open(options: &StartOptions) -> Result<Output, String> {
    let gpu = create_device_with_adapter(false, options.adapter_id.as_deref())?;
    let adapter_id = gpu.adapter_id.clone();
    let adapter_fallback = gpu.adapter_fallback;
    let renderer = Renderer::new(gpu, options.width, options.height, true)?;
    let handle = renderer.share_handle()?;
    // 送り手を出す前に、透明な絵を書いておく（受け手が最初に読むもの）
    renderer.publish();
    let sender = SpoutSender::create(
        &options.sender_name,
        options.width,
        options.height,
        handle,
        DXGI_FORMAT_B8G8R8A8_UNORM,
    )?;
    Ok(Output {
        renderer,
        sender,
        adapter_id,
        adapter_fallback,
    })
}

fn apply_textures(
    output: &mut RecoveringOutput<Output>,
    bytes: &[u8],
    now_ms: u64,
) -> Result<Vec<String>, String> {
    let update = decode_textures(bytes)?;
    let mut warnings = Vec::new();
    for id in update.removals {
        output.remove_texture(id);
    }
    for (id, data) in update.upserts {
        let result = output.set_texture(id, data, now_ms);
        if let Err(e) = result {
            warnings.push(format!("テクスチャ {id}: {e}"));
        }
    }
    Ok(warnings)
}

impl Backend for Output {
    fn device_error(&self) -> Option<String> {
        self.renderer.device_error()
    }
    fn set_texture(&mut self, id: u32, image: &image::Image) -> Result<(), String> {
        self.renderer.set_texture(id, image)
    }
    fn remove_texture(&mut self, id: u32) {
        self.renderer.remove_texture(id);
    }
    fn render(&mut self, frame: &super::frame::Frame) -> Result<bool, String> {
        self.renderer.render(frame)?;
        if let Some(e) = self.renderer.device_error() {
            return Err(e);
        }
        // 受け手が読んでいる間は書かない（送信数にも失敗数にも入れない）。
        if let Some(_access) = self.sender.access_texture() {
            self.renderer.publish();
            if let Some(e) = self.renderer.device_error() {
                return Err(e);
            }
            self.sender.frame_sent();
            return Ok(true);
        }
        Ok(false)
    }
}

fn run(
    mut options: StartOptions,
    rx: Receiver<Command>,
    ready: Sender<Result<Started, String>>,
    status: Arc<Mutex<Option<Status>>>,
) {
    let initial = match open(&options) {
        Ok(o) => o,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let clock = Instant::now();
    // 復旧しても、受け手が選んだ同じ名前で登録し直す。
    options.sender_name = initial.sender.name().to_string();
    let _ = ready.send(Ok(Started {
        sender_name: options.sender_name.clone(),
        msaa_samples: initial.renderer.samples(),
        adapter_id: initial.adapter_id.clone(),
        adapter_fallback: initial.adapter_fallback,
        started_at: clock,
    }));
    let mut last_name = options.sender_name.clone();
    let mut last_adapter = initial.adapter_id.clone();
    let mut last_fallback = initial.adapter_fallback;
    let mut output = RecoveringOutput::new(initial);
    let mut reported = false;
    'outer: while let Ok(first) = rx.recv() {
        let mut frame = None;
        let mut next = Some(first);
        while let Some(command) = next.take() {
            match command {
                Command::Stop => break 'outer,
                Command::Frame(bytes) => frame = Some(bytes),
                Command::Textures(bytes, reply) => {
                    let _ = reply.send(apply_textures(
                        &mut output,
                        &bytes,
                        clock.elapsed().as_millis() as u64,
                    ));
                }
            }
            next = match rx.try_recv() {
                Ok(c) => Some(c),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => break 'outer,
            };
        }
        if let Some(bytes) = frame {
            match decode_frame(&bytes) {
                Ok(frame) => output.render(&frame, clock.elapsed().as_millis() as u64, || {
                    open(&options)
                }),
                Err(e) => {
                    // 同じ失敗を毎フレーム出さない
                    if !reported {
                        eprintln!("Spout2 のフレームを送れない: {e}");
                        reported = true;
                    }
                }
            }
        }
        if let Some(backend) = output.backend() {
            last_name = backend.sender.name().to_string();
            last_adapter = backend.adapter_id.clone();
            last_fallback = backend.adapter_fallback;
        }
        if let Ok(mut slot) = status.lock() {
            *slot = Some(Status {
                recovery: output.status(clock.elapsed().as_millis() as u64),
                sender_name: last_name.clone(),
                adapter_id: last_adapter.clone(),
                adapter_fallback: last_fallback,
            });
        }
    }
}
