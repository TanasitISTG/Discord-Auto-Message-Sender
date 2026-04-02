use super::*;

pub(crate) fn normalize_token(candidate: impl Into<String>) -> Option<String> {
    let token = candidate.into().trim().to_string();
    (!token.is_empty()).then_some(token)
}

fn parse_env_value(raw: &str) -> String {
    serde_json::from_str::<String>(raw)
        .unwrap_or_else(|_| raw.trim().trim_matches('"').trim_matches('\'').to_string())
}

pub(crate) fn read_plaintext_token_from_env_file(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))?;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        if key.trim() != "DISCORD_TOKEN" {
            continue;
        }

        return Ok(normalize_token(parse_env_value(value)));
    }

    Ok(None)
}

pub(crate) fn scrub_discord_token_from_env_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))?;
    let Some(next_contents) = scrub_discord_token_from_env_contents(&contents) else {
        if contents.lines().count() == 0 {
            return Ok(());
        }

        fs::remove_file(path).map_err(|error| {
            format!(
                "Failed to remove '{}' after token migration: {error}",
                path.display()
            )
        })?;
        return Ok(());
    };

    if next_contents == contents {
        return Ok(());
    }

    fs::write(path, next_contents).map_err(|error| {
        format!(
            "Failed to update '{}' after token migration: {error}",
            path.display()
        )
    })
}

pub(crate) fn scrub_discord_token_from_env_contents(contents: &str) -> Option<String> {
    let next_lines = contents
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !(trimmed.starts_with("DISCORD_TOKEN=") || trimmed.starts_with("DISCORD_TOKEN ="))
        })
        .collect::<Vec<_>>();

    if next_lines.is_empty() {
        return None;
    }

    Some(format!("{}\n", next_lines.join("\n")))
}

pub(crate) fn token_storage_mode(secure_present: bool) -> TokenStorageMode {
    if secure_present {
        TokenStorageMode::Secure
    } else {
        TokenStorageMode::Missing
    }
}

#[cfg(target_os = "windows")]
fn blob_from_bytes(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    }
}

#[cfg(target_os = "windows")]
fn protect_token(token: &str) -> Result<Vec<u8>, String> {
    let input = blob_from_bytes(token.as_bytes());
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| "Failed to encrypt the Discord token with Windows DPAPI.".to_string())?;
    }

    let encrypted =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut core::ffi::c_void)));
    }

    Ok(encrypted)
}

#[cfg(target_os = "windows")]
fn unprotect_token(bytes: &[u8]) -> Result<String, String> {
    let input = blob_from_bytes(bytes);
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| {
            "Stored Discord token could not be decrypted. Save it again from Desktop Setup."
                .to_string()
        })?;
    }

    let decrypted =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut core::ffi::c_void)));
    }

    String::from_utf8(decrypted).map_err(|_| {
        "Stored Discord token is not valid UTF-8. Save it again from Desktop Setup.".to_string()
    })
}

#[cfg(not(target_os = "windows"))]
fn protect_token(_token: &str) -> Result<Vec<u8>, String> {
    Err("Secure Discord token storage is only supported on Windows builds right now.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_token(_bytes: &[u8]) -> Result<String, String> {
    Err("Secure Discord token storage is only supported on Windows builds right now.".to_string())
}

pub(crate) fn read_secure_token(paths: &RuntimePaths) -> Result<Option<String>, String> {
    let secure_path = secure_token_path(paths);
    if !secure_path.exists() {
        return Ok(None);
    }

    let encrypted = fs::read(&secure_path)
        .map_err(|error| format!("Failed to read '{}': {error}", secure_path.display()))?;
    let token = unprotect_token(&encrypted)?;
    Ok(normalize_token(token))
}

pub(crate) fn write_secure_token(paths: &RuntimePaths, token: &str) -> Result<(), String> {
    let encrypted = protect_token(token)?;
    fs::write(secure_token_path(paths), encrypted)
        .map_err(|error| format!("Failed to write the secure Discord token store: {error}"))
}

pub(crate) fn clear_secure_token_files(paths: &RuntimePaths) -> Result<(), String> {
    let secure_path = secure_token_path(paths);
    if secure_path.exists() {
        fs::remove_file(&secure_path)
            .map_err(|error| format!("Failed to remove '{}': {error}", secure_path.display()))?;
    }

    scrub_discord_token_from_env_file(&environment_path(paths))
}

pub(crate) fn read_telegram_bot_token(paths: &RuntimePaths) -> Result<Option<String>, String> {
    let secure_path = telegram_bot_token_path(paths);
    if !secure_path.exists() {
        return Ok(None);
    }

    let encrypted = fs::read(&secure_path)
        .map_err(|error| format!("Failed to read '{}': {error}", secure_path.display()))?;
    let token = unprotect_token(&encrypted)?;
    Ok(normalize_token(token))
}

pub(crate) fn write_telegram_bot_token(paths: &RuntimePaths, token: &str) -> Result<(), String> {
    let encrypted = protect_token(token)?;
    fs::write(telegram_bot_token_path(paths), encrypted)
        .map_err(|error| format!("Failed to write the secure Telegram bot token store: {error}"))
}

pub(crate) fn clear_telegram_bot_token_files(paths: &RuntimePaths) -> Result<(), String> {
    let secure_path = telegram_bot_token_path(paths);
    if secure_path.exists() {
        fs::remove_file(&secure_path)
            .map_err(|error| format!("Failed to remove '{}': {error}", secure_path.display()))?;
    }

    Ok(())
}

pub(crate) fn read_desktop_setup_state(paths: &RuntimePaths) -> Result<DesktopSetupState, String> {
    let secure_store_path = secure_token_path(&paths);
    let env_path = environment_path(&paths);

    let (secure_token, warning) = match read_secure_token(&paths) {
        Ok(token) => (token, None),
        Err(error) => (None, Some(error)),
    };
    let token_present = secure_token.is_some();
    let token_storage = token_storage_mode(secure_token.is_some());

    Ok(DesktopSetupState {
        token_present,
        token_storage,
        data_dir: path_to_string(&paths.data_dir),
        secure_store_path: path_to_string(&secure_store_path),
        env_path: path_to_string(&env_path),
        config_path: path_to_string(&config_path(paths)),
        state_path: path_to_string(&sender_state_path(paths)),
        logs_dir: path_to_string(&paths.logs_dir),
        warning,
    })
}

pub(crate) fn load_desktop_setup_state(app: &AppHandle) -> Result<DesktopSetupState, String> {
    let paths = runtime_paths(app)?;
    read_desktop_setup_state(&paths)
}

pub(crate) fn save_secure_environment(
    app: &AppHandle,
    request: SaveEnvironmentRequest,
) -> Result<DesktopSetupState, String> {
    let normalized_token = normalize_token(request.discord_token)
        .ok_or_else(|| "DISCORD_TOKEN cannot be empty.".to_string())?;
    let paths = runtime_paths(app)?;
    write_secure_token(&paths, &normalized_token)?;
    scrub_discord_token_from_env_file(&environment_path(&paths))?;
    read_desktop_setup_state(&paths)
}

pub(crate) fn clear_secure_environment(app: &AppHandle) -> Result<DesktopSetupState, String> {
    let paths = runtime_paths(app)?;
    clear_secure_token_files(&paths)?;
    read_desktop_setup_state(&paths)
}
