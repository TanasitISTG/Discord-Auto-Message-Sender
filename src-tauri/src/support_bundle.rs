use super::*;

pub(crate) fn build_release_diagnostics(
    paths: &RuntimePaths,
    app_version: &str,
    token_storage: TokenStorageMode,
    sidecar_status: SidecarStatus,
) -> ReleaseDiagnostics {
    ReleaseDiagnostics {
        app_version: app_version.to_string(),
        data_dir: path_to_string(&paths.data_dir),
        logs_dir: path_to_string(&paths.logs_dir),
        config_path: path_to_string(&config_path(paths)),
        state_path: path_to_string(&sender_state_path(paths)),
        secure_store_path: path_to_string(&secure_token_path(paths)),
        token_storage,
        sidecar_status,
    }
}

pub(crate) fn load_release_diagnostics_state(app: &AppHandle) -> Result<ReleaseDiagnostics, String> {
    let paths = runtime_paths(app)?;
    let setup_state = read_desktop_setup_state(&paths)?;
    let sidecar_status = sidecar_status_value(app)?;
    Ok(build_release_diagnostics(
        &paths,
        &app.package_info().version.to_string(),
        setup_state.token_storage.clone(),
        sidecar_status,
    ))
}

pub(crate) fn sanitize_telegram_error(message: String, token: Option<&str>) -> String {
    let Some(token) = token.filter(|value| !value.is_empty()) else {
        return message;
    };

    message.replace(token, "[REDACTED]")
}

fn support_bundle_file_name() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("discord-auto-message-sender-support-{timestamp}.zip")
}

fn latest_log_files(paths: &RuntimePaths, limit: usize) -> Result<Vec<PathBuf>, String> {
    if !paths.logs_dir.exists() {
        return Ok(Vec::new());
    }

    let mut files = Vec::new();
    for entry in fs::read_dir(&paths.logs_dir)
        .map_err(|error| format!("Failed to read logs directory '{}': {error}", paths.logs_dir.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to read a log file entry: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        files.push((modified, path));
    }

    files.sort_by(|left, right| {
        right.0
            .cmp(&left.0)
            .then_with(|| right.1.cmp(&left.1))
    });

    Ok(files
        .into_iter()
        .take(limit)
        .map(|(_, path)| path)
        .collect())
}

fn add_zip_text_entry(
    archive: &mut zip::ZipWriter<fs::File>,
    entry_name: &str,
    contents: &[u8],
) -> Result<(), String> {
    archive
        .start_file::<_, ()>(
            entry_name,
            zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .map_err(|error| format!("Failed to add '{entry_name}' to the support bundle: {error}"))?;
    archive
        .write_all(contents)
        .map_err(|error| format!("Failed to write '{entry_name}' into the support bundle: {error}"))
}

fn add_zip_file_entry(
    archive: &mut zip::ZipWriter<fs::File>,
    source_path: &Path,
    entry_name: &str,
) -> Result<(), String> {
    let contents = fs::read(source_path)
        .map_err(|error| format!("Failed to read '{}' for the support bundle: {error}", source_path.display()))?;
    add_zip_text_entry(archive, entry_name, &contents)
}

fn redact_string_list_map(value: &mut Value, label: &str) {
    let Some(entries) = value.as_object_mut() else {
        return;
    };

    for messages in entries.values_mut() {
        let Some(array) = messages.as_array_mut() else {
            continue;
        };
        let count = array.len();
        array.clear();
        if count > 0 {
            array.push(Value::String(format!("[REDACTED {count} {label}]")));
        }
    }
}

fn redact_channel_progress_messages(value: &mut Value) {
    let Some(entries) = value.as_object_mut() else {
        return;
    };

    for entry in entries.values_mut() {
        let Some(record) = entry.as_object_mut() else {
            continue;
        };
        if record.contains_key("lastMessage") {
            record.insert("lastMessage".to_string(), Value::String("[REDACTED]".to_string()));
        }
    }
}

fn redact_session_snapshot_value(value: &mut Value) {
    let Some(session) = value.as_object_mut() else {
        return;
    };

    if let Some(channel_progress) = session.get_mut("channelProgress") {
        redact_channel_progress_messages(channel_progress);
    }
}

fn sanitize_notification_delivery_value(value: &mut Value, token: Option<&str>) {
    let Some(notification_delivery) = value.as_object_mut() else {
        return;
    };
    let Some(telegram_state) = notification_delivery
        .get_mut("telegramState")
        .and_then(Value::as_object_mut)
    else {
        return;
    };
    let Some(last_error) = telegram_state.get_mut("lastError") else {
        return;
    };
    let Some(error) = last_error.as_str() else {
        return;
    };

    *last_error = Value::String(sanitize_telegram_error(error.to_string(), token));
}

fn sanitize_sender_state_value_for_support_bundle(value: &mut Value, telegram_bot_token: Option<&str>) {
    let Some(state) = value.as_object_mut() else {
        return;
    };

    if let Some(last_session) = state.get_mut("lastSession") {
        redact_session_snapshot_value(last_session);
    }
    if let Some(recent_message_history) = state.get_mut("recentMessageHistory") {
        redact_string_list_map(recent_message_history, "recent message(s)");
    }
    if let Some(resume_session) = state.get_mut("resumeSession").and_then(Value::as_object_mut) {
        if let Some(session_state) = resume_session.get_mut("state") {
            redact_session_snapshot_value(session_state);
        }
        if let Some(recent_message_history) = resume_session.get_mut("recentMessageHistory") {
            redact_string_list_map(recent_message_history, "recent message(s)");
        }
    }
    if let Some(notification_delivery) = state.get_mut("notificationDelivery") {
        sanitize_notification_delivery_value(notification_delivery, telegram_bot_token);
    }
}

fn sanitize_config_value_for_support_bundle(value: &mut Value) {
    let Some(config) = value.as_object_mut() else {
        return;
    };
    if let Some(message_groups) = config.get_mut("messageGroups") {
        redact_string_list_map(message_groups, "message template(s)");
    }
}

fn read_redacted_json_for_support_bundle(
    source_path: &Path,
    redact: impl FnOnce(&mut Value),
) -> Result<Vec<u8>, String> {
    let contents = fs::read_to_string(source_path)
        .map_err(|error| format!("Failed to read '{}' for the support bundle: {error}", source_path.display()))?;

    let mut value = match serde_json::from_str::<Value>(&contents) {
        Ok(value) => value,
        Err(error) => {
            return serde_json::to_vec_pretty(&json!({
                "redacted": true,
                "warning": format!("Could not parse '{}' while preparing the support bundle: {error}", source_path.display())
            }))
            .map_err(|serialize_error| format!("Failed to serialize a redacted support-bundle placeholder: {serialize_error}"));
        }
    };

    redact(&mut value);
    serde_json::to_vec_pretty(&value)
        .map_err(|error| format!("Failed to serialize '{}' for the support bundle: {error}", source_path.display()))
}

pub(crate) fn export_support_bundle_at_paths(
    paths: &RuntimePaths,
    diagnostics: &ReleaseDiagnostics,
    setup: &DesktopSetupState,
) -> Result<SupportBundleResult, String> {
    let support_dir = support_bundle_dir(paths);
    fs::create_dir_all(&support_dir)
        .map_err(|error| format!("Failed to prepare support bundle directory '{}': {error}", support_dir.display()))?;

    let bundle_path = support_dir.join(support_bundle_file_name());
    let bundle_file = fs::File::create(&bundle_path)
        .map_err(|error| format!("Failed to create support bundle '{}': {error}", bundle_path.display()))?;
    let mut archive = zip::ZipWriter::new(bundle_file);
    let mut included_files = Vec::new();
    let mut missing_files = Vec::new();

    let diagnostics_json = serde_json::to_vec_pretty(diagnostics)
        .map_err(|error| format!("Failed to serialize diagnostics.json: {error}"))?;
    add_zip_text_entry(&mut archive, "diagnostics.json", &diagnostics_json)?;
    included_files.push("diagnostics.json".to_string());

    let setup_json = serde_json::to_vec_pretty(setup)
        .map_err(|error| format!("Failed to serialize setup.json: {error}"))?;
    add_zip_text_entry(&mut archive, "setup.json", &setup_json)?;
    included_files.push("setup.json".to_string());

    let telegram_bot_token = read_telegram_bot_token(paths).ok().flatten();

    let config_file = config_path(paths);
    if config_file.exists() {
        let redacted_config = read_redacted_json_for_support_bundle(&config_file, sanitize_config_value_for_support_bundle)?;
        add_zip_text_entry(&mut archive, "config.json", &redacted_config)?;
        included_files.push("config.json".to_string());
    } else {
        missing_files.push("config.json".to_string());
    }

    let state_file = sender_state_path(paths);
    if state_file.exists() {
        let redacted_state = read_redacted_json_for_support_bundle(&state_file, |value| {
            sanitize_sender_state_value_for_support_bundle(value, telegram_bot_token.as_deref());
        })?;
        add_zip_text_entry(&mut archive, ".sender-state.json", &redacted_state)?;
        included_files.push(".sender-state.json".to_string());
    } else {
        missing_files.push(".sender-state.json".to_string());
    }

    let log_files = latest_log_files(paths, 5)?;
    if log_files.is_empty() {
        missing_files.push("logs/*.jsonl".to_string());
    } else {
        for log_file in log_files {
            let file_name = log_file
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| format!("Invalid log file name '{}'.", log_file.display()))?;
            let entry_name = format!("logs/{file_name}");
            add_zip_file_entry(&mut archive, &log_file, &entry_name)?;
            included_files.push(entry_name);
        }
    }

    archive
        .finish()
        .map_err(|error| format!("Failed to finalize the support bundle '{}': {error}", bundle_path.display()))?;

    Ok(SupportBundleResult {
        path: path_to_string(&bundle_path),
        included_files,
        missing_files,
    })
}

pub(crate) fn reset_runtime_state_at_paths(paths: &RuntimePaths) -> Result<ResetRuntimeStateResult, String> {
    let state_file = sender_state_path(paths);
    let cleared_state_file = if state_file.exists() {
        fs::remove_file(&state_file)
            .map_err(|error| format!("Failed to remove '{}': {error}", state_file.display()))?;
        true
    } else {
        false
    };

    let mut deleted_log_files = 0;
    if paths.logs_dir.exists() {
        for entry in fs::read_dir(&paths.logs_dir)
            .map_err(|error| format!("Failed to read logs directory '{}': {error}", paths.logs_dir.display()))?
        {
            let entry = entry
                .map_err(|error| format!("Failed to read a log file entry: {error}"))?;
            let path = entry.path();
            if path.extension().and_then(|extension| extension.to_str()) != Some("jsonl") {
                continue;
            }

            fs::remove_file(&path)
                .map_err(|error| format!("Failed to remove log file '{}': {error}", path.display()))?;
            deleted_log_files += 1;
        }
    }

    fs::create_dir_all(&paths.logs_dir)
        .map_err(|error| format!("Failed to recreate logs directory '{}': {error}", paths.logs_dir.display()))?;

    Ok(ResetRuntimeStateResult {
        ok: true,
        cleared_state_file,
        deleted_log_files,
    })
}
