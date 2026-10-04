// リリース版でコンソールウィンドウを出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    live2d_studio_lib::run()
}
