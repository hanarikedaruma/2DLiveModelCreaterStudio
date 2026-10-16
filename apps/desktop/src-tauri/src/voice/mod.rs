// AI音声ホストを所有する。PCMは画面の解析用だけで、音声出力はWASAPIから直接送る。
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, Manager};

type Reply = Result<Value, String>;
type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Reply>>>>;

struct HostProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct VoiceState {
    host: Mutex<Option<HostProcess>>,
    channel: Arc<Mutex<Option<Channel<Value>>>>,
    next_id: AtomicU64,
    closing: AtomicBool,
}

fn engine_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("voice-engine");
    if bundled.join("host.py").is_file() {
        return Ok(bundled);
    }
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../tools/voice-engine");
    if development.join("host.py").is_file() {
        return Ok(development);
    }
    Err("AI音声エンジンがありません。アプリの導入を確認してください".into())
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice");
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn hidden(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
}

fn kill_owned(child: &mut Child) {
    // Windowsのvenv launcherと推論workerをまとめて、自分のPID以下だけ止める。
    #[cfg(windows)]
    if child.try_wait().ok().flatten().is_none() {
        let mut command = Command::new("taskkill.exe");
        command.args(["/PID", &child.id().to_string(), "/T", "/F"]);
        hidden(&mut command);
        let _ = command.stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn send_event(channel: &Arc<Mutex<Option<Channel<Value>>>>, event: Value) {
    if let Ok(current) = channel.lock() {
        if let Some(target) = current.as_ref() {
            let _ = target.send(event);
        }
    }
}

fn ensure_host(app: &tauri::AppHandle, state: &VoiceState) -> Result<(), String> {
    let mut guard = state.host.lock().map_err(|e| e.to_string())?;
    if state.closing.load(Ordering::Acquire) {
        return Err("アプリを終了しています".into());
    }
    if let Some(existing) = guard.as_mut() {
        if existing.alive.load(Ordering::Acquire)
            && existing
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
        {
            return Ok(());
        }
        kill_owned(&mut existing.child);
        *guard = None;
    }
    let engine = engine_dir(app)?;
    let data = data_dir(app)?;
    let own_config = data.join("runtime.json");
    let config_path = if own_config.is_file() {
        own_config
    } else {
        engine.join("runtime.json")
    };
    let config_bytes = fs::read(config_path)
        .map_err(|_| "AI音声の準備が必要です。Pythonとモデルの保存先を設定してください")?;
    // Windows PowerShell 5.1のSet-Content -Encoding utf8はBOMを付ける。
    let config: Value = serde_json::from_slice(
        config_bytes
            .strip_prefix(b"\xef\xbb\xbf")
            .unwrap_or(&config_bytes),
    )
    .map_err(|e| e.to_string())?;
    let python = config["python"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Pythonが未設定です")?;
    if !PathBuf::from(python).is_file() {
        return Err("音声用のPythonが見つかりません。実行環境を設定してください".into());
    }
    let mut command = Command::new(python);
    command
        .args(["-X", "utf8", "-u"])
        .arg(engine.join("host.py"))
        .arg("--data")
        .arg(&data);
    if let Some(root) = config["modelRoot"].as_str() {
        command.arg("--model-root").arg(root);
    }
    command
        .current_dir(&engine)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped());
    let log = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(data.join("voice-host.log"))
        .map_err(|e| e.to_string())?;
    command.stderr(Stdio::from(log));
    hidden(&mut command);
    let mut child = command
        .spawn()
        .map_err(|e| format!("音声エンジンを起動できません: {e}"))?;
    let stdin = Arc::new(Mutex::new(
        child
            .stdin
            .take()
            .ok_or("音声エンジンへの接続がありません")?,
    ));
    let stdout = child
        .stdout
        .take()
        .ok_or("音声エンジンの応答接続がありません")?;
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));
    let responses = pending.clone();
    let alive = Arc::new(AtomicBool::new(true));
    let reader_alive = alive.clone();
    let channel = state.channel.clone();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut bytes = Vec::new();
            // 1メッセージの上限。壊れた出力でメモリを無制限に使わない。
            let result = (&mut reader).take(131073).read_until(b'\n', &mut bytes);
            if !matches!(result, Ok(n) if n > 0 && n <= 131072 && bytes.last() == Some(&b'\n')) {
                break;
            }
            let Ok(value) = serde_json::from_slice::<Value>(&bytes) else {
                break;
            };
            if value["kind"] == "response" {
                if let Some(id) = value["id"].as_u64() {
                    if let Ok(mut waiting) = responses.lock() {
                        if let Some(reply) = waiting.remove(&id) {
                            let response = if value["ok"] == true {
                                Ok(value["value"].clone())
                            } else {
                                Err(value["error"]
                                    .as_str()
                                    .unwrap_or("音声操作に失敗しました")
                                    .to_string())
                            };
                            let _ = reply.send(response);
                        }
                    }
                }
            } else {
                send_event(&channel, value);
            }
        }
        if let Ok(mut waiting) = responses.lock() {
            for (_, sender) in waiting.drain() {
                let _ = sender.send(Err("音声エンジンとの接続が終了しました".into()));
            }
        }
        reader_alive.store(false, Ordering::Release);
        send_event(
            &channel,
            json!({"kind":"disconnected","error":"音声エンジンとの接続が終了しました"}),
        );
    });
    *guard = Some(HostProcess {
        child,
        stdin,
        pending,
        alive,
    });
    Ok(())
}

#[tauri::command]
pub fn voice_connect(
    app: tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
    channel: Channel<Value>,
) -> Result<(), String> {
    *state.channel.lock().map_err(|e| e.to_string())? = Some(channel);
    ensure_host(&app, &state)
}

#[tauri::command]
pub async fn voice_request(app: tauri::AppHandle, action: String, payload: Value) -> Reply {
    let allowed = [
        "clock",
        "inspect",
        "inspectSpeech",
        "speak",
        "prepareSpeechDraft",
        "discardSpeechDraft",
        "clearSpeechHistory",
        "releaseSpeech",
        "configure",
        "importReference",
        "previewReference",
        "importProfile",
        "readFilters",
        "saveFilters",
        "persistReferences",
        "start",
        "controls",
        "stop",
        "exportProfile",
        "convert",
    ];
    if !allowed.contains(&action.as_str()) {
        return Err("未対応の音声操作です".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<VoiceState>();
        ensure_host(&app, &state)?;
        let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (sender, receiver) = mpsc::channel();
        let (stdin, pending) = {
            let guard = state.host.lock().map_err(|e| e.to_string())?;
            let host = guard.as_ref().ok_or("音声エンジンがありません")?;
            (host.stdin.clone(), host.pending.clone())
        };
        let mut bytes = serde_json::to_vec(&json!({"id":id,"action":action,"payload":payload}))
            .map_err(|e| e.to_string())?;
        if bytes.len() > 65535 {
            return Err("音声設定のデータが大きすぎます".into());
        }
        bytes.push(b'\n');
        pending
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id, sender);
        let result = (|| {
            let mut input = stdin.lock().map_err(|e| e.to_string())?;
            input
                .write_all(&bytes)
                .and_then(|_| input.flush())
                .map_err(|e| e.to_string())?;
            drop(input);
            receiver
                .recv_timeout(Duration::from_secs(30))
                .map_err(|_| "音声エンジンの応答が時間内に届きませんでした".to_string())?
        })();
        if let Ok(mut waiting) = pending.lock() {
            waiting.remove(&id);
        }
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn voice_configure_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, VoiceState>,
    python: String,
    model_root: String,
) -> Result<(), String> {
    if !PathBuf::from(&python).is_file()
        || !PathBuf::from(&model_root)
            .join("external/seed-vc/inference.py")
            .is_file()
    {
        return Err("音声用PythonとAIモデルの保存先を確認してください".into());
    }
    shutdown(&state);
    let config = json!({"python":python,"modelRoot":model_root});
    fs::write(
        data_dir(&app)?.join("runtime.json"),
        serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

pub fn shutdown(state: &VoiceState) {
    if let Ok(mut guard) = state.host.lock() {
        if let Some(mut host) = guard.take() {
            // アプリ終了では専用プロセスツリーだけを終了し、他アプリには触れない。
            kill_owned(&mut host.child);
        }
    }
}

pub fn shutdown_app(state: &VoiceState) {
    // 終了中の画面から届く最後の要求で、モデルを起動し直さない。
    state.closing.store(true, Ordering::Release);
    shutdown(state);
}
