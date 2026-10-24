//! デスクトップアプリの殻。
//!
//! 画面と API はどちらも同梱のサーバが配る。サーバは 1 つにまとめた JS（server.js）で、
//! sidecar の txiki.js（tjs）が動かす。
//! このアプリは sidecar を 127.0.0.1 の空いているポートで起動し、準備ができたら
//! ウィンドウをその URL に向ける。localhost のほかのアプリから API を叩かせないよう、
//! 起動のたびに作った合言葉を sidecar とウィンドウにだけ渡す。
//!
//! sidecar の起動に tauri-plugin-shell は使わない。regex などを引き込んでアプリが大きくなるので、
//! std::process で起動する

use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent, WebviewWindow};

/// sidecar が準備できたときに標準出力に出す行の頭
const READY_PREFIX: &str = "CC_AUTO_REVIEW_READY ";

/// sidecar の名前。Tauri はアプリの実行ファイルと同じディレクトリに、ターゲットの triple を外して置く
const SIDECAR: &str = "cc-auto-review-server";

/// 終了するときに止める sidecar
struct Server(Arc<Mutex<Option<Child>>>);

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
    let sidecar = std::env::current_exe()?.with_file_name(SIDECAR);
    let token = new_token();

    let mut child = Command::new(&sidecar)
        .arg("run")
        .arg(&server_js)
        .args(["--desktop", "--port", "0", "--client-dir"])
        .arg(&client_dir)
        .env("CC_AUTO_REVIEW_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{}: {e}", sidecar.display()))?;
    let stdout = child.stdout.take().ok_or("the sidecar has no stdout")?;
    let stderr = child.stderr.take().ok_or("the sidecar has no stderr")?;
    let server = app.state::<Server>().0.clone();
    server.lock().unwrap().replace(child);

    // 起動できなかったときに見せるため、エラー出力を覚えておく
    let errors = thread::spawn(move || {
        let mut errors = String::new();
        for line in split_lines(stderr) {
            eprint!("{line}");
            errors.push_str(&line);
        }
        errors
    });

    thread::spawn(move || {
        let mut ready = false;
        // 準備ができた後も読み続ける。読まないとパイプが詰まって sidecar が止まる
        for line in split_lines(stdout) {
            if ready {
                continue;
            }
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
        // 標準出力が閉じたのは sidecar が終わったとき
        if !ready {
            let errors = errors.join().unwrap_or_default();
            let code = server
                .lock()
                .unwrap()
                .as_mut()
                .and_then(|child| child.wait().ok())
                .and_then(|status| status.code())
                .map_or("?".into(), |c| c.to_string());
            show_error(&window, &format!("{}\n(exit code {code})", errors.trim()));
        }
    });
    Ok(())
}

/// 改行を残したまま 1 行ずつ読む。UTF-8 でないバイトは置き換える
fn split_lines(reader: impl Read) -> impl Iterator<Item = String> {
    let mut reader = BufReader::new(reader);
    std::iter::from_fn(move || {
        let mut buf = Vec::new();
        match reader.read_until(b'\n', &mut buf) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(String::from_utf8_lossy(&buf).into_owned()),
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Server(Arc::new(Mutex::new(None))))
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
                if let Some(mut child) = app.state::<Server>().0.lock().unwrap().take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        });
}
