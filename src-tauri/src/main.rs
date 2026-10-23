// Windows のリリースビルドで、余計なコンソールウィンドウを出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cc_auto_review_lib::run();
}
