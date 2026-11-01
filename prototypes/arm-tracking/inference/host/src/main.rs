// AT-01 の試作専用の WebView2 の窓。製品（Tauri）と同じ wry・WebView2 で、試作のページだけを開く。
// ページは独自のスキーム（Windows では http://at01.localhost/）から配り、CSP は製品の tauri.conf.json と同じ値にする。
// Tauri は CSP のヘッダーを HTML の応答にだけ付けるので、既定（--csp html）も同じにする。
use std::{borrow::Cow, fs, path::PathBuf};

use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use wry::{
    http::{header::CONTENT_TYPE, Request, Response},
    PermissionKind, PermissionResponse, WebContext, WebViewBuilder,
};

// apps/desktop/src-tauri/tauri.conf.json の app.security.csp（本番）と同じ
const CSP: &str = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; \
media-src 'self' blob: mediastream:; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; \
base-uri 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' ipc: http://ipc.localhost";

struct Options {
    dist: PathBuf,
    out: PathBuf,
    data: PathBuf,
    csp: String, // html（製品と同じ）・all（全応答）・none
    width: f64,
    height: f64,
    query: String,
}

fn options() -> Options {
    let mut o = Options {
        dist: PathBuf::from("dist"),
        out: PathBuf::from("out"),
        data: PathBuf::from("webview2-data"),
        csp: "html".into(),
        width: 1440.0,
        height: 1000.0,
        query: String::new(),
    };
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i + 1 < args.len() {
        let value = args[i + 1].clone();
        match args[i].as_str() {
            "--dist" => o.dist = value.into(),
            "--out" => o.out = value.into(),
            "--data" => o.data = value.into(),
            "--csp" => o.csp = value,
            "--width" => o.width = value.parse().unwrap_or(o.width),
            "--height" => o.height = value.parse().unwrap_or(o.height),
            "--query" => o.query = value,
            other => panic!("知らない引数: {other}"),
        }
        i += 2;
    }
    o
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "wasm" => "application/wasm",
        "json" => "application/json",
        "css" => "text/css",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

// 保存できる名前は英数字と . _ - だけ。フォルダをまたがない
fn safe_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('.')
        && name.len() <= 120
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

enum UserEvent {
    Saved(String, bool),
}

fn main() {
    let o = options();
    let dist = o.dist.clone();
    let csp_mode = o.csp.clone();
    fs::create_dir_all(&o.out).expect("出力先を作れない");

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("AT-01 推定の試作")
        .with_inner_size(LogicalSize::new(o.width, o.height))
        .build(&event_loop)
        .expect("窓を作れない");

    let mut context = WebContext::new(Some(o.data.clone()));
    let out = o.out.clone();
    let url = format!("http://at01.localhost/index.html{}", o.query);
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_url(url)
        .with_devtools(true)
        .with_custom_protocol("at01".into(), move |_id, request: Request<Vec<u8>>| {
            let path = request.uri().path().trim_start_matches('/').to_string();
            let path = if path.is_empty() { "index.html".to_string() } else { path };
            let file = dist.join(&path);
            let inside = !path.split('/').any(|part| part == ".." || part.is_empty());
            match (inside, fs::read(&file)) {
                (true, Ok(bytes)) => {
                    let mut builder = Response::builder().header(CONTENT_TYPE, mime(&path));
                    if csp_mode == "all" || (csp_mode == "html" && path.ends_with(".html")) {
                        builder = builder.header("Content-Security-Policy", CSP);
                    }
                    builder.body(Cow::Owned(bytes)).unwrap()
                }
                _ => Response::builder().status(404).body(Cow::Borrowed(&b"not found"[..])).unwrap(),
            }
        })
        .with_permission_handler(|kind| match kind {
            PermissionKind::Camera => PermissionResponse::Allow,
            _ => PermissionResponse::Deny,
        })
        .with_ipc_handler(move |request: Request<String>| {
            // {"type":"save","name":"...","text":"..."} を出力先へ書く。それ以外は無視する
            let Ok(message) = serde_json::from_str::<serde_json::Value>(request.body()) else { return };
            if message["type"] != "save" {
                return;
            }
            let name = message["name"].as_str().unwrap_or("").to_string();
            let text = message["text"].as_str().unwrap_or("");
            let ok = safe_name(&name) && fs::write(out.join(&name), text).is_ok();
            let _ = proxy.send_event(UserEvent::Saved(name, ok));
        })
        .build(&window)
        .expect("WebView2 を作れない");

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::UserEvent(UserEvent::Saved(name, ok)) => {
                let script = format!(
                    "window.dispatchEvent(new CustomEvent('at01-saved', {{ detail: {{ name: {}, ok: {} }} }}))",
                    serde_json::Value::String(name),
                    ok
                );
                let _ = webview.evaluate_script(&script);
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => *control_flow = ControlFlow::Exit,
            _ => {}
        }
    });
}
