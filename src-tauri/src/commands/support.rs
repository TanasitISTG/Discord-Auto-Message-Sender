use crate::*;

#[tauri::command]
pub(crate) fn load_release_diagnostics(app: AppHandle) -> Result<ReleaseDiagnostics, String> {
    load_release_diagnostics_state(&app)
}

#[tauri::command]
pub(crate) fn open_logs_directory(app: AppHandle) -> Result<String, String> {
    let logs_dir = runtime_paths(&app)?.logs_dir;
    open_path_in_file_manager(&logs_dir)
}

#[tauri::command]
pub(crate) fn export_support_bundle(app: AppHandle) -> Result<SupportBundleResult, String> {
    let paths = runtime_paths(&app)?;
    let setup = read_desktop_setup_state(&paths)?;
    let diagnostics = build_release_diagnostics(
        &paths,
        &app.package_info().version.to_string(),
        setup.token_storage.clone(),
        sidecar_status_value(&app)?,
    );
    export_support_bundle_at_paths(&paths, &diagnostics, &setup)
}

#[tauri::command]
pub(crate) fn reset_runtime_state(app: AppHandle) -> Result<ResetRuntimeStateResult, String> {
    ensure_no_active_session(&app)?;
    let paths = runtime_paths(&app)?;
    reset_runtime_state_at_paths(&paths)
}

#[tauri::command]
pub(crate) fn open_log_file(app: AppHandle, request: OpenLogFileRequest) -> Result<String, String> {
    let paths = runtime_paths(&app)?;
    let log_path = resolve_session_log_path(&paths, &request.session_id)?;
    open_path_in_file_manager(&log_path)
}

#[tauri::command]
pub(crate) fn open_data_directory(app: AppHandle) -> Result<String, String> {
    let data_dir = runtime_paths(&app)?.data_dir;
    open_path_in_file_manager(&data_dir)
}
