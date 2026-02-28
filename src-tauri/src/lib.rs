use serde::{Deserialize, Serialize};
use std::process::Command;
use reqwest::Client;
use winreg::enums::*;
use winreg::RegKey;

#[derive(Serialize, Deserialize)]
struct OllamaRequest {
    model: String,
    prompt: String,
    stream: bool,
}

#[derive(Serialize, Deserialize)]
struct OllamaResponse {
    response: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GitFileStatus {
    path: String,
    status: String,
    staged: bool,
}

#[tauri::command]
fn get_git_status(path: &str) -> Result<Vec<GitFileStatus>, String> {
    let output = Command::new("git")
        .current_dir(path)
        .args(["status", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut files = Vec::new();

    for line in stdout.lines() {
        if line.len() < 4 { continue; }
        let status_chars = &line[0..2];
        let file_path = &line[3..];

        let index_status = status_chars.chars().nth(0).unwrap();
        let work_status = status_chars.chars().nth(1).unwrap();
        let staged = index_status != ' ' && index_status != '?';

        let mut status = "U".to_string();
        if status_chars == "??" { status = "U".to_string(); }
        else if index_status == 'A' || work_status == 'A' { status = "A".to_string(); }
        else if index_status == 'M' || work_status == 'M' { status = "M".to_string(); }
        else if index_status == 'D' || work_status == 'D' { status = "D".to_string(); }

        files.push(GitFileStatus {
            path: file_path.trim().to_string(),
            status,
            staged,
        });
    }
    Ok(files)
}

#[tauri::command]
fn get_git_diff(path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .current_dir(path)
        .args(["diff"])
        .output()
        .map_err(|e| e.to_string())?;

    let staged_output = Command::new("git")
        .current_dir(path)
        .args(["diff", "--cached"])
        .output()
        .map_err(|e| e.to_string())?;

    let mut full_diff = String::from_utf8_lossy(&output.stdout).to_string();
    full_diff.push_str(&String::from_utf8_lossy(&staged_output.stdout));
    
    if full_diff.len() > 8000 {
        full_diff.truncate(8000);
        full_diff.push_str("\n... [Diff truncated due to length limitations]");
    }
    Ok(full_diff)
}

#[tauri::command]
fn commit_changes(path: &str, message: &str, files: Vec<String>) -> Result<(), String> {
    // Unstage everything first to match our UI state
    let _ = Command::new("git")
        .current_dir(path)
        .args(["restore", "--staged", "."])
        .output()
        .map_err(|e| e.to_string())?;

    // Stage selected files
    for file in files {
        let out = Command::new("git")
            .current_dir(path)
            .args(["add", &file])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
    }

    // Commit
    let commit_out = Command::new("git")
        .current_dir(path)
        .args(["commit", "-m", message])
        .output()
        .map_err(|e| e.to_string())?;

    if !commit_out.status.success() {
        return Err(String::from_utf8_lossy(&commit_out.stderr).to_string());
    }
    Ok(())
}

#[tauri::command]
async fn generate_ai_commit(diff: String, model: String) -> Result<String, String> {
    let prompt = format!(
        "You are an expert developer. Generate a concise, conventional commit message for the following git diff. Return ONLY the commit message (in the format '<type>: <subject>') without any markdown ticks, extra explanations, or quotes.\n\nDiff:\n{}", 
        diff
    );

    let client = Client::new();
    let req_body = OllamaRequest {
        model,
        prompt,
        stream: false,
    };

    let res = client.post("http://localhost:11434/api/generate")
        .json(&req_body)
        .send()
        .await
        .map_err(|e| format!("Failed to connect to local Ollama (is it running on port 11434?): {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Ollama API error: {}", res.status()));
    }

    let parsed: OllamaResponse = res.json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    Ok(parsed.response.trim().to_string())
}

#[tauri::command]
fn get_startup_dir() -> Result<String, String> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        Ok(args[1].clone())
    } else {
        std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn install_context_menu() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let exe_path = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();

    // 1. Directory Background
    let bg_path = r#"Software\Classes\Directory\Background\shell\GitPop"#;
    let (bg_key, _) = hkcu.create_subkey(bg_path).map_err(|e| e.to_string())?;
    bg_key.set_value("", &"GitPop Here").map_err(|e| e.to_string())?;
    bg_key.set_value("Icon", &format!("\"{}\"", exe_path)).map_err(|e| e.to_string())?;

    let (bg_cmd, _) = bg_key.create_subkey("command").map_err(|e| e.to_string())?;
    bg_cmd.set_value("", &format!("\"{}\" \"%V\"", exe_path)).map_err(|e| e.to_string())?;

    // 2. Directory Folder
    let dir_path = r#"Software\Classes\Directory\shell\GitPop"#;
    let (dir_key, _) = hkcu.create_subkey(dir_path).map_err(|e| e.to_string())?;
    dir_key.set_value("", &"GitPop Here").map_err(|e| e.to_string())?;
    dir_key.set_value("Icon", &format!("\"{}\"", exe_path)).map_err(|e| e.to_string())?;

    let (dir_cmd, _) = dir_key.create_subkey("command").map_err(|e| e.to_string())?;
    dir_cmd.set_value("", &format!("\"{}\" \"%1\"", exe_path)).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn uninstall_context_menu() -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let _ = hkcu.delete_subkey_all(r#"Software\Classes\Directory\Background\shell\GitPop"#);
    let _ = hkcu.delete_subkey_all(r#"Software\Classes\Directory\shell\GitPop"#);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_git_status,
            get_git_diff,
            commit_changes,
            generate_ai_commit,
            get_startup_dir,
            install_context_menu,
            uninstall_context_menu
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
