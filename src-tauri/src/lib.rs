//! デスクトップアプリの殻。
//!
//! 画面と API はどちらも同梱のサーバが配る。サーバは 1 つにまとめた JS（server.js）で、
//! sidecar の txiki.js（tjs）が動かす。
//! このアプリは sidecar を 127.0.0.1 の空いているポートで起動し、準備ができたら
//! ウィンドウをその URL に向ける。localhost のほかのアプリから API を叩かせないよう、
//! 起動のたびに作った合言葉を sidecar とウィンドウにだけ渡す。

use std::io::Read;
use std::sync::Mutex;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent, WebviewWindow};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// sidecar が準備できたときに標準出力に出す行の頭
const READY_PREFIX: &str = "CC_AUTO_REVIEW_READY ";

/// 終了するときに止める sidecar
struct Server(Mutex<Option<CommandChild>>);

/// 推測できない合言葉。OS の乱数から 32 バイトを読んで 16 進にする
fn new_token() -> String {
    let mut bytes = [0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut bytes))
        .expect("could not read /dev/urandom");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// 起動待ちの画面に、起動できなかった理由を出す
fn show_error(window: &WebviewWindow, message: &str) {
    let text = serde_json::to_string(message).unwrap_or_else(|_| "\"\"".into());
    let _ = window.eval(&format!("window.showError && window.showError({text})"));
}

fn start_server(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let window = app
        .get_webview_window("main")
        .ok_or("the main window is missing")?;
    let client_dir = app.path().resolve("client", BaseDirectory::Resource)?;
    let server_js = app.path().resolve("server.js", BaseDirectory::Resource)?;
    let token = new_token();

    let (mut events, child) = app
        .shell()
        .sidecar("cc-auto-review-server")?
        .args([
            "run",
            &server_js.to_string_lossy(),
            "--desktop",
            "--port",
            "0",
            "--client-dir",
            &client_dir.to_string_lossy(),
        ])
        .env("CC_AUTO_REVIEW_TOKEN", &token)
        .spawn()?;
    app.state::<Server>().0.lock().unwrap().replace(child);

    tauri::async_runtime::spawn(async move {
        // 起動できなかったときに見せるため、エラー出力を覚えておく
        let mut errors = String::new();
        let mut ready = false;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let line = String::from_utf8_lossy(&line);
                    if let Some(url) = line.trim().strip_prefix(READY_PREFIX) {
                        match url::Url::parse(&format!("{url}/?token={token}")) {
                            Ok(target) => {
                                ready = true;
                                let _ = window.navigate(target);
                            }
                            Err(error) => show_error(&window, &error.to_string()),
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    let line = String::from_utf8_lossy(&line);
                    eprint!("{line}");
                    errors.push_str(&line);
                }
                CommandEvent::Error(error) => errors.push_str(&error),
                CommandEvent::Terminated(status) => {
                    if !ready {
                        let code = status.code.map_or("?".into(), |c| c.to_string());
                        show_error(&window, &format!("{}\n(exit code {code})", errors.trim()));
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            if let Err(error) = start_server(app.handle()) {
                if let Some(window) = app.get_webview_window("main") {
                    show_error(&window, &error.to_string());
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app.state::<Server>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
