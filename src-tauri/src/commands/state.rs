use crate::*;

#[tauri::command]
pub(crate) fn load_state(app: AppHandle) -> Result<SenderStateRecord, String> {
    send_sidecar_request(&app, "load_state", json!({}))
}

#[tauri::command]
pub(crate) fn load_setup_state(app: AppHandle) -> Result<DesktopSetupState, String> {
    load_desktop_setup_state(&app)
}

#[tauri::command]
pub(crate) fn save_environment(app: AppHandle, request: SaveEnvironmentRequest) -> Result<DesktopSetupState, String> {
    let setup = save_secure_environment(&app, request)?;
    let _ = restore_inbox_monitor_if_enabled(&app);
    Ok(setup)
}

#[tauri::command]
pub(crate) fn clear_secure_token(app: AppHandle) -> Result<DesktopSetupState, String> {
    let setup = clear_secure_environment(&app)?;
    let _ = stop_inbox_monitor(app.clone());
    Ok(setup)
}
