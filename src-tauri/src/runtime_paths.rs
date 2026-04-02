use super::*;

#[derive(Clone, Debug)]
pub(crate) struct RuntimePaths {
    pub(crate) data_dir: PathBuf,
    pub(crate) logs_dir: PathBuf,
}

pub(crate) fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("project root")
        .to_path_buf()
}

pub(crate) fn runtime_paths(app: &AppHandle) -> Result<RuntimePaths, String> {
    let data_dir = match runtime_data_dir_override() {
        Some(path) => path,
        _ => app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?,
    };
    let logs_dir = data_dir.join(RUNTIME_LOG_DIR);

    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("Failed to prepare desktop data directory: {error}"))?;

    Ok(RuntimePaths { data_dir, logs_dir })
}

pub(crate) fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub(crate) fn environment_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(".env")
}

pub(crate) fn secure_token_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(SECURE_TOKEN_FILE)
}

pub(crate) fn telegram_bot_token_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(TELEGRAM_BOT_TOKEN_FILE)
}

pub(crate) fn config_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join("config.json")
}

pub(crate) fn sender_state_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(".sender-state.json")
}

pub(crate) fn sender_state_lock_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(SENDER_STATE_LOCK_FILE)
}

pub(crate) fn validate_session_id(session_id: &str) -> Result<&str, String> {
    if session_id.is_empty() || session_id.len() > SESSION_ID_MAX_LEN {
        return Err("Invalid session id.".to_string());
    }

    let mut chars = session_id.chars();
    let Some(first) = chars.next() else {
        return Err("Invalid session id.".to_string());
    };

    if !first.is_ascii_alphanumeric() {
        return Err("Invalid session id.".to_string());
    }

    if !chars.all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-') {
        return Err("Invalid session id.".to_string());
    }

    Ok(session_id)
}

pub(crate) fn resolve_session_log_path(paths: &RuntimePaths, session_id: &str) -> Result<PathBuf, String> {
    let valid_session_id = validate_session_id(session_id)?;
    let log_path = paths.logs_dir.join(format!("{valid_session_id}.jsonl"));
    let canonical_logs_dir = paths
        .logs_dir
        .canonicalize()
        .unwrap_or_else(|_| paths.logs_dir.clone());
    let canonical_parent = log_path
        .parent()
        .map(|parent| parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf()))
        .ok_or_else(|| "Invalid session id.".to_string())?;

    if !canonical_parent.starts_with(&canonical_logs_dir) {
        return Err("Invalid session id.".to_string());
    }

    Ok(log_path)
}

pub(crate) fn support_bundle_dir(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(SUPPORT_BUNDLE_DIR)
}

pub(crate) fn current_timestamp() -> String {
    Utc::now().to_rfc3339()
}

pub(crate) fn runtime_data_dir_override() -> Option<PathBuf> {
    env::var_os(APPDATA_OVERRIDE_ENV)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
}

pub(crate) fn open_path_in_file_manager(path: &Path) -> Result<String, String> {
    if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        if path.is_file() {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }

        command
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
    } else {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
    }

    Ok(path_to_string(path))
}
