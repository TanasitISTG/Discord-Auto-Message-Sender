use crate::*;

#[tauri::command]
pub(crate) fn start_session(app: AppHandle, request: StartSessionRequest) -> Result<SessionSnapshot, String> {
    let mut payload = serde_json::to_value(request)
        .map_err(|error| format!("Failed to serialize the session runtime request: {error}"))?;
    if let Value::Object(ref mut object) = payload {
        object.insert(
            "token".to_string(),
            match resolve_effective_token(&app)? {
                Some(token) => Value::String(token),
                None => Value::Null,
            },
        );
    }

    send_sidecar_request(&app, "start_session", payload)
}

#[tauri::command]
pub(crate) fn pause_session(app: AppHandle) -> Result<Option<SessionSnapshot>, String> {
    send_sidecar_request(&app, "pause_session", json!({}))
}

#[tauri::command]
pub(crate) fn resume_session(app: AppHandle) -> Result<Option<SessionSnapshot>, String> {
    send_sidecar_request(&app, "resume_session", json!({}))
}

#[tauri::command]
pub(crate) fn stop_session(app: AppHandle) -> Result<Option<SessionSnapshot>, String> {
    send_sidecar_request(&app, "stop_session", json!({}))
}

#[tauri::command]
pub(crate) fn get_session_state(app: AppHandle) -> Result<Option<SessionSnapshot>, String> {
    send_sidecar_request(&app, "get_session_state", json!({}))
}

#[tauri::command]
pub(crate) fn load_logs(app: AppHandle, request: LoadLogsRequest) -> Result<LogLoadResult, String> {
    send_sidecar_request(&app, "load_logs", request)
}

#[tauri::command]
pub(crate) fn discard_resume_session(app: AppHandle) -> Result<SenderStateRecord, String> {
    send_sidecar_request(&app, "discard_resume_session", json!({}))
}
