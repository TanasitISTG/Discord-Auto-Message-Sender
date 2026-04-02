use super::*;

struct SenderStateLockGuard {
    path: PathBuf,
    file: Option<fs::File>,
}

impl Drop for SenderStateLockGuard {
    fn drop(&mut self) {
        drop(self.file.take());
        let _ = fs::remove_file(&self.path);
    }
}

fn remove_stale_sender_state_lock(lock_path: &Path) {
    let Ok(metadata) = fs::metadata(lock_path) else {
        return;
    };
    let Ok(modified_at) = metadata.modified() else {
        return;
    };
    if SystemTime::now()
        .duration_since(modified_at)
        .unwrap_or_default()
        >= Duration::from_millis(SENDER_STATE_LOCK_STALE_MS)
    {
        let _ = fs::remove_file(lock_path);
    }
}

fn acquire_sender_state_lock(paths: &RuntimePaths) -> Result<SenderStateLockGuard, String> {
    let lock_path = sender_state_lock_path(paths);
    fs::create_dir_all(&paths.data_dir).map_err(|error| {
        format!(
            "Failed to prepare sender state directory '{}': {error}",
            paths.data_dir.display()
        )
    })?;

    let started_at = Instant::now();
    loop {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let contents = format!(
                    "pid={}\nacquiredAt={}\n",
                    std::process::id(),
                    current_timestamp()
                );
                file.write_all(contents.as_bytes()).map_err(|error| {
                    format!(
                        "Failed to write sender state lock '{}': {error}",
                        lock_path.display()
                    )
                })?;
                return Ok(SenderStateLockGuard {
                    path: lock_path,
                    file: Some(file),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                remove_stale_sender_state_lock(&lock_path);
                if started_at.elapsed() >= Duration::from_millis(SENDER_STATE_LOCK_TIMEOUT_MS) {
                    return Err(format!(
                        "Timed out waiting for exclusive access to '{}'.",
                        sender_state_path(paths).display()
                    ));
                }
                std::thread::sleep(Duration::from_millis(SENDER_STATE_LOCK_RETRY_MS));
            }
            Err(error) => {
                return Err(format!(
                    "Failed to create sender state lock '{}': {error}",
                    lock_path.display()
                ));
            }
        }
    }
}

pub(crate) fn write_text_file_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    fs::write(&temp_path, contents).map_err(|error| {
        format!(
            "Failed to write temporary file '{}': {error}",
            temp_path.display()
        )
    })?;

    if let Err(error) = fs::rename(&temp_path, path) {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        fs::rename(&temp_path, path).map_err(|rename_error| {
            format!(
                "Failed to replace '{}' after temporary write error '{}': {rename_error}",
                path.display(),
                error
            )
        })?;
    }

    Ok(())
}

pub(crate) fn load_sender_state_record(paths: &RuntimePaths) -> Result<SenderStateRecord, String> {
    let state_path = sender_state_path(paths);
    if !state_path.exists() {
        return Ok(SenderStateRecord {
            schema_version: 1,
            last_session: None,
            summaries: Vec::new(),
            recent_failures: Vec::new(),
            recent_message_history: Some(HashMap::new()),
            channel_health: Some(HashMap::new()),
            resume_session: None,
            inbox_monitor: None,
            notification_delivery: Some(default_notification_delivery_snapshot()),
            warning: None,
        });
    }

    let contents = fs::read_to_string(&state_path)
        .map_err(|error| format!("Failed to read '{}': {error}", state_path.display()))?;
    let mut state: SenderStateRecord = serde_json::from_str(&contents)
        .map_err(|error| format!("Failed to parse '{}': {error}", state_path.display()))?;
    if state.notification_delivery.is_none() {
        state.notification_delivery = Some(default_notification_delivery_snapshot());
    }
    Ok(state)
}

pub(crate) fn save_sender_state_record_unlocked(
    paths: &RuntimePaths,
    state: &SenderStateRecord,
) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Failed to serialize sender state: {error}"))?;
    write_text_file_atomically(&sender_state_path(paths), contents.as_bytes())
}

pub(crate) fn update_sender_state_record<F>(
    paths: &RuntimePaths,
    updater: F,
) -> Result<SenderStateRecord, String>
where
    F: FnOnce(&mut SenderStateRecord),
{
    let _guard = acquire_sender_state_lock(paths)?;
    let mut state = load_sender_state_record(paths)?;
    updater(&mut state);
    save_sender_state_record_unlocked(paths, &state)?;
    load_sender_state_record(paths)
}
