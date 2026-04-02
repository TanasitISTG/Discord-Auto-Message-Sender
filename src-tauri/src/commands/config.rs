use crate::*;

#[tauri::command]
pub(crate) fn load_config(app: AppHandle) -> Result<ConfigLoadResult, String> {
    send_sidecar_request(&app, "load_config", json!({}))
}

#[tauri::command]
pub(crate) fn save_config(
    app: AppHandle,
    request: SaveConfigRequest,
) -> Result<SaveConfigResult, String> {
    send_sidecar_request(&app, "save_config", request)
}

#[tauri::command]
pub(crate) fn run_preflight(app: AppHandle) -> Result<PreflightResult, String> {
    send_sidecar_request(
        &app,
        "run_preflight",
        json!({
            "token": resolve_effective_token(&app)?
        }),
    )
}

#[tauri::command]
pub(crate) fn run_dry_run(
    app: AppHandle,
    request: RunDryRunRequest,
) -> Result<DryRunResult, String> {
    send_sidecar_request(&app, "run_dry_run", request)
}
