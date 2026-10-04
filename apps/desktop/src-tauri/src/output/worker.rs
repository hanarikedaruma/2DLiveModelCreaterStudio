// Spout2 の送信を受け持つスレッド。D3D11 のデバイス・共有テクスチャ・送り手はこのスレッドの中だけで使う。
// フレームは最新のものだけを描く（描くのが追いつかなければ古いものを捨てる）。テクスチャは届いた順に必ず反映する

use super::d3d11::{create_device, Renderer};
use super::frame::{decode_frame, decode_textures};
use super::image;
use super::spout::{SpoutSender, DXGI_FORMAT_B8G8R8A8_UNORM};
use std::sync::mpsc::{self, Receiver, Sender, TryRecvError};
use std::thread::JoinHandle;

enum Command {
    Textures(Vec<u8>, Sender<Result<Vec<String>, String>>),
    Frame(Vec<u8>),
    Stop,
}

pub struct StartOptions {
    pub sender_name: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug)]
pub struct Started {
    pub sender_name: String, // 同じ名前の送り手があれば _1 などが付く
    pub msaa_samples: u32,
}

pub struct Worker {
    tx: Sender<Command>,
    thread: Option<JoinHandle<()>>,
    pub started: Started,
}

impl Worker {
    pub fn start(options: StartOptions) -> Result<Worker, String> {
        let (tx, rx) = mpsc::channel();
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread = std::thread::Builder::new()
            .name("spout2-output".into())
            .spawn(move || run(options, rx, ready_tx))
            .map_err(|e| format!("Spout2 のスレッドを作れない: {e}"))?;
        match ready_rx.recv() {
            Ok(Ok(started)) => Ok(Worker {
                tx,
                thread: Some(thread),
                started,
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
    renderer: Renderer,
    sender: SpoutSender,
}

fn open(options: &StartOptions) -> Result<Output, String> {
    let gpu = create_device(false)?;
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
    Ok(Output { renderer, sender })
}

fn apply_textures(renderer: &mut Renderer, bytes: &[u8]) -> Result<Vec<String>, String> {
    let update = decode_textures(bytes)?;
    let mut warnings = Vec::new();
    for id in update.removals {
        renderer.remove_texture(id);
    }
    for (id, data) in update.upserts {
        let result = image::decode(data).and_then(|img| renderer.set_texture(id, &img));
        if let Err(e) = result {
            renderer.remove_texture(id);
            warnings.push(format!("テクスチャ {id}: {e}"));
        }
    }
    Ok(warnings)
}

fn render(output: &mut Output, bytes: &[u8]) -> Result<(), String> {
    let frame = decode_frame(bytes)?;
    output.renderer.render(&frame)?;
    // 受け手が読んでいる間は書かない（このフレームは送らない）
    if let Some(_access) = output.sender.access_texture() {
        output.renderer.publish();
        output.sender.frame_sent();
    }
    Ok(())
}

fn run(options: StartOptions, rx: Receiver<Command>, ready: Sender<Result<Started, String>>) {
    let mut output = match open(&options) {
        Ok(o) => o,
        Err(e) => {
            let _ = ready.send(Err(e));
            return;
        }
    };
    let _ = ready.send(Ok(Started {
        sender_name: output.sender.name().to_string(),
        msaa_samples: output.renderer.samples(),
    }));
    let mut reported = false;
    'outer: while let Ok(first) = rx.recv() {
        let mut frame = None;
        let mut next = Some(first);
        while let Some(command) = next.take() {
            match command {
                Command::Stop => break 'outer,
                Command::Frame(bytes) => frame = Some(bytes),
                Command::Textures(bytes, reply) => {
                    let _ = reply.send(apply_textures(&mut output.renderer, &bytes));
                }
            }
            next = match rx.try_recv() {
                Ok(c) => Some(c),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => break 'outer,
            };
        }
        if let Some(bytes) = frame {
            if let Err(e) = render(&mut output, &bytes) {
                // 同じ失敗を毎フレーム出さない
                if !reported {
                    eprintln!("Spout2 のフレームを送れない: {e}");
                    reported = true;
                }
            }
        }
    }
    // 送り手を一覧から消してから、テクスチャを片付ける
    drop(output.sender);
    drop(output.renderer);
}
