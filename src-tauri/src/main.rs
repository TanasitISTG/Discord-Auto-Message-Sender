use std::{
    collections::HashMap,
    env, fs,
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
#[cfg(target_os = "windows")]
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{HLOCAL, LocalFree},
        Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    },
};

const RUNTIME_LOG_DIR: &str = "logs";
const SIDECAR_RESOURCE_DIR: &str = "sidecar";
const SECURE_TOKEN_FILE: &str = "discord-token.secure";
const SIDECAR_BINARY_NAME: &str = if cfg!(target_os = "windows") {
    "desktop-sidecar.exe"
} else {
    "desktop-sidecar"
};
const LEGACY_RUNTIME_FILES: [&str; 4] = [".env", "config.json", "messages.json", ".sender-state.json"];

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
    schema_version: u32,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveEnvironmentRequest {
    discord_token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopSetupState {
    token_present: bool,
    token_storage: String,
    data_dir: String,
    secure_store_path: String,
    env_path: String,
    config_path: String,
    state_path: String,
    logs_dir: String,
    warning: Option<String>,
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

#[derive(Clone, Debug)]
struct RuntimePaths {
    data_dir: PathBuf,
    logs_dir: PathBuf,
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

fn runtime_paths(app: &AppHandle) -> Result<RuntimePaths, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;
    let logs_dir = data_dir.join(RUNTIME_LOG_DIR);

    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("Failed to prepare desktop data directory: {error}"))?;

    Ok(RuntimePaths { data_dir, logs_dir })
}

fn environment_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(".env")
}

fn secure_token_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(SECURE_TOKEN_FILE)
}

fn normalize_token(candidate: impl Into<String>) -> Option<String> {
    let token = candidate.into().trim().to_string();
    (!token.is_empty()).then_some(token)
}

fn parse_env_value(raw: &str) -> String {
    serde_json::from_str::<String>(raw)
        .unwrap_or_else(|_| raw.trim().trim_matches('"').trim_matches('\'').to_string())
}

fn read_plaintext_token_from_env_file(path: &Path) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))?;
    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let Some((key, value)) = trimmed.split_once('=') else {
            continue;
        };
        if key.trim() != "DISCORD_TOKEN" {
            continue;
        }

        return Ok(normalize_token(parse_env_value(value)));
    }

    Ok(None)
}

fn scrub_discord_token_from_env_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read '{}': {error}", path.display()))?;
    let next_lines = contents
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !(trimmed.starts_with("DISCORD_TOKEN=") || trimmed.starts_with("DISCORD_TOKEN ="))
        })
        .collect::<Vec<_>>();

    if next_lines.len() == contents.lines().count() {
        return Ok(());
    }

    if next_lines.is_empty() {
        fs::remove_file(path)
            .map_err(|error| format!("Failed to remove '{}' after token migration: {error}", path.display()))?;
        return Ok(());
    }

    fs::write(path, format!("{}\n", next_lines.join("\n")))
        .map_err(|error| format!("Failed to update '{}' after token migration: {error}", path.display()))
}

fn process_environment_token() -> Option<String> {
    env::var("DISCORD_TOKEN").ok().and_then(normalize_token)
}

#[cfg(target_os = "windows")]
fn blob_from_bytes(bytes: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB {
        cbData: bytes.len() as u32,
        pbData: bytes.as_ptr() as *mut u8,
    }
}

#[cfg(target_os = "windows")]
fn protect_token(token: &str) -> Result<Vec<u8>, String> {
    let input = blob_from_bytes(token.as_bytes());
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptProtectData(
            &input,
            PCWSTR::null(),
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| "Failed to encrypt the Discord token with Windows DPAPI.".to_string())?;
    }

    let encrypted = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut core::ffi::c_void)));
    }

    Ok(encrypted)
}

#[cfg(target_os = "windows")]
fn unprotect_token(bytes: &[u8]) -> Result<String, String> {
    let input = blob_from_bytes(bytes);
    let mut output = CRYPT_INTEGER_BLOB::default();

    unsafe {
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|_| "Stored Discord token could not be decrypted. Save it again from Desktop Setup.".to_string())?;
    }

    let decrypted = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut core::ffi::c_void)));
    }

    String::from_utf8(decrypted)
        .map_err(|_| "Stored Discord token is not valid UTF-8. Save it again from Desktop Setup.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn protect_token(_token: &str) -> Result<Vec<u8>, String> {
    Err("Secure Discord token storage is only supported on Windows builds right now.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn unprotect_token(_bytes: &[u8]) -> Result<String, String> {
    Err("Secure Discord token storage is only supported on Windows builds right now.".to_string())
}

fn read_secure_token(paths: &RuntimePaths) -> Result<Option<String>, String> {
    let secure_path = secure_token_path(paths);
    if !secure_path.exists() {
        return Ok(None);
    }

    let encrypted = fs::read(&secure_path)
        .map_err(|error| format!("Failed to read '{}': {error}", secure_path.display()))?;
    let token = unprotect_token(&encrypted)?;
    Ok(normalize_token(token))
}

fn write_secure_token(paths: &RuntimePaths, token: &str) -> Result<(), String> {
    let encrypted = protect_token(token)?;
    fs::write(secure_token_path(paths), encrypted)
        .map_err(|error| format!("Failed to write the secure Discord token store: {error}"))
}

fn resolve_effective_token(app: &AppHandle) -> Result<Option<String>, String> {
    let paths = runtime_paths(app)?;
    if let Some(token) = read_secure_token(&paths)? {
        return Ok(Some(token));
    }

    if let Some(token) = read_plaintext_token_from_env_file(&environment_path(&paths))? {
        return Ok(Some(token));
    }

    Ok(process_environment_token())
}

fn load_desktop_setup_state(app: &AppHandle) -> Result<DesktopSetupState, String> {
    let paths = runtime_paths(app)?;
    let secure_store_path = secure_token_path(&paths);
    let env_path = environment_path(&paths);

    let (secure_token, warning) = match read_secure_token(&paths) {
        Ok(token) => (token, None),
        Err(error) => (None, Some(error)),
    };
    let environment_token = read_plaintext_token_from_env_file(&env_path)?
        .or_else(process_environment_token);

    let (token_present, token_storage) = if secure_token.is_some() {
        (true, "secure")
    } else if environment_token.is_some() {
        (true, "environment")
    } else {
        (false, "missing")
    };

    Ok(DesktopSetupState {
        token_present,
        token_storage: token_storage.to_string(),
        data_dir: paths.data_dir.to_string_lossy().to_string(),
        secure_store_path: secure_store_path.to_string_lossy().to_string(),
        env_path: env_path.to_string_lossy().to_string(),
        config_path: paths.data_dir.join("config.json").to_string_lossy().to_string(),
        state_path: paths.data_dir.join(".sender-state.json").to_string_lossy().to_string(),
        logs_dir: paths.logs_dir.to_string_lossy().to_string(),
        warning,
    })
}

fn save_secure_environment(app: &AppHandle, request: SaveEnvironmentRequest) -> Result<DesktopSetupState, String> {
    let normalized_token = normalize_token(request.discord_token)
        .ok_or_else(|| "DISCORD_TOKEN cannot be empty.".to_string())?;
    let paths = runtime_paths(app)?;
    write_secure_token(&paths, &normalized_token)?;
    scrub_discord_token_from_env_file(&environment_path(&paths))?;
    load_desktop_setup_state(app)
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths.iter().any(|existing| existing == &candidate) {
        paths.push(candidate);
    }
}

fn legacy_runtime_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let project_dir = project_root();
    if project_dir.exists() {
        push_unique_path(&mut roots, project_dir);
    }

    if let Ok(current_dir) = env::current_dir() {
        if current_dir.exists() {
            push_unique_path(&mut roots, current_dir);
        }
    }

    roots
}

fn copy_file_if_missing(source: &Path, destination: &Path) -> Result<(), String> {
    if !source.exists() || destination.exists() {
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to prepare migrated file destination: {error}"))?;
    }

    fs::copy(source, destination)
        .map_err(|error| format!("Failed to migrate '{}' to '{}': {error}", source.display(), destination.display()))?;
    Ok(())
}

fn copy_directory_contents_if_missing(source_dir: &Path, destination_dir: &Path) -> Result<(), String> {
    if !source_dir.exists() {
        return Ok(());
    }

    fs::create_dir_all(destination_dir)
        .map_err(|error| format!("Failed to prepare migrated directory '{}': {error}", destination_dir.display()))?;

    for entry in fs::read_dir(source_dir)
        .map_err(|error| format!("Failed to read legacy directory '{}': {error}", source_dir.display()))?
    {
        let entry = entry
            .map_err(|error| format!("Failed to read a legacy directory entry: {error}"))?;
        let source_path = entry.path();
        let destination_path = destination_dir.join(entry.file_name());

        if source_path.is_dir() {
            copy_directory_contents_if_missing(&source_path, &destination_path)?;
        } else {
            copy_file_if_missing(&source_path, &destination_path)?;
        }
    }

    Ok(())
}

fn migrate_legacy_runtime_data(app: &AppHandle) -> Result<(), String> {
    let paths = runtime_paths(app)?;

    for legacy_root in legacy_runtime_roots() {
        if legacy_root == paths.data_dir {
            continue;
        }

        for file_name in LEGACY_RUNTIME_FILES {
            copy_file_if_missing(
                &legacy_root.join(file_name),
                &paths.data_dir.join(file_name),
            )?;
        }

        copy_directory_contents_if_missing(&legacy_root.join(RUNTIME_LOG_DIR), &paths.logs_dir)?;
    }

    Ok(())
}

fn migrate_plaintext_token_to_secure_store(app: &AppHandle) -> Result<(), String> {
    let paths = runtime_paths(app)?;
    let data_env_path = environment_path(&paths);
    let secure_token = read_secure_token(&paths).ok().flatten();

    if secure_token.is_none() {
        if let Some(token) = read_plaintext_token_from_env_file(&data_env_path)? {
            write_secure_token(&paths, &token)?;
        } else {
            for legacy_root in legacy_runtime_roots() {
                let legacy_env_path = legacy_root.join(".env");
                if let Some(token) = read_plaintext_token_from_env_file(&legacy_env_path)? {
                    write_secure_token(&paths, &token)?;
                    break;
                }
            }
        }
    }

    scrub_discord_token_from_env_file(&data_env_path)?;
    Ok(())
}

fn bundled_sidecar_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidate = resource_dir
        .join(SIDECAR_RESOURCE_DIR)
        .join(SIDECAR_BINARY_NAME);
    candidate.exists().then_some(candidate)
}

fn development_sidecar_entry() -> Option<PathBuf> {
    let candidate = project_root().join("src").join("desktop").join("server.ts");
    candidate.exists().then_some(candidate)
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

    let paths = runtime_paths(app)?;
    let mut command = if let Some(sidecar_binary) = bundled_sidecar_path(app) {
        let mut command = Command::new(sidecar_binary);
        command.current_dir(&paths.data_dir);
        command
    } else if let Some(sidecar_entry) = development_sidecar_entry() {
        let mut command = Command::new(bun_executable());
        command.arg("run").arg(sidecar_entry).current_dir(project_root());
        command
    } else {
        return Err("Could not locate a packaged desktop sidecar or the development sidecar entrypoint.".to_string());
    };

    let mut child = command
        .arg("--base-dir")
        .arg(&paths.data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start desktop sidecar: {error}"))?;

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
    send_sidecar_request(
        &app,
        "run_preflight",
        json!({
            "token": resolve_effective_token(&app)?
        }),
    )
}

#[tauri::command]
fn run_dry_run(app: AppHandle, request: RunDryRunRequest) -> Result<DryRunResult, String> {
    send_sidecar_request(&app, "run_dry_run", request)
}

#[tauri::command]
fn start_session(app: AppHandle, request: RuntimeOptionsRequest) -> Result<SessionSnapshot, String> {
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
fn load_setup_state(app: AppHandle) -> Result<DesktopSetupState, String> {
    load_desktop_setup_state(&app)
}

#[tauri::command]
fn save_environment(app: AppHandle, request: SaveEnvironmentRequest) -> Result<DesktopSetupState, String> {
    save_secure_environment(&app, request)
}

#[tauri::command]
fn discard_resume_session(app: AppHandle) -> Result<SenderStateRecord, String> {
    send_sidecar_request(&app, "discard_resume_session", json!({}))
}

#[tauri::command]
fn open_log_file(app: AppHandle, request: OpenLogFileRequest) -> Result<String, String> {
    let log_path = runtime_paths(&app)?
        .logs_dir
        .join(format!("{}.jsonl", request.session_id));
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

#[tauri::command]
fn open_data_directory(app: AppHandle) -> Result<String, String> {
    let data_dir = runtime_paths(&app)?.data_dir;
    if cfg!(target_os = "windows") {
        Command::new("cmd")
            .args(["/C", "start", "", data_dir.to_string_lossy().as_ref()])
            .spawn()
            .map_err(|error| format!("Failed to open data directory: {error}"))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(&data_dir)
            .spawn()
            .map_err(|error| format!("Failed to open data directory: {error}"))?;
    } else {
        Command::new("xdg-open")
            .arg(&data_dir)
            .spawn()
            .map_err(|error| format!("Failed to open data directory: {error}"))?;
    }

    Ok(data_dir.to_string_lossy().to_string())
}

fn main() {
    tauri::Builder::default()
        .manage(AppRuntime::new())
        .setup(|app| {
            migrate_legacy_runtime_data(&app.handle())?;
            migrate_plaintext_token_to_secure_store(&app.handle())?;
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
            load_setup_state,
            save_environment,
            discard_resume_session,
            open_log_file,
            open_data_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
