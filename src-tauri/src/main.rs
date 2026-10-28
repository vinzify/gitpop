// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--help" || arg == "-h") {
        println!("GitPop — a focused Git workbench\n\nUsage: gitpop [FOLDER]\n\nOpen a repository or choose one in the app. Git must be installed.\n--help     Show this help\n--version  Show the version");
        return;
    }
    if std::env::args().any(|arg| arg == "--version" || arg == "-V") {
        println!("GitPop {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    tauri_appgitpop_lib::run()
}
