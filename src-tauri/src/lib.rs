mod ai;
mod git;
mod platform;

use serde::Serialize;

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_repository(path: String) -> Result<git::Repository, String> {
    blocking(move || git::repository(&path)).await
}

#[tauri::command]
async fn get_git_diff(path: String, files: Vec<String>) -> Result<String, String> {
    blocking(move || git::diff(&path, &files)).await
}

#[tauri::command]
async fn commit_changes(
    path: String,
    message: String,
    files: Vec<String>,
) -> Result<String, String> {
    blocking(move || git::commit(&path, &message, &files)).await
}

#[tauri::command]
async fn push_changes(path: String) -> Result<(), String> {
    blocking(move || git::push(&path)).await
}

#[tauri::command]
async fn init_repo(path: String, remote_url: Option<String>) -> Result<(), String> {
    blocking(move || git::init(&path, remote_url.as_deref())).await
}

#[tauri::command]
async fn generate_ai_commit(
    diff: String,
    config: ai::AiConfig,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<String, String> {
    ai::generate(diff, config, &client).await
}

#[tauri::command]
async fn get_models(
    config: ai::AiConfig,
    client: tauri::State<'_, reqwest::Client>,
) -> Result<Vec<String>, String> {
    ai::models(config, &client).await
}

#[derive(Serialize)]
struct LaunchInfo {
    platform: &'static str,
    integration: Option<&'static str>,
    startup_path: Option<String>,
}

#[tauri::command]
async fn get_launch_info() -> Result<LaunchInfo, String> {
    blocking(|| {
        let explicit = std::env::args_os()
            .skip(1)
            .find(|arg| !arg.to_string_lossy().starts_with('-'));
        let startup_path = if let Some(path) = explicit {
            Some(
                path.to_str()
                    .ok_or("The folder path must be valid UTF-8.")?
                    .to_owned(),
            )
        } else {
            std::env::current_dir()
                .ok()
                .and_then(|p| p.to_str().map(str::to_owned))
                .filter(|p| git::repository(p).is_ok())
        };
        Ok(LaunchInfo {
            platform: std::env::consts::OS,
            integration: platform::integration_name(),
            startup_path,
        })
    })
    .await
}

#[tauri::command]
async fn install_context_menu(app: tauri::AppHandle) -> Result<String, String> {
    blocking(move || platform::install(&app)).await
}

#[tauri::command]
async fn uninstall_context_menu(app: tauri::AppHandle) -> Result<String, String> {
    blocking(move || platform::uninstall(&app)).await
}

pub fn run() {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("could not initialize networking");
    tauri::Builder::default()
        .manage(client)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_repository,
            get_git_diff,
            commit_changes,
            push_changes,
            init_repo,
            generate_ai_commit,
            get_models,
            get_launch_info,
            install_context_menu,
            uninstall_context_menu
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitPop");
}
