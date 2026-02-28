use serde::{Deserialize, Serialize};
use std::process::Command;
use reqwest::Client;
use winreg::enums::*;
use winreg::RegKey;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

fn build_hidden_cmd(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

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
pub struct OllamaModel {
    name: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GitFileStatus {
    path: String,
    status: String,
    staged: bool,
}

#[derive(Serialize, Deserialize)]
pub struct AiConfig {
    provider: String, // "ollama", "openai", "gemini", "anthropic", "custom"
    api_key: Option<String>,
    model: String,
    custom_api_url: Option<String>,
}

#[tauri::command]
fn get_git_status(path: &str) -> Result<Vec<GitFileStatus>, String> {
    let output = build_hidden_cmd("git")
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
    let output = build_hidden_cmd("git")
        .current_dir(path)
        .args(["diff"])
        .output()
        .map_err(|e| e.to_string())?;

    let staged_output = build_hidden_cmd("git")
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
    let _ = build_hidden_cmd("git")
        .current_dir(path)
        .args(["restore", "--staged", "."])
        .output();

    // Stage selected files
    for file in files {
        let out = build_hidden_cmd("git")
            .current_dir(path)
            .args(["add", &file])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
    }

    // Commit
    let commit_out = build_hidden_cmd("git")
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
async fn generate_ai_commit(diff: String, config: AiConfig) -> Result<String, String> {
    let prompt = format!(
        "You are an expert developer. Generate a concise, conventional commit message for the following git diff. Return ONLY the commit message (in the format '<type>: <subject>') without any markdown ticks, extra explanations, or quotes.\n\nDiff:\n{}", 
        diff
    );

    let client = Client::builder()
        .timeout(std::time::Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;
        
    match config.provider.as_str() {
        "ollama" => {
            let req_body = OllamaRequest {
                model: config.model,
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
        "openai" => {
            let res = client.post("https://api.openai.com/v1/chat/completions")
                .bearer_auth(config.api_key.unwrap_or_default())
                .json(&serde_json::json!({
                    "model": config.model,
                    "messages": [{"role": "user", "content": prompt}]
                }))
                .send()
                .await
                .map_err(|e| format!("Failed to connect to OpenAI: {}", e))?;
                
            if !res.status().is_success() {
                let error_text = res.text().await.unwrap_or_default();
                return Err(format!("OpenAI API error: {} {}", error_text, "Check your API key."));
            }

            let parsed: serde_json::Value = res.json()
                .await
                .map_err(|e| format!("Failed to parse OpenAI response: {}", e))?;
                
            if let Some(choices) = parsed.get("choices") {
                if let Some(first_choice) = choices.get(0) {
                    if let Some(message) = first_choice.get("message") {
                        if let Some(content) = message.get("content") {
                            return Ok(content.as_str().unwrap_or_default().trim().to_string());
                        }
                    }
                }
            }
            Err("Unexpected response structure from OpenAI".to_string())
        }
        "gemini" => {
            let url = format!("https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}", 
                config.model, config.api_key.unwrap_or_default());
            
            let res = client.post(&url)
                .json(&serde_json::json!({
                    "contents": [{"parts": [{"text": prompt}]}]
                }))
                .send()
                .await
                .map_err(|e| format!("Failed to connect to Gemini: {}", e))?;

            if !res.status().is_success() {
                let error_text = res.text().await.unwrap_or_default();
                return Err(format!("Gemini API error: {} {}", error_text, "Check your API key."));
            }

            let parsed: serde_json::Value = res.json()
                .await
                .map_err(|e| format!("Failed to parse Gemini response: {}", e))?;
                
             if let Some(candidates) = parsed.get("candidates") {
                if let Some(first_candidate) = candidates.get(0) {
                    if let Some(content) = first_candidate.get("content") {
                        if let Some(parts) = content.get("parts") {
                            if let Some(first_part) = parts.get(0) {
                                if let Some(text) = first_part.get("text") {
                                    return Ok(text.as_str().unwrap_or_default().trim().to_string());
                                }
                            }
                        }
                    }
                }
            }
            Err("Unexpected response structure from Gemini".to_string())
        }
        "anthropic" => {
            let res = client.post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", config.api_key.unwrap_or_default())
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json")
                .json(&serde_json::json!({
                    "model": config.model,
                    "max_tokens": 1024,
                    "messages": [{"role": "user", "content": prompt}]
                }))
                .send()
                .await
                .map_err(|e| format!("Failed to connect to Anthropic: {}", e))?;
                
            if !res.status().is_success() {
                let error_text = res.text().await.unwrap_or_default();
                return Err(format!("Anthropic API error: {} {}", error_text, "Check your API key."));
            }

            let parsed: serde_json::Value = res.json()
                .await
                .map_err(|e| format!("Failed to parse Anthropic response: {}", e))?;
                
            if let Some(content_array) = parsed.get("content") {
                if let Some(first_content) = content_array.get(0) {
                    if let Some(text) = first_content.get("text") {
                        return Ok(text.as_str().unwrap_or_default().trim().to_string());
                    }
                }
            }
            Err("Unexpected response structure from Anthropic".to_string())
        }
        "custom" => {
            let base_url = config.custom_api_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string());
            let url = if base_url.ends_with("/chat/completions") {
                base_url
            } else if base_url.ends_with('/') {
                format!("{}chat/completions", base_url)
            } else {
                format!("{}/chat/completions", base_url)
            };

            let res = client.post(&url)
                .bearer_auth(config.api_key.unwrap_or_default())
                .json(&serde_json::json!({
                    "model": config.model,
                    "messages": [{"role": "user", "content": prompt}]
                }))
                .send()
                .await
                .map_err(|e| format!("Failed to connect to Custom endpoint: {}", e))?;
                
            if !res.status().is_success() {
                let error_text = res.text().await.unwrap_or_default();
                return Err(format!("Custom API error: {} {}", error_text, "Check your URL and API key."));
            }

            let parsed: serde_json::Value = res.json()
                .await
                .map_err(|e| format!("Failed to parse Custom endpoint response: {}", e))?;
                
            if let Some(choices) = parsed.get("choices") {
                if let Some(first_choice) = choices.get(0) {
                    if let Some(message) = first_choice.get("message") {
                        if let Some(content) = message.get("content") {
                            return Ok(content.as_str().unwrap_or_default().trim().to_string());
                        }
                    }
                }
            }
            Err("Unexpected response structure from Custom endpoint".to_string())
        }
        _ => Err("Unknown AI provider".to_string()),
    }
}

#[tauri::command]
async fn get_ollama_models() -> Result<Vec<String>, String> {
    let output = build_hidden_cmd("ollama")
        .arg("list")
        .output()
        .map_err(|e| format!("Failed to execute 'ollama list': {}", e))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("'ollama list' failed: {}", err));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut models = Vec::new();

    for line in stdout.lines().skip(1) {
        if let Some(model_name) = line.split_whitespace().next() {
            if !model_name.is_empty() {
                models.push(model_name.to_string());
            }
        }
    }

    Ok(models)
}

#[tauri::command]
fn get_startup_dir() -> Result<String, String> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let mut path = args[1].clone();
        if path.ends_with('"') {
            path.pop();
        }
        Ok(path)
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
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_git_status,
            get_git_diff,
            commit_changes,
            generate_ai_commit,
            get_ollama_models,
            get_startup_dir,
            install_context_menu,
            uninstall_context_menu
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
