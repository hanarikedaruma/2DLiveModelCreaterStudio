// Spout2 出力（カード41）。JS の createSpoutSink（apps/desktop/src/output/spout/sink.ts）から呼ばれるコマンド。
// - spout_start { width, height, fps }: 送信のスレッドを作る（動いていれば作り直す）。送り手の名前などを返す
// - spout_set_textures（バイナリ）: 素材のテクスチャを足す・差し替える・消す。読めなかったものの知らせを返す
// - spout_submit（バイナリ）: 1フレームを送る（待たない。描くのが追いつかなければ古いフレームを捨てる）
// - spout_stop: 止めて、送り手を一覧から消す
// 描画は D3D11（d3d11.rs）、送り手の仕組みは Spout2 と互換のものを自前で作る（spout.rs）。外のサーバーとは通信しない

pub mod frame;
pub mod image;
pub mod plan;

#[cfg(windows)]
pub mod d3d11;
#[cfg(windows)]
pub mod recovery;
#[cfg(windows)]
pub mod spout;
#[cfg(windows)]
pub mod worker;

#[cfg(all(test, windows))]
mod gpu_tests;

use std::sync::{Arc, Mutex};
use tauri::ipc::{InvokeBody, Request};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    sender_name: String,
    msaa_samples: u32,
    adapter_id: String,
    adapter_fallback: bool,
}

#[derive(Default)]
pub struct SpoutState {
    #[cfg(windows)]
    worker: Arc<Mutex<Option<worker::Worker>>>,
    #[cfg(not(windows))]
    worker: Arc<Mutex<Option<()>>>,
}

fn raw_body(request: &Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err("Spout2 へはバイナリ（Uint8Array）で送る".into()),
    }
}

#[cfg(windows)]
fn join_error(e: impl std::fmt::Display) -> String {
    format!("Spout2 の処理が止まった: {e}")
}

#[cfg(windows)]
#[tauri::command]
pub async fn spout_start(
    state: tauri::State<'_, SpoutState>,
    width: u32,
    height: u32,
    fps: f64,
    adapter_id: Option<String>,
) -> Result<StartResult, String> {
    if !fps.is_finite() || fps <= 0.0 {
        return Err(format!("fps が合わない: {fps}"));
    }
    let slot = state.worker.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = slot
            .lock()
            .map_err(|_| "Spout2 の状態が壊れている".to_string())?;
        if let Some(old) = slot.take() {
            old.stop();
        }
        let w = worker::Worker::start(worker::StartOptions {
            sender_name: spout::SENDER_NAME.into(),
            width,
            height,
            adapter_id,
        })?;
        let result = StartResult {
            sender_name: w.started.sender_name.clone(),
            msaa_samples: w.started.msaa_samples,
            adapter_id: w.started.adapter_id.clone(),
            adapter_fallback: w.started.adapter_fallback,
        };
        *slot = Some(w);
        Ok(result)
    })
    .await
    .map_err(join_error)?
}

#[cfg(windows)]
#[tauri::command]
pub async fn spout_set_textures(
    state: tauri::State<'_, SpoutState>,
    request: Request<'_>,
) -> Result<Vec<String>, String> {
    let bytes = raw_body(&request)?;
    let handle = {
        let slot = state
            .worker
            .lock()
            .map_err(|_| "Spout2 の状態が壊れている".to_string())?;
        slot.as_ref()
            .map(|w| w.handle())
            .ok_or("Spout2 の出力を始めていない")?
    };
    // 画像を読み終わるまで待つ（ロックは持たない）
    tauri::async_runtime::spawn_blocking(move || handle.set_textures(bytes))
        .await
        .map_err(join_error)?
}

#[cfg(windows)]
#[tauri::command]
pub async fn spout_submit(
    state: tauri::State<'_, SpoutState>,
    request: Request<'_>,
) -> Result<(), String> {
    let bytes = raw_body(&request)?;
    let handle = {
        let slot = state
            .worker
            .lock()
            .map_err(|_| "Spout2 の状態が壊れている".to_string())?;
        slot.as_ref().map(|w| w.handle())
    };
    match handle {
        Some(h) => h.submit(bytes),
        None => Ok(()), // 止めた直後に届いたものは捨てる
    }
}

#[cfg(windows)]
#[tauri::command]
pub async fn spout_stop(state: tauri::State<'_, SpoutState>) -> Result<(), String> {
    let slot = state.worker.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let old = slot
            .lock()
            .map_err(|_| "Spout2 の状態が壊れている".to_string())?
            .take();
        if let Some(w) = old {
            w.stop();
        }
        Ok(())
    })
    .await
    .map_err(join_error)?
}

#[cfg(windows)]
#[tauri::command]
pub async fn spout_adapters() -> Result<Vec<d3d11::AdapterInfo>, String> {
    tauri::async_runtime::spawn_blocking(d3d11::list_adapters)
        .await
        .map_err(join_error)?
}

#[cfg(windows)]
#[tauri::command]
pub fn spout_status(state: tauri::State<'_, SpoutState>) -> Result<Option<worker::Status>, String> {
    let slot = state
        .worker
        .lock()
        .map_err(|_| "Spout2 の状態が壊れている".to_string())?;
    Ok(slot.as_ref().and_then(worker::Worker::status))
}

// アプリを閉じるときに呼ぶ（送り手を Spout の一覧から消す）
#[cfg(windows)]
pub fn shutdown(state: &SpoutState) {
    let old = state.worker.lock().ok().and_then(|mut slot| slot.take());
    if let Some(w) = old {
        w.stop();
    }
}

// ---- Windows 以外（Spout2 は Windows だけ） ----

#[cfg(not(windows))]
const NOT_WINDOWS: &str = "Spout2 の出力は Windows でだけ使える";

#[cfg(not(windows))]
#[tauri::command]
#[allow(unused_variables)]
pub async fn spout_start(
    width: u32,
    height: u32,
    fps: f64,
    adapter_id: Option<String>,
) -> Result<StartResult, String> {
    Err(NOT_WINDOWS.into())
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn spout_set_textures(request: Request<'_>) -> Result<Vec<String>, String> {
    let _ = raw_body(&request)?;
    Err(NOT_WINDOWS.into())
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn spout_submit(request: Request<'_>) -> Result<(), String> {
    let _ = raw_body(&request)?;
    Err(NOT_WINDOWS.into())
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn spout_stop() -> Result<(), String> {
    Ok(())
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn spout_adapters() -> Result<Vec<serde_json::Value>, String> {
    Err(NOT_WINDOWS.into())
}

#[cfg(not(windows))]
#[tauri::command]
pub fn spout_status() -> Option<serde_json::Value> {
    None
}

#[cfg(not(windows))]
pub fn shutdown(state: &SpoutState) {
    let _ = state;
}
