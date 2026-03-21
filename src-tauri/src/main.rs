use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Sender},
        Mutex,
    },
    time::Duration,
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelQuietHours {
    start: String,
    end: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelSchedule {
    interval_seconds: f64,
    random_margin_seconds: f64,
    quiet_hours: Option<ChannelQuietHours>,
    timezone: Option<String>,
    max_sends_per_day: Option<u32>,
    cooldown_window_size: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppChannel {
    name: String,
    id: String,
    referrer: String,
    message_group: String,
    schedule: Option<ChannelSchedule>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppConfig {
    user_agent: String,
    channels: Vec<AppChannel>,
    message_groups: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogEntry {
    id: String,
    timestamp: String,
    level: String,
    context: String,
    message: String,
    meta: Option<HashMap<String, Value>>,
    session_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdaptivePacingState {
    base_request_interval_ms: u32,
    current_request_interval_ms: u32,
    max_request_interval_ms: u32,
    penalty_level: u32,
    recent_rate_limit_count: u32,
    last_rate_limit_at: Option<String>,
    last_recovery_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelHealthRecord {
    channel_id: String,
    channel_name: String,
    status: String,
    consecutive_rate_limits: u32,
    consecutive_failures: u32,
    suppression_count: u32,
    last_reason: Option<String>,
    last_failure_at: Option<String>,
    last_success_at: Option<String>,
    suppressed_until: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelProgressRecord {
    channel_id: String,
    channel_name: String,
    status: String,
    sent_messages: u32,
    sent_today: u32,
    consecutive_rate_limits: u32,
    last_message: Option<String>,
    last_sent_at: Option<String>,
    last_error: Option<String>,
    suppressed_until: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionChannelOutcome {
    channel_id: String,
    channel_name: String,
    status: String,
    sent_messages: u32,
    last_error: Option<String>,
    suppressed_until: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSummary {
    total_channels: usize,
    completed_channels: usize,
    failed_channels: usize,
    sent_messages: u32,
    started_at: String,
    finished_at: Option<String>,
    stop_reason: Option<String>,
    rate_limit_events: Option<u32>,
    suppressed_channels: Option<usize>,
    resumed_from_checkpoint: Option<bool>,
    max_pacing_interval_ms: Option<u32>,
    channel_outcomes: Option<Vec<SessionChannelOutcome>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionSnapshot {
    id: String,
    status: String,
    started_at: Option<String>,
    updated_at: String,
    active_channels: Vec<String>,
    completed_channels: Vec<String>,
    failed_channels: Vec<String>,
    sent_messages: u32,
    stop_reason: Option<String>,
    summary: Option<SessionSummary>,
    runtime: Option<RuntimeOptionsRequest>,
    channel_progress: Option<HashMap<String, ChannelProgressRecord>>,
    channel_health: Option<HashMap<String, ChannelHealthRecord>>,
    pacing: Option<AdaptivePacingState>,
    resumed_from_checkpoint: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChannelPreflightResult {
    channel_id: String,
    channel_name: String,
    ok: bool,
    reason: Option<String>,
    status: Option<u16>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreflightResult {
    ok: bool,
    checked_at: String,
    config_valid: bool,
    token_present: bool,
    issues: Vec<String>,
    channels: Vec<ChannelPreflightResult>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DryRunCadence {
    num_messages: u32,
    base_wait_seconds: f64,
    margin_seconds: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DryRunChannelPreview {
    channel_id: String,
    channel_name: String,
    group_name: String,
    enabled: bool,
    sample_messages: Vec<String>,
    cadence: DryRunCadence,
    skip_reasons: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DryRunSummary {
    selected_channels: usize,
    skipped_channels: usize,
    total_sample_messages: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DryRunResult {
    generated_at: String,
    will_send_messages: bool,
    channels: Vec<DryRunChannelPreview>,
    summary: DryRunSummary,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentFailure {
    channel_id: String,
    channel_name: String,
    reason: String,
    timestamp: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SenderStateRecord {
    last_session: Option<SessionSnapshot>,
    summaries: Vec<SessionSummary>,
    recent_failures: Vec<RecentFailure>,
    recent_message_history: Option<HashMap<String, Vec<String>>>,
    channel_health: Option<HashMap<String, ChannelHealthRecord>>,
    resume_session: Option<ResumeSessionRecord>,
    warning: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResumeSessionRecord {
    session_id: String,
    updated_at: String,
    runtime: RuntimeOptionsRequest,
    config_signature: String,
    state: SessionSnapshot,
    recent_message_history: HashMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum ConfigLoadResult {
    Ok { config: AppConfig },
    Missing,
    Invalid { error: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveConfigResult {
    ok: bool,
    config: AppConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogLoadResult {
    ok: bool,
    path: String,
    entries: Vec<LogEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeOptionsRequest {
    num_messages: u32,
    base_wait_seconds: f64,
    margin_seconds: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveConfigRequest {
    config: AppConfig,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunDryRunRequest {
    runtime: RuntimeOptionsRequest,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadLogsRequest {
    session_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenLogFileRequest {
    session_id: String,
}

#[derive(Clone, Debug, Serialize)]
struct SidecarRequest<T: Serialize> {
    id: String,
    command: String,
    payload: T,
}

#[derive(Clone, Debug, Deserialize)]
struct SidecarResponseEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    id: String,
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct SidecarEventEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    event: Value,
}

#[derive(Clone, Debug)]
struct PendingResponse {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

struct ManagedSidecar {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    session_state: Option<SessionSnapshot>,
    pending: HashMap<String, Sender<PendingResponse>>,
}

impl ManagedSidecar {
    fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            session_state: None,
            pending: HashMap::new(),
        }
    }
}

struct AppRuntime {
    sidecar: Mutex<ManagedSidecar>,
    next_request_id: AtomicU64,
}

impl AppRuntime {
    fn new() -> Self {
        Self {
            sidecar: Mutex::new(ManagedSidecar::new()),
            next_request_id: AtomicU64::new(1),
        }
    }
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("project root")
        .to_path_buf()
}

fn bun_executable() -> &'static str {
    if cfg!(target_os = "windows") {
        "bun.exe"
    } else {
        "bun"
    }
}

fn next_request_id(app: &AppHandle) -> String {
    let state = app.state::<AppRuntime>();
    state.next_request_id.fetch_add(1, Ordering::Relaxed).to_string()
}

fn take_pending(sidecar: &mut ManagedSidecar, id: &str) -> Option<Sender<PendingResponse>> {
    sidecar.pending.remove(id)
}

fn clear_sidecar(sidecar: &mut ManagedSidecar, error: &str) {
    sidecar.child = None;
    sidecar.stdin = None;
    sidecar.session_state = None;
    for (_, responder) in sidecar.pending.drain() {
        let _ = responder.send(PendingResponse {
            ok: false,
            result: None,
            error: Some(error.to_string()),
        });
    }
}

fn session_should_block_close(sidecar: &ManagedSidecar) -> bool {
    sidecar
        .session_state
        .as_ref()
        .map(|state| matches!(state.status.as_str(), "running" | "paused" | "stopping"))
        .unwrap_or(false)
}

fn update_cached_session_state(sidecar: &mut ManagedSidecar, event: &Value) {
    if let Some(state_value) = event.get("state").cloned() {
        if let Ok(state) = serde_json::from_value::<SessionSnapshot>(state_value) {
            sidecar.session_state = Some(state);
        }
    }
}

fn attach_stdout_reader(app: AppHandle, reader: ChildStdout) {
    std::thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().flatten() {
            let trimmed = line.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }

            if let Ok(response) = serde_json::from_str::<SidecarResponseEnvelope>(&trimmed) {
                if response.message_type == "response" {
                    let responder = {
                        let state = app.state::<AppRuntime>();
                        let pending = match state.sidecar.lock() {
                            Ok(mut sidecar) => take_pending(&mut sidecar, &response.id),
                            Err(_) => None,
                        };
                        pending
                    };

                    if let Some(responder) = responder {
                        let _ = responder.send(PendingResponse {
                            ok: response.ok,
                            result: response.result,
                            error: response.error,
                        });
                    }
                    continue;
                }
            }

            if let Ok(event) = serde_json::from_str::<SidecarEventEnvelope>(&trimmed) {
                if event.message_type == "event" {
                    {
                        let state = app.state::<AppRuntime>();
                        if let Ok(mut sidecar) = state.sidecar.lock() {
                            update_cached_session_state(&mut sidecar, &event.event);
                        };
                    }
                    let _ = app.emit("app-event", event.event);
                    continue;
                }
            }

            let _ = app.emit(
                "app-event",
                json!({
                    "type": "sidecar_error",
                    "message": format!("Desktop sidecar produced an invalid message: {trimmed}")
                }),
            );
        }
    });
}

fn attach_stderr_reader(app: AppHandle, reader: ChildStderr) {
    std::thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().flatten() {
            let trimmed = line.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }

            let _ = app.emit(
                "app-event",
                json!({
                    "type": "sidecar_error",
                    "message": trimmed
                }),
            );
        }
    });
}

fn start_sidecar_process(app: &AppHandle) -> Result<(), String> {
    {
        let state = app.state::<AppRuntime>();
        let mut sidecar = state
            .sidecar
            .lock()
            .map_err(|_| "Failed to lock desktop sidecar.".to_string())?;

        if let Some(child) = sidecar.child.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(()),
                Ok(Some(_)) | Err(_) => {
                    clear_sidecar(&mut sidecar, "Desktop sidecar stopped.");
                }
            }
        }
    }

    let mut child = Command::new(bun_executable())
        .arg("run")
        .arg("src/desktop/server.ts")
        .arg("--base-dir")
        .arg(project_root())
        .current_dir(project_root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start Bun sidecar: {error}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to capture sidecar stdin.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture sidecar stdout.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture sidecar stderr.".to_string())?;

    {
        let state = app.state::<AppRuntime>();
        let mut sidecar = state
            .sidecar
            .lock()
            .map_err(|_| "Failed to lock desktop sidecar.".to_string())?;
        sidecar.stdin = Some(stdin);
        sidecar.child = Some(child);
    }

    attach_stdout_reader(app.clone(), stdout);
    attach_stderr_reader(app.clone(), stderr);
    Ok(())
}

fn start_sidecar_watcher(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(500));

        let sidecar_exited = {
            let state = app.state::<AppRuntime>();
            let mut sidecar = match state.sidecar.lock() {
                Ok(sidecar) => sidecar,
                Err(_) => continue,
            };

            match sidecar.child.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(_status)) => {
                        clear_sidecar(&mut sidecar, "Desktop sidecar stopped unexpectedly.");
                        true
                    }
                    Ok(None) => false,
                    Err(_) => {
                        clear_sidecar(&mut sidecar, "Desktop sidecar status could not be read.");
                        true
                    }
                },
                None => false,
            }
        };

        if sidecar_exited {
            let _ = app.emit(
                "app-event",
                json!({
                    "type": "sidecar_error",
                    "message": "Desktop runtime restarted after an unexpected sidecar exit."
                }),
            );
            let _ = start_sidecar_process(&app);
        }
    });
}

fn ensure_sidecar_running(app: &AppHandle) -> Result<(), String> {
    start_sidecar_process(app)
}

fn send_sidecar_request<T, R>(app: &AppHandle, command: &str, payload: T) -> Result<R, String>
where
    T: Serialize,
    R: DeserializeOwned,
{
    ensure_sidecar_running(app)?;

    let request_id = next_request_id(app);
    let (tx, rx) = mpsc::channel::<PendingResponse>();

    {
        let state = app.state::<AppRuntime>();
        let mut sidecar = state
            .sidecar
            .lock()
            .map_err(|_| "Failed to lock desktop sidecar.".to_string())?;

        sidecar.pending.insert(request_id.clone(), tx);
        let request = SidecarRequest {
            id: request_id.clone(),
            command: command.to_string(),
            payload,
        };
        let body = serde_json::to_string(&request).map_err(|error| format!("Failed to serialize sidecar request: {error}"))?;

        let write_result = {
            let stdin = sidecar
                .stdin
                .as_mut()
                .ok_or_else(|| "Desktop sidecar stdin is unavailable.".to_string())?;
            stdin.write_all(format!("{body}\n").as_bytes())
                .and_then(|_| stdin.flush())
        };

        if let Err(error) = write_result {
            sidecar.pending.remove(&request_id);
            return Err(format!("Failed to write to desktop sidecar: {error}"));
        }
    }

    let response = rx
        .recv_timeout(Duration::from_secs(60))
        .map_err(|_| format!("Timed out waiting for desktop sidecar response for '{command}'."))?;

    if !response.ok {
        return Err(response
            .error
            .unwrap_or_else(|| format!("Desktop sidecar failed command '{command}'.")));
    }

    serde_json::from_value(response.result.unwrap_or(Value::Null))
        .map_err(|error| format!("Failed to deserialize sidecar response for '{command}': {error}"))
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<ConfigLoadResult, String> {
    send_sidecar_request(&app, "load_config", json!({}))
}

#[tauri::command]
fn save_config(app: AppHandle, request: SaveConfigRequest) -> Result<SaveConfigResult, String> {
    send_sidecar_request(&app, "save_config", request)
}

#[tauri::command]
fn run_preflight(app: AppHandle) -> Result<PreflightResult, String> {
    send_sidecar_request(&app, "run_preflight", json!({}))
}

#[tauri::command]
fn run_dry_run(app: AppHandle, request: RunDryRunRequest) -> Result<DryRunResult, String> {
    send_sidecar_request(&app, "run_dry_run", request)
}

#[tauri::command]
fn start_session(app: AppHandle, request: RuntimeOptionsRequest) -> Result<SessionSnapshot, String> {
    send_sidecar_request(&app, "start_session", request)
}

#[tauri::command]
fn pause_session(app: AppHandle) -> Result<Option<SessionSnapshot>, String> {
    send_sidecar_request(&app, "pause_session", json!({}))
}

#[tauri::command]
fn resume_session(app: AppHandle) -> Result<Option<SessionSnapshot>, String> {
    send_sidecar_request(&app, "resume_session", json!({}))
}

#[tauri::command]
fn stop_session(app: AppHandle) -> Result<Option<SessionSnapshot>, String> {
    send_sidecar_request(&app, "stop_session", json!({}))
}

#[tauri::command]
fn get_session_state(app: AppHandle) -> Result<Option<SessionSnapshot>, String> {
    send_sidecar_request(&app, "get_session_state", json!({}))
}

#[tauri::command]
fn load_logs(app: AppHandle, request: LoadLogsRequest) -> Result<LogLoadResult, String> {
    send_sidecar_request(&app, "load_logs", request)
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<SenderStateRecord, String> {
    send_sidecar_request(&app, "load_state", json!({}))
}

#[tauri::command]
fn open_log_file(request: OpenLogFileRequest) -> Result<String, String> {
    let log_path = project_root().join("logs").join(format!("{}.jsonl", request.session_id));
    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", log_path.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|error| format!("Failed to open log file: {error}"))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&log_path)
            .spawn()
            .map_err(|error| format!("Failed to open log file: {error}"))?;
    } else {
        Command::new("xdg-open")
            .arg(&log_path)
            .spawn()
            .map_err(|error| format!("Failed to open log file: {error}"))?;
    }

    Ok(log_path.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppRuntime::new())
        .setup(|app| {
            start_sidecar_process(&app.handle())?;
            start_sidecar_watcher(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppRuntime>();
                if let Ok(sidecar) = state.sidecar.lock() {
                    if session_should_block_close(&sidecar) {
                        api.prevent_close();
                        let _ = window.app_handle().emit(
                            "app-event",
                            json!({
                                "type": "close_blocked",
                                "message": "A session is still active. Pause or stop it before closing the app.",
                                "state": sidecar.session_state
                            }),
                        );
                    }
                };
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            run_preflight,
            run_dry_run,
            start_session,
            pause_session,
            resume_session,
            stop_session,
            get_session_state,
            load_logs,
            load_state,
            open_log_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
