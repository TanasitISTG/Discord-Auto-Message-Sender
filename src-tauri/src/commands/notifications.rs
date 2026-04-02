use crate::*;

#[tauri::command]
pub(crate) fn load_inbox_monitor_settings(app: AppHandle) -> Result<InboxMonitorSettings, String> {
    send_sidecar_request(&app, "load_inbox_monitor_settings", json!({}))
}

#[tauri::command]
pub(crate) fn save_inbox_monitor_settings(
    app: AppHandle,
    request: SaveInboxMonitorSettingsRequest,
) -> Result<InboxMonitorSnapshot, String> {
    let snapshot: InboxMonitorSnapshot = send_sidecar_request(&app, "save_inbox_monitor_settings", request)?;

    if snapshot.settings.enabled {
        let _ = restore_inbox_monitor_if_enabled(&app);
    } else {
        let _ = stop_inbox_monitor(app.clone());
    }

    Ok(snapshot)
}

#[tauri::command]
pub(crate) fn get_inbox_monitor_state(app: AppHandle) -> Result<InboxMonitorState, String> {
    send_sidecar_request(&app, "get_inbox_monitor_state", json!({}))
}

#[tauri::command]
pub(crate) fn start_inbox_monitor(app: AppHandle) -> Result<InboxMonitorState, String> {
    let token = resolve_effective_token(&app)?;
    send_sidecar_request(&app, "start_inbox_monitor", StartInboxMonitorRequest { token })
}

#[tauri::command]
pub(crate) fn stop_inbox_monitor(app: AppHandle) -> Result<InboxMonitorState, String> {
    send_sidecar_request(&app, "stop_inbox_monitor", json!({}))
}

#[tauri::command]
pub(crate) fn load_notification_delivery_settings(app: AppHandle) -> Result<NotificationDeliverySettings, String> {
    Ok(load_notification_delivery_snapshot(&runtime_paths(&app)?)?.settings)
}

#[tauri::command]
pub(crate) fn save_notification_delivery_settings(
    app: AppHandle,
    request: SaveNotificationDeliverySettingsRequest,
) -> Result<NotificationDeliverySnapshot, String> {
    let previous = load_notification_delivery_snapshot(&runtime_paths(&app)?)?;
    persist_notification_delivery_snapshot(
        &app,
        NotificationDeliverySnapshot {
            settings: request.settings,
            telegram_state: previous.telegram_state,
        },
    )
}

#[tauri::command]
pub(crate) fn get_notification_delivery_state(app: AppHandle) -> Result<NotificationDeliverySnapshot, String> {
    load_notification_delivery_snapshot(&runtime_paths(&app)?)
}

#[tauri::command]
pub(crate) fn save_telegram_bot_token(
    app: AppHandle,
    request: SaveTelegramBotTokenRequest,
) -> Result<NotificationDeliverySnapshot, String> {
    let token = normalize_token(request.bot_token)
        .ok_or_else(|| "Telegram bot token cannot be empty.".to_string())?;
    let paths = runtime_paths(&app)?;
    write_telegram_bot_token(&paths, &token)?;
    let mut snapshot = load_notification_delivery_snapshot(&paths)?;
    snapshot.settings.telegram.bot_token_stored = true;
    persist_notification_delivery_snapshot(&app, snapshot)
}

#[tauri::command]
pub(crate) fn clear_telegram_bot_token(app: AppHandle) -> Result<NotificationDeliverySnapshot, String> {
    let paths = runtime_paths(&app)?;
    clear_telegram_bot_token_files(&paths)?;
    let mut snapshot = load_notification_delivery_snapshot(&paths)?;
    snapshot.settings.telegram.bot_token_stored = false;
    snapshot.settings.telegram.enabled = false;
    persist_notification_delivery_snapshot(&app, snapshot)
}

#[tauri::command]
pub(crate) async fn detect_telegram_chat(app: AppHandle) -> Result<TelegramChatDetectionResult, String> {
    let paths = runtime_paths(&app)?;
    let token = read_telegram_bot_token(&paths)?
        .ok_or_else(|| "Save a Telegram bot token before detecting a chat ID.".to_string())?;
    let token_for_lookup = token.clone();
    let detected = tauri::async_runtime::spawn_blocking(move || detect_telegram_chat_with_token(&token_for_lookup))
        .await
        .map_err(|error| format!("Telegram chat detection task failed: {error}"))??;
    let mut snapshot = load_notification_delivery_snapshot(&paths)?;
    snapshot.telegram_state.last_checked_at = Some(current_timestamp());
    snapshot.telegram_state.last_resolved_chat_title = detected.title.clone();
    persist_notification_delivery_snapshot(&app, snapshot)?;
    app.emit(
        "app-event",
        json!({
            "type": "telegram_chat_detected",
            "chatId": detected.chat_id.clone(),
            "title": detected.title.clone()
        }),
    )
    .map_err(|error| format!("Failed to emit Telegram chat detection event: {error}"))?;
    Ok(detected)
}

#[tauri::command]
pub(crate) async fn send_test_telegram_notification(app: AppHandle) -> Result<TelegramTestResult, String> {
    let paths = runtime_paths(&app)?;
    let token = read_telegram_bot_token(&paths)?
        .ok_or_else(|| "Save a Telegram bot token before sending a test notification.".to_string())?;
    let mut snapshot = load_notification_delivery_snapshot(&paths)?;
    let chat_id = snapshot.settings.telegram.chat_id.clone();
    if chat_id.trim().is_empty() {
        return Err("Save or detect a Telegram chat ID before sending a test notification.".to_string());
    }

    snapshot.telegram_state.status = TelegramDeliveryStatus::Testing;
    snapshot.telegram_state.last_checked_at = Some(current_timestamp());
    persist_notification_delivery_snapshot(&app, snapshot.clone())?;

    let message = "Telegram delivery test from Discord Auto Message Sender.\n\nIf you received this, live inbox notifications can also be sent here while the desktop app is running.";
    let token_for_send = token.clone();
    let chat_id_for_send = chat_id.clone();
    let send_result = tauri::async_runtime::spawn_blocking(move || send_telegram_message(&token_for_send, &chat_id_for_send, message))
        .await
        .map_err(|error| format!("Telegram test task failed: {error}"))?;
    let result = match send_result {
        Ok(()) => {
            snapshot.telegram_state.status = TelegramDeliveryStatus::Ready;
            snapshot.telegram_state.last_tested_at = Some(current_timestamp());
            snapshot.telegram_state.last_error = None;
            let snapshot = persist_notification_delivery_snapshot(&app, snapshot)?;
            TelegramTestResult {
                ok: true,
                message: "Telegram test notification sent.".to_string(),
                state: snapshot.telegram_state,
            }
        }
        Err(error) => {
            snapshot.telegram_state.status = TelegramDeliveryStatus::Failed;
            snapshot.telegram_state.last_tested_at = Some(current_timestamp());
            snapshot.telegram_state.last_error = Some(error.clone());
            let snapshot = persist_notification_delivery_snapshot(&app, snapshot)?;
            TelegramTestResult {
                ok: false,
                message: error,
                state: snapshot.telegram_state,
            }
        }
    };

    app.emit(
        "app-event",
        json!({
            "type": "telegram_test_result",
            "ok": result.ok,
            "message": result.message.clone(),
            "state": result.state.clone()
        }),
    )
    .map_err(|error| format!("Failed to emit Telegram test event: {error}"))?;

    Ok(result)
}
