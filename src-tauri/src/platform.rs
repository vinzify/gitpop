#[cfg(target_os = "linux")]
use tauri::Manager;

pub fn integration_name() -> Option<&'static str> {
    if cfg!(windows) {
        Some("Windows Explorer")
    } else if cfg!(target_os = "linux") {
        Some("KDE Dolphin")
    } else {
        None
    }
}

#[cfg(any(target_os = "linux", test))]
fn desktop_exec(path: &str) -> Result<String, String> {
    if path.chars().any(char::is_control) || path.contains('=') {
        return Err("This executable path cannot be represented safely in a desktop entry.".into());
    }
    let mut escaped = String::from("\"");
    for character in path.chars() {
        match character {
            '\\' => escaped.push_str("\\\\\\\\"),
            '"' => escaped.push_str("\\\\\""),
            '$' | '`' => {
                escaped.push_str("\\\\");
                escaped.push(character);
            }
            '%' => escaped.push_str("%%"),
            _ => escaped.push(character),
        }
    }
    escaped.push_str("\" %f");
    Ok(escaped)
}

#[cfg(target_os = "linux")]
fn service_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .data_dir()
        .map(|p| p.join("kio/servicemenus/gitpop.desktop"))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
pub fn install(app: &tauri::AppHandle) -> Result<String, String> {
    use std::os::unix::fs::PermissionsExt;
    let target = service_path(app)?;
    if target.exists()
        && !std::fs::read_to_string(&target)
            .map_err(|e| e.to_string())?
            .contains("X-GitPop-Managed=true")
    {
        return Err(
            "An existing unmanaged GitPop service menu was found. Nothing was overwritten.".into(),
        );
    }
    let executable = std::env::var_os("APPIMAGE")
        .map(std::path::PathBuf::from)
        .map_or_else(std::env::current_exe, Ok)
        .map_err(|e| e.to_string())?;
    let exec = desktop_exec(
        executable
            .to_str()
            .ok_or("The executable path must be UTF-8.")?,
    )?;
    std::fs::create_dir_all(target.parent().ok_or("Invalid service menu path.")?)
        .map_err(|e| e.to_string())?;
    std::fs::write(&target, format!("[Desktop Entry]\nType=Service\nMimeType=inode/directory;\nActions=GitPop;\nX-KDE-Priority=TopLevel\nX-KDE-RequiredNumberOfUrls=1\nX-GitPop-Managed=true\n\n[Desktop Action GitPop]\nName=Open in GitPop\nIcon=git\nExec={exec}\n")).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| e.to_string())?;
    Ok("Installed for your user. Restart Dolphin if the menu does not appear. Keep the executable at its current location.".into())
}

#[cfg(target_os = "linux")]
pub fn uninstall(app: &tauri::AppHandle) -> Result<String, String> {
    let target = service_path(app)?;
    if target.exists() {
        let content = std::fs::read_to_string(&target).map_err(|e| e.to_string())?;
        if !content.contains("X-GitPop-Managed=true") {
            return Err("This menu was not installed by GitPop; nothing was removed.".into());
        }
        std::fs::remove_file(target).map_err(|e| e.to_string())?;
    }
    Ok("Removed GitPop's Dolphin service menu. No repositories or settings were removed.".into())
}

#[cfg(windows)]
pub fn install(_: &tauri::AppHandle) -> Result<String, String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let root = RegKey::predef(HKEY_CURRENT_USER);
    let exe = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .into_owned();
    for (key, argument) in [
        (r"Software\Classes\Directory\Background\shell\GitPop", "%V"),
        (r"Software\Classes\Directory\shell\GitPop", "%1"),
    ] {
        let (menu, _) = root.create_subkey(key).map_err(|e| e.to_string())?;
        menu.set_value("", &"Open in GitPop")
            .map_err(|e| e.to_string())?;
        menu.set_value("Icon", &exe).map_err(|e| e.to_string())?;
        let (cmd, _) = menu.create_subkey("command").map_err(|e| e.to_string())?;
        cmd.set_value("", &format!("\"{exe}\" \"{argument}\""))
            .map_err(|e| e.to_string())?;
    }
    Ok("Installed the per-user Explorer context menu.".into())
}

#[cfg(windows)]
pub fn uninstall(_: &tauri::AppHandle) -> Result<String, String> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    let root = RegKey::predef(HKEY_CURRENT_USER);
    for key in [
        r"Software\Classes\Directory\Background\shell\GitPop",
        r"Software\Classes\Directory\shell\GitPop",
    ] {
        match root.delete_subkey_all(key) {
            Ok(()) => (),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok("Removed GitPop's Explorer context menu.".into())
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn install(_: &tauri::AppHandle) -> Result<String, String> {
    Err("Use Open repository or the command line on this platform.".into())
}
#[cfg(not(any(windows, target_os = "linux")))]
pub fn uninstall(_: &tauri::AppHandle) -> Result<String, String> {
    Err("There is no context-menu integration on this platform.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn desktop_entry_escapes_paths_not_shell_commands() {
        assert_eq!(
            desktop_exec("/opt/Git Pop/GitPop").unwrap(),
            "\"/opt/Git Pop/GitPop\" %f"
        );
        assert_eq!(
            desktop_exec("/opt/50%/app").unwrap(),
            "\"/opt/50%%/app\" %f"
        );
        assert!(desktop_exec("/tmp/app\nExec=bad").is_err());
        assert!(desktop_exec("/tmp/a=b").is_err());
        assert!(desktop_exec("/tmp/$app").unwrap().contains("\\\\$app"));
    }
}
