use tauri::Manager;

mod output; // Spout2 出力（カード41）

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .manage(output::SpoutState::default())
        .invoke_handler(tauri::generate_handler![
            output::spout_start,
            output::spout_set_textures,
            output::spout_submit,
            output::spout_stop,
            output::spout_adapters,
            output::spout_status
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                media_permission::allow_camera_and_microphone(&window);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("アプリの起動に失敗した")
        .run(|app, event| {
            // 閉じるときに Spout2 の送り手を一覧から消す
            if let tauri::RunEvent::Exit = event {
                output::shutdown(&app.state::<output::SpoutState>());
            }
        });
}

// WebView2 でカメラとマイクを使うとき、権限の確認をアプリ側で許可する
#[cfg(windows)]
mod media_permission {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    pub fn allow_camera_and_microphone(window: &tauri::WebviewWindow) {
        let _ = window.with_webview(|webview| unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else {
                return;
            };
            let handler = PermissionRequestedEventHandler::create(Box::new(
                |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                    if let Some(args) = args {
                        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                        args.PermissionKind(&mut kind)?;
                        if kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                            || kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE
                        {
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                        }
                    }
                    Ok(())
                },
            ));
            let mut token = Default::default();
            let _ = core.add_PermissionRequested(&handler, &mut token);
        });
    }
}

#[cfg(not(windows))]
mod media_permission {
    pub fn allow_camera_and_microphone(_window: &tauri::WebviewWindow) {}
}
