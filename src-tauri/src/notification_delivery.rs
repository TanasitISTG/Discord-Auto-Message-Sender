use super::*;

pub(crate) fn default_notification_delivery_settings() -> NotificationDeliverySettings {
    NotificationDeliverySettings {
        windows_desktop_enabled: true,
        telegram: TelegramSettings {
            enabled: false,
            bot_token_stored: false,
            chat_id: String::new(),
            preview_mode: TelegramPreviewMode::Full,
        },
    }
}

pub(crate) fn default_notification_delivery_snapshot() -> NotificationDeliverySnapshot {
    NotificationDeliverySnapshot {
        settings: default_notification_delivery_settings(),
        telegram_state: TelegramState {
            status: TelegramDeliveryStatus::Disabled,
            last_checked_at: None,
            last_delivered_at: None,
            last_tested_at: None,
            last_error: None,
            last_resolved_chat_title: None,
        },
    }
}

fn normalize_notification_delivery_settings(
    settings: &NotificationDeliverySettings,
    bot_token_stored: bool,
) -> NotificationDeliverySettings {
    NotificationDeliverySettings {
        windows_desktop_enabled: settings.windows_desktop_enabled,
        telegram: TelegramSettings {
            enabled: settings.telegram.enabled,
            bot_token_stored,
            chat_id: settings.telegram.chat_id.trim().to_string(),
            preview_mode: TelegramPreviewMode::Full,
        },
    }
}

fn resolve_telegram_state(settings: &NotificationDeliverySettings, previous: Option<&TelegramState>) -> TelegramState {
    let default_status = if !settings.telegram.enabled {
        TelegramDeliveryStatus::Disabled
    } else if !settings.telegram.bot_token_stored || settings.telegram.chat_id.trim().is_empty() {
        TelegramDeliveryStatus::Unconfigured
    } else if let Some(previous) = previous {
        if matches!(previous.status, TelegramDeliveryStatus::Failed | TelegramDeliveryStatus::Testing) {
            previous.status.clone()
        } else {
            TelegramDeliveryStatus::Ready
        }
    } else {
        TelegramDeliveryStatus::Ready
    };

    let previous = previous.cloned().unwrap_or(TelegramState {
        status: default_status.clone(),
        last_checked_at: None,
        last_delivered_at: None,
        last_tested_at: None,
        last_error: None,
        last_resolved_chat_title: None,
    });

    TelegramState {
        status: default_status.clone(),
        last_checked_at: previous.last_checked_at,
        last_delivered_at: previous.last_delivered_at,
        last_tested_at: previous.last_tested_at,
        last_error: if default_status == TelegramDeliveryStatus::Failed { previous.last_error } else { None },
        last_resolved_chat_title: previous.last_resolved_chat_title,
    }
}

pub(crate) fn load_notification_delivery_snapshot(paths: &RuntimePaths) -> Result<NotificationDeliverySnapshot, String> {
    let state = load_sender_state_record(paths)?;
    let mut snapshot = state
        .notification_delivery
        .unwrap_or_else(default_notification_delivery_snapshot);
    snapshot.settings = normalize_notification_delivery_settings(
        &snapshot.settings,
        read_telegram_bot_token(paths)?.is_some(),
    );
    snapshot.telegram_state = resolve_telegram_state(&snapshot.settings, Some(&snapshot.telegram_state));
    Ok(snapshot)
}

pub(crate) fn persist_notification_delivery_snapshot(
    app: &AppHandle,
    mut snapshot: NotificationDeliverySnapshot,
) -> Result<NotificationDeliverySnapshot, String> {
    let paths = runtime_paths(app)?;
    let bot_token_stored = read_telegram_bot_token(&paths)?.is_some();
    snapshot.settings = normalize_notification_delivery_settings(&snapshot.settings, bot_token_stored);
    snapshot.telegram_state = resolve_telegram_state(&snapshot.settings, Some(&snapshot.telegram_state));

    let snapshot = update_sender_state_record(&paths, |state| {
        state.notification_delivery = Some(snapshot.clone());
    })?
    .notification_delivery
    .unwrap_or(snapshot);
    app.emit(
        "app-event",
        json!({
            "type": "notification_delivery_state_changed",
            "delivery": snapshot.clone()
        }),
    )
    .map_err(|error| format!("Failed to emit notification delivery state: {error}"))?;
    Ok(snapshot)
}

pub(crate) fn resolve_effective_token(app: &AppHandle) -> Result<Option<String>, String> {
    let paths = runtime_paths(app)?;
    read_secure_token(&paths)
}

fn truncate_notification_body(value: &str, max_chars: usize) -> String {
    let mut truncated = value.chars().take(max_chars).collect::<String>();
    if value.chars().count() > max_chars {
        truncated.push_str("...");
    }
    truncated
}

fn notification_parts_from_event(event: &Value) -> Result<(String, String, String), String> {
    let notification = event
        .get("notification")
        .ok_or_else(|| "Inbox notification event payload was missing the notification object.".to_string())?;
    let kind = notification
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("direct_message");
    let author_name = notification
        .get("authorName")
        .and_then(Value::as_str)
        .unwrap_or("Unknown sender");
    let preview_text = notification
        .get("previewText")
        .and_then(Value::as_str)
        .unwrap_or("(No text content)");
    Ok((kind.to_string(), author_name.to_string(), preview_text.to_string()))
}

fn show_inbox_notification(app: &AppHandle, event: &Value) -> Result<(), String> {
    let (kind, author_name, preview_text) = notification_parts_from_event(event)?;
    let title = if kind == "message_request" {
        format!("New message request from {author_name}")
    } else {
        format!("New message from {author_name}")
    };

    app.notification()
        .builder()
        .title(title)
        .body(truncate_notification_body(&preview_text, 180))
        .show()
        .map_err(|error| format!("Failed to show inbox notification: {error}"))
}

fn telegram_message_body_from_event(event: &Value) -> Result<String, String> {
    let (kind, author_name, preview_text) = notification_parts_from_event(event)?;
    let title = if kind == "message_request" {
        format!("New Discord message request from {author_name}")
    } else {
        format!("New Discord DM from {author_name}")
    };
    Ok(format!("{title}\n\n{}", truncate_notification_body(&preview_text, 180)))
}

fn telegram_api_url(token: &str, method: &str) -> String {
    format!("https://api.telegram.org/bot{token}/{method}")
}

fn telegram_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("Failed to build Telegram HTTP client: {error}"))
}

pub(crate) fn detect_telegram_chat_with_token(token: &str) -> Result<TelegramChatDetectionResult, String> {
    let payload: Value = telegram_http_client()?
        .get(telegram_api_url(token, "getUpdates"))
        .send()
        .map_err(|error| sanitize_telegram_error(format!("Failed to call Telegram getUpdates: {error}"), Some(token)))?
        .error_for_status()
        .map_err(|error| sanitize_telegram_error(format!("Telegram getUpdates failed: {error}"), Some(token)))?
        .json()
        .map_err(|error| format!("Failed to decode Telegram getUpdates response: {error}"))?;

    let updates = payload
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| "Telegram getUpdates returned an unexpected payload.".to_string())?;

    let candidate = updates
        .iter()
        .rev()
        .filter_map(|update| update.get("message"))
        .filter_map(|message| {
            let chat = message.get("chat")?;
            if chat.get("type").and_then(Value::as_str) != Some("private") {
                return None;
            }

            let chat_id = match chat.get("id") {
                Some(Value::String(value)) => value.clone(),
                Some(Value::Number(value)) => value.to_string(),
                _ => return None,
            };
            let title = chat
                .get("title")
                .and_then(Value::as_str)
                .or_else(|| chat.get("username").and_then(Value::as_str))
                .or_else(|| chat.get("first_name").and_then(Value::as_str))
                .map(str::to_string);
            Some(TelegramChatDetectionResult { chat_id, title })
        })
        .next();

    candidate.ok_or_else(|| "No private Telegram chat was found. Open your bot in Telegram, send /start, then try Detect Chat ID again.".to_string())
}

pub(crate) fn send_telegram_message(token: &str, chat_id: &str, text: &str) -> Result<(), String> {
    let response: Value = telegram_http_client()?
        .post(telegram_api_url(token, "sendMessage"))
        .json(&json!({
            "chat_id": chat_id,
            "text": text,
            "disable_notification": false
        }))
        .send()
        .map_err(|error| sanitize_telegram_error(format!("Failed to call Telegram sendMessage: {error}"), Some(token)))?
        .json()
        .map_err(|error| format!("Failed to decode Telegram sendMessage response: {error}"))?;

    if response.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }

    let description = response
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("Telegram sendMessage failed.");
    Err(description.to_string())
}

pub(crate) fn handle_inbox_notification_event(app: &AppHandle, event: &Value) -> Result<(), String> {
    let mut snapshot = load_notification_delivery_snapshot(&runtime_paths(app)?)?;

    if snapshot.settings.windows_desktop_enabled {
        let _ = show_inbox_notification(app, event);
    }

    if !snapshot.settings.telegram.enabled {
        return Ok(());
    }

    let token = match read_telegram_bot_token(&runtime_paths(app)?)? {
        Some(token) => token,
        None => {
            snapshot.telegram_state.status = TelegramDeliveryStatus::Unconfigured;
            snapshot.telegram_state.last_error = Some("Telegram bot token is missing.".to_string());
            let _ = persist_notification_delivery_snapshot(app, snapshot);
            return Ok(());
        }
    };

    if snapshot.settings.telegram.chat_id.trim().is_empty() {
        snapshot.telegram_state.status = TelegramDeliveryStatus::Unconfigured;
        snapshot.telegram_state.last_error = Some("Telegram chat ID is missing.".to_string());
        let _ = persist_notification_delivery_snapshot(app, snapshot);
        return Ok(());
    }

    let message = match telegram_message_body_from_event(event) {
        Ok(message) => message,
        Err(error) => {
            snapshot.telegram_state.status = TelegramDeliveryStatus::Failed;
            snapshot.telegram_state.last_error = Some(error.clone());
            let _ = persist_notification_delivery_snapshot(app, snapshot);
            return Err(error);
        }
    };

    match send_telegram_message(&token, &snapshot.settings.telegram.chat_id, &message) {
        Ok(()) => {
            snapshot.telegram_state.status = TelegramDeliveryStatus::Ready;
            snapshot.telegram_state.last_delivered_at = Some(current_timestamp());
            snapshot.telegram_state.last_error = None;
            let _ = persist_notification_delivery_snapshot(app, snapshot);
        }
        Err(error) => {
            snapshot.telegram_state.status = TelegramDeliveryStatus::Failed;
            snapshot.telegram_state.last_error = Some(error);
            let _ = persist_notification_delivery_snapshot(app, snapshot);
        }
    }

    Ok(())
}
