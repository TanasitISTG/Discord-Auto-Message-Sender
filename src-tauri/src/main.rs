#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(test, allow(dead_code))]

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
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use chrono::Utc;
use reqwest::blocking::Client;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;
#[cfg(target_os = "windows")]
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{HLOCAL, LocalFree},
        Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB},
    },
};

const RUNTIME_LOG_DIR: &str = "logs";
const SUPPORT_BUNDLE_DIR: &str = "support";
const SIDECAR_RESOURCE_DIR: &str = "sidecar";
const SECURE_TOKEN_FILE: &str = "discord-token.secure";
const TELEGRAM_BOT_TOKEN_FILE: &str = "telegram-bot-token.secure";
const SENDER_STATE_LOCK_FILE: &str = ".sender-state.lock";
const APPDATA_OVERRIDE_ENV: &str = "DISCORD_AUTO_MESSAGE_SENDER_APPDATA_DIR";
const SENDER_STATE_LOCK_RETRY_MS: u64 = 25;
const SENDER_STATE_LOCK_TIMEOUT_MS: u64 = 10_000;
const SENDER_STATE_LOCK_STALE_MS: u64 = 30_000;
const SIDECAR_BINARY_NAME: &str = if cfg!(target_os = "windows") {
    "desktop-sidecar.exe"
} else {
    "desktop-sidecar"
};
const LEGACY_RUNTIME_FILES: [&str; 4] = [".env", "config.json", "messages.json", ".sender-state.json"];
const SESSION_ID_MAX_LEN: usize = 128;

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
    segment_id: Option<String>,
    segment_kind: Option<String>,
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
    sent_today_day_key: Option<String>,
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
    current_segment_id: Option<String>,
    current_segment_kind: Option<String>,
    current_segment_started_at: Option<String>,
    resumed_from_checkpoint_at: Option<String>,
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
    skipped: Option<bool>,
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
    inbox_monitor: Option<InboxMonitorSnapshot>,
    notification_delivery: Option<NotificationDeliverySnapshot>,
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
    warnings: Option<Vec<String>>,
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
struct InboxMonitorSettings {
    enabled: bool,
    poll_interval_seconds: u32,
    notify_direct_messages: bool,
    notify_message_requests: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxMonitorState {
    status: String,
    enabled: bool,
    poll_interval_seconds: u32,
    last_checked_at: Option<String>,
    last_successful_poll_at: Option<String>,
    last_notification_at: Option<String>,
    last_error: Option<String>,
    backoff_until: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxMonitorLastSeen {
    initialized_at: Option<String>,
    self_user_id: Option<String>,
    channel_message_ids: HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InboxMonitorSnapshot {
    settings: InboxMonitorSettings,
    state: InboxMonitorState,
    last_seen: InboxMonitorLastSeen,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelegramSettings {
    enabled: bool,
    bot_token_stored: bool,
    chat_id: String,
    preview_mode: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelegramState {
    status: String,
    last_checked_at: Option<String>,
    last_delivered_at: Option<String>,
    last_tested_at: Option<String>,
    last_error: Option<String>,
    last_resolved_chat_title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationDeliverySettings {
    windows_desktop_enabled: bool,
    telegram: TelegramSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotificationDeliverySnapshot {
    settings: NotificationDeliverySettings,
    telegram_state: TelegramState,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveInboxMonitorSettingsRequest {
    settings: InboxMonitorSettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartInboxMonitorRequest {
    token: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveNotificationDeliverySettingsRequest {
    settings: NotificationDeliverySettings,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveTelegramBotTokenRequest {
    bot_token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelegramChatDetectionResult {
    chat_id: String,
    title: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelegramTestResult {
    ok: bool,
    message: String,
    state: TelegramState,
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

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum SidecarStatus {
    Connecting,
    Ready,
    Restarting,
    Failed,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReleaseDiagnostics {
    app_version: String,
    data_dir: String,
    logs_dir: String,
    config_path: String,
    state_path: String,
    secure_store_path: String,
    token_storage: String,
    sidecar_status: SidecarStatus,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SupportBundleResult {
    path: String,
    included_files: Vec<String>,
    missing_files: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResetRuntimeStateResult {
    ok: bool,
    cleared_state_file: bool,
    deleted_log_files: usize,
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
    status: SidecarStatus,
    last_error: Option<String>,
    pending: HashMap<String, Sender<PendingResponse>>,
}

impl ManagedSidecar {
    fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            session_state: None,
            status: SidecarStatus::Connecting,
            last_error: None,
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
    let data_dir = match runtime_data_dir_override() {
        Some(path) => path,
        _ => app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Failed to resolve app data directory: {error}"))?,
    };
    let logs_dir = data_dir.join(RUNTIME_LOG_DIR);

    fs::create_dir_all(&logs_dir)
        .map_err(|error| format!("Failed to prepare desktop data directory: {error}"))?;

    Ok(RuntimePaths { data_dir, logs_dir })
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn environment_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(".env")
}

fn secure_token_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(SECURE_TOKEN_FILE)
}

fn telegram_bot_token_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(TELEGRAM_BOT_TOKEN_FILE)
}

fn config_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join("config.json")
}

fn sender_state_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(".sender-state.json")
}

fn sender_state_lock_path(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(SENDER_STATE_LOCK_FILE)
}

struct SenderStateLockGuard {
    path: PathBuf,
    _file: fs::File,
}

impl Drop for SenderStateLockGuard {
    fn drop(&mut self) {
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
    fs::create_dir_all(&paths.data_dir)
        .map_err(|error| format!("Failed to prepare sender state directory '{}': {error}", paths.data_dir.display()))?;

    let started_at = Instant::now();
    loop {
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let contents = format!("pid={}\nacquiredAt={}\n", std::process::id(), current_timestamp());
                file.write_all(contents.as_bytes())
                    .map_err(|error| format!("Failed to write sender state lock '{}': {error}", lock_path.display()))?;
                return Ok(SenderStateLockGuard {
                    path: lock_path,
                    _file: file,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                remove_stale_sender_state_lock(&lock_path);
                if started_at.elapsed() >= Duration::from_millis(SENDER_STATE_LOCK_TIMEOUT_MS) {
                    return Err(format!("Timed out waiting for exclusive access to '{}'.", sender_state_path(paths).display()));
                }
                std::thread::sleep(Duration::from_millis(SENDER_STATE_LOCK_RETRY_MS));
            }
            Err(error) => {
                return Err(format!("Failed to create sender state lock '{}': {error}", lock_path.display()));
            }
        }
    }
}

fn write_text_file_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    ));
    fs::write(&temp_path, contents)
        .map_err(|error| format!("Failed to write temporary file '{}': {error}", temp_path.display()))?;

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

fn default_notification_delivery_settings() -> NotificationDeliverySettings {
    NotificationDeliverySettings {
        windows_desktop_enabled: true,
        telegram: TelegramSettings {
            enabled: false,
            bot_token_stored: false,
            chat_id: String::new(),
            preview_mode: "full".to_string(),
        },
    }
}

fn default_notification_delivery_snapshot() -> NotificationDeliverySnapshot {
    NotificationDeliverySnapshot {
        settings: default_notification_delivery_settings(),
        telegram_state: TelegramState {
            status: "disabled".to_string(),
            last_checked_at: None,
            last_delivered_at: None,
            last_tested_at: None,
            last_error: None,
            last_resolved_chat_title: None,
        },
    }
}

fn load_sender_state_record(paths: &RuntimePaths) -> Result<SenderStateRecord, String> {
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

fn save_sender_state_record(paths: &RuntimePaths, state: &SenderStateRecord) -> Result<(), String> {
    let _guard = acquire_sender_state_lock(paths)?;
    save_sender_state_record_unlocked(paths, state)
}

fn save_sender_state_record_unlocked(paths: &RuntimePaths, state: &SenderStateRecord) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Failed to serialize sender state: {error}"))?;
    write_text_file_atomically(&sender_state_path(paths), contents.as_bytes())
}

fn update_sender_state_record<F>(paths: &RuntimePaths, updater: F) -> Result<SenderStateRecord, String>
where
    F: FnOnce(&mut SenderStateRecord),
{
    let _guard = acquire_sender_state_lock(paths)?;
    let mut state = load_sender_state_record(paths)?;
    updater(&mut state);
    save_sender_state_record_unlocked(paths, &state)?;
    load_sender_state_record(paths)
}

fn validate_session_id(session_id: &str) -> Result<&str, String> {
    if session_id.is_empty() || session_id.len() > SESSION_ID_MAX_LEN {
        return Err("Invalid session id.".to_string());
    }

    let mut chars = session_id.chars();
    let Some(first) = chars.next() else {
        return Err("Invalid session id.".to_string());
    };

    if !first.is_ascii_alphanumeric() {
        return Err("Invalid session id.".to_string());
    }

    if !chars.all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-') {
        return Err("Invalid session id.".to_string());
    }

    Ok(session_id)
}

fn resolve_session_log_path(paths: &RuntimePaths, session_id: &str) -> Result<PathBuf, String> {
    let valid_session_id = validate_session_id(session_id)?;
    let log_path = paths.logs_dir.join(format!("{valid_session_id}.jsonl"));
    let canonical_logs_dir = paths
        .logs_dir
        .canonicalize()
        .unwrap_or_else(|_| paths.logs_dir.clone());
    let canonical_parent = log_path
        .parent()
        .map(|parent| parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf()))
        .ok_or_else(|| "Invalid session id.".to_string())?;

    if !canonical_parent.starts_with(&canonical_logs_dir) {
        return Err("Invalid session id.".to_string());
    }

    Ok(log_path)
}

fn support_bundle_dir(paths: &RuntimePaths) -> PathBuf {
    paths.data_dir.join(SUPPORT_BUNDLE_DIR)
}

fn current_timestamp() -> String {
    Utc::now().to_rfc3339()
}

fn runtime_data_dir_override() -> Option<PathBuf> {
    env::var_os(APPDATA_OVERRIDE_ENV)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
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
    let Some(next_contents) = scrub_discord_token_from_env_contents(&contents) else {
        if contents.lines().count() == 0 {
            return Ok(());
        }

        fs::remove_file(path)
            .map_err(|error| format!("Failed to remove '{}' after token migration: {error}", path.display()))?;
        return Ok(());
    };

    if next_contents == contents {
        return Ok(());
    }

    fs::write(path, next_contents)
        .map_err(|error| format!("Failed to update '{}' after token migration: {error}", path.display()))
}

fn scrub_discord_token_from_env_contents(contents: &str) -> Option<String> {
    let next_lines = contents
        .lines()
        .filter(|line| {
            let trimmed = line.trim();
            !(trimmed.starts_with("DISCORD_TOKEN=") || trimmed.starts_with("DISCORD_TOKEN ="))
        })
        .collect::<Vec<_>>();

    if next_lines.is_empty() {
        return None;
    }

    Some(format!("{}\n", next_lines.join("\n")))
}

fn token_storage_mode(secure_present: bool) -> &'static str {
    if secure_present {
        "secure"
    } else {
        "missing"
    }
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

fn clear_secure_token_files(paths: &RuntimePaths) -> Result<(), String> {
    let secure_path = secure_token_path(paths);
    if secure_path.exists() {
        fs::remove_file(&secure_path)
            .map_err(|error| format!("Failed to remove '{}': {error}", secure_path.display()))?;
    }

    scrub_discord_token_from_env_file(&environment_path(paths))
}

fn read_telegram_bot_token(paths: &RuntimePaths) -> Result<Option<String>, String> {
    let secure_path = telegram_bot_token_path(paths);
    if !secure_path.exists() {
        return Ok(None);
    }

    let encrypted = fs::read(&secure_path)
        .map_err(|error| format!("Failed to read '{}': {error}", secure_path.display()))?;
    let token = unprotect_token(&encrypted)?;
    Ok(normalize_token(token))
}

fn write_telegram_bot_token(paths: &RuntimePaths, token: &str) -> Result<(), String> {
    let encrypted = protect_token(token)?;
    fs::write(telegram_bot_token_path(paths), encrypted)
        .map_err(|error| format!("Failed to write the secure Telegram bot token store: {error}"))
}

fn clear_telegram_bot_token_files(paths: &RuntimePaths) -> Result<(), String> {
    let secure_path = telegram_bot_token_path(paths);
    if secure_path.exists() {
        fs::remove_file(&secure_path)
            .map_err(|error| format!("Failed to remove '{}': {error}", secure_path.display()))?;
    }

    Ok(())
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
            preview_mode: "full".to_string(),
        },
    }
}

fn resolve_telegram_state(settings: &NotificationDeliverySettings, previous: Option<&TelegramState>) -> TelegramState {
    let default_status = if !settings.telegram.enabled {
        "disabled".to_string()
    } else if !settings.telegram.bot_token_stored || settings.telegram.chat_id.trim().is_empty() {
        "unconfigured".to_string()
    } else if let Some(previous) = previous {
        if previous.status == "failed" || previous.status == "testing" {
            previous.status.clone()
        } else {
            "ready".to_string()
        }
    } else {
        "ready".to_string()
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
        last_error: if default_status == "failed" { previous.last_error } else { None },
        last_resolved_chat_title: previous.last_resolved_chat_title,
    }
}

fn load_notification_delivery_snapshot(paths: &RuntimePaths) -> Result<NotificationDeliverySnapshot, String> {
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

fn persist_notification_delivery_snapshot(
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

fn resolve_effective_token(app: &AppHandle) -> Result<Option<String>, String> {
    let paths = runtime_paths(app)?;
    read_secure_token(&paths)
}

fn read_desktop_setup_state(paths: &RuntimePaths) -> Result<DesktopSetupState, String> {
    let secure_store_path = secure_token_path(&paths);
    let env_path = environment_path(&paths);

    let (secure_token, warning) = match read_secure_token(&paths) {
        Ok(token) => (token, None),
        Err(error) => (None, Some(error)),
    };
    let token_present = secure_token.is_some();
    let token_storage = token_storage_mode(secure_token.is_some());

    Ok(DesktopSetupState {
        token_present,
        token_storage: token_storage.to_string(),
        data_dir: path_to_string(&paths.data_dir),
        secure_store_path: path_to_string(&secure_store_path),
        env_path: path_to_string(&env_path),
        config_path: path_to_string(&config_path(paths)),
        state_path: path_to_string(&sender_state_path(paths)),
        logs_dir: path_to_string(&paths.logs_dir),
        warning,
    })
}

fn load_desktop_setup_state(app: &AppHandle) -> Result<DesktopSetupState, String> {
    let paths = runtime_paths(app)?;
    read_desktop_setup_state(&paths)
}

fn save_secure_environment(app: &AppHandle, request: SaveEnvironmentRequest) -> Result<DesktopSetupState, String> {
    let normalized_token = normalize_token(request.discord_token)
        .ok_or_else(|| "DISCORD_TOKEN cannot be empty.".to_string())?;
    let paths = runtime_paths(app)?;
    write_secure_token(&paths, &normalized_token)?;
    scrub_discord_token_from_env_file(&environment_path(&paths))?;
    read_desktop_setup_state(&paths)
}

fn clear_secure_environment(app: &AppHandle) -> Result<DesktopSetupState, String> {
    let paths = runtime_paths(app)?;
    clear_secure_token_files(&paths)?;
    read_desktop_setup_state(&paths)
}

fn sidecar_status_value(app: &AppHandle) -> Result<SidecarStatus, String> {
    let state = app.state::<AppRuntime>();
    let sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "Failed to lock desktop sidecar.".to_string())?;
    Ok(sidecar.status.clone())
}

fn build_release_diagnostics(paths: &RuntimePaths, app_version: &str, token_storage: &str, sidecar_status: SidecarStatus) -> ReleaseDiagnostics {
    ReleaseDiagnostics {
        app_version: app_version.to_string(),
        data_dir: path_to_string(&paths.data_dir),
        logs_dir: path_to_string(&paths.logs_dir),
        config_path: path_to_string(&config_path(paths)),
        state_path: path_to_string(&sender_state_path(paths)),
        secure_store_path: path_to_string(&secure_token_path(paths)),
        token_storage: token_storage.to_string(),
        sidecar_status,
    }
}

fn load_release_diagnostics_state(app: &AppHandle) -> Result<ReleaseDiagnostics, String> {
    let paths = runtime_paths(app)?;
    let setup_state = read_desktop_setup_state(&paths)?;
    let sidecar_status = sidecar_status_value(app)?;
    Ok(build_release_diagnostics(
        &paths,
        &app.package_info().version.to_string(),
        &setup_state.token_storage,
        sidecar_status,
    ))
}

fn open_path_in_file_manager(path: &Path) -> Result<String, String> {
    if cfg!(target_os = "windows") {
        let mut command = Command::new("explorer.exe");
        if path.is_file() {
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }

        command
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
    } else if cfg!(target_os = "macos") {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
    } else {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| format!("Failed to open '{}': {error}", path.display()))?;
    }

    Ok(path_to_string(path))
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

fn sanitize_telegram_error(message: String, token: Option<&str>) -> String {
    let Some(token) = token.filter(|value| !value.is_empty()) else {
        return message;
    };

    message.replace(token, "[REDACTED]")
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

fn export_support_bundle_at_paths(
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

fn reset_runtime_state_at_paths(paths: &RuntimePaths) -> Result<ResetRuntimeStateResult, String> {
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
    migrate_plaintext_token_to_secure_store_at_paths(&paths, &legacy_runtime_roots())
}

fn migrate_plaintext_token_to_secure_store_at_paths(paths: &RuntimePaths, legacy_roots: &[PathBuf]) -> Result<(), String> {
    let data_env_path = environment_path(&paths);
    let secure_token = read_secure_token(&paths).ok().flatten();

    if secure_token.is_none() {
        if let Some(token) = read_plaintext_token_from_env_file(&data_env_path)? {
            write_secure_token(&paths, &token)?;
        } else {
            for legacy_root in legacy_roots {
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

fn mark_sidecar_status(sidecar: &mut ManagedSidecar, status: SidecarStatus, message: Option<String>) {
    sidecar.status = status;
    sidecar.last_error = message;
}

fn clear_sidecar(sidecar: &mut ManagedSidecar, error: &str, status: SidecarStatus) {
    sidecar.child = None;
    sidecar.stdin = None;
    sidecar.session_state = None;
    mark_sidecar_status(sidecar, status, Some(error.to_string()));
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
                            if event.event.get("type").and_then(Value::as_str) == Some("sidecar_ready") {
                                mark_sidecar_status(&mut sidecar, SidecarStatus::Ready, None);
                            }
                        };
                    }
                    if event.event.get("type").and_then(Value::as_str) == Some("sidecar_ready") {
                        let app_handle = app.clone();
                        std::thread::spawn(move || {
                            let _ = restore_inbox_monitor_if_enabled(&app_handle);
                        });
                    }
                    if event.event.get("type").and_then(Value::as_str) == Some("inbox_notification_ready") {
                        let _ = handle_inbox_notification_event(&app, &event.event);
                    }
                    let _ = app.emit("app-event", event.event);
                    continue;
                }
            }

            {
                let state = app.state::<AppRuntime>();
                if let Ok(mut sidecar) = state.sidecar.lock() {
                    mark_sidecar_status(
                        &mut sidecar,
                        SidecarStatus::Failed,
                        Some(format!("Desktop sidecar produced an invalid message: {trimmed}")),
                    );
                };
            }
            let _ = app.emit(
                "app-event",
                json!({
                    "type": "sidecar_error",
                    "status": "failed",
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

            {
                let state = app.state::<AppRuntime>();
                if let Ok(mut sidecar) = state.sidecar.lock() {
                    mark_sidecar_status(&mut sidecar, SidecarStatus::Failed, Some(trimmed.clone()));
                };
            }
            let _ = app.emit(
                "app-event",
                json!({
                    "type": "sidecar_error",
                    "status": "failed",
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
                    clear_sidecar(&mut sidecar, "Desktop sidecar stopped.", SidecarStatus::Restarting);
                }
            }
        }

        if sidecar.status != SidecarStatus::Restarting {
            mark_sidecar_status(&mut sidecar, SidecarStatus::Connecting, None);
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
        .map_err(|error| {
            if let Ok(mut sidecar) = app.state::<AppRuntime>().sidecar.lock() {
                mark_sidecar_status(
                    &mut sidecar,
                    SidecarStatus::Failed,
                    Some(format!("Failed to start desktop sidecar: {error}")),
                );
            }
            format!("Failed to start desktop sidecar: {error}")
        })?;

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
        if sidecar.status != SidecarStatus::Restarting {
            mark_sidecar_status(&mut sidecar, SidecarStatus::Connecting, None);
        }
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
                        clear_sidecar(&mut sidecar, "Desktop sidecar stopped unexpectedly.", SidecarStatus::Restarting);
                        true
                    }
                    Ok(None) => false,
                    Err(_) => {
                        clear_sidecar(&mut sidecar, "Desktop sidecar status could not be read.", SidecarStatus::Restarting);
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
                    "status": "restarting",
                    "message": "Desktop runtime restarted after an unexpected sidecar exit."
                }),
            );
            if let Err(error) = start_sidecar_process(&app) {
                if let Ok(mut sidecar) = app.state::<AppRuntime>().sidecar.lock() {
                    mark_sidecar_status(&mut sidecar, SidecarStatus::Failed, Some(error.clone()));
                }
                let _ = app.emit(
                    "app-event",
                    json!({
                        "type": "sidecar_error",
                        "status": "failed",
                        "message": error
                    }),
                );
            }
        }
    });
}

fn ensure_sidecar_running(app: &AppHandle) -> Result<(), String> {
    start_sidecar_process(app)
}

fn restore_inbox_monitor_if_enabled(app: &AppHandle) -> Result<Option<InboxMonitorState>, String> {
    let settings: InboxMonitorSettings = send_sidecar_request(app, "load_inbox_monitor_settings", json!({}))?;
    if !settings.enabled {
        return Ok(None);
    }

    let token = resolve_effective_token(app)?;
    let state: InboxMonitorState = send_sidecar_request(
        app,
        "start_inbox_monitor",
        StartInboxMonitorRequest { token },
    )?;
    Ok(Some(state))
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

fn detect_telegram_chat_with_token(token: &str) -> Result<TelegramChatDetectionResult, String> {
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

fn send_telegram_message(token: &str, chat_id: &str, text: &str) -> Result<(), String> {
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

fn handle_inbox_notification_event(app: &AppHandle, event: &Value) -> Result<(), String> {
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
            snapshot.telegram_state.status = "unconfigured".to_string();
            snapshot.telegram_state.last_error = Some("Telegram bot token is missing.".to_string());
            let _ = persist_notification_delivery_snapshot(app, snapshot);
            return Ok(());
        }
    };

    if snapshot.settings.telegram.chat_id.trim().is_empty() {
        snapshot.telegram_state.status = "unconfigured".to_string();
        snapshot.telegram_state.last_error = Some("Telegram chat ID is missing.".to_string());
        let _ = persist_notification_delivery_snapshot(app, snapshot);
        return Ok(());
    }

    let message = match telegram_message_body_from_event(event) {
        Ok(message) => message,
        Err(error) => {
            snapshot.telegram_state.status = "failed".to_string();
            snapshot.telegram_state.last_error = Some(error.clone());
            let _ = persist_notification_delivery_snapshot(app, snapshot);
            return Err(error);
        }
    };

    match send_telegram_message(&token, &snapshot.settings.telegram.chat_id, &message) {
        Ok(()) => {
            snapshot.telegram_state.status = "ready".to_string();
            snapshot.telegram_state.last_delivered_at = Some(current_timestamp());
            snapshot.telegram_state.last_error = None;
            let _ = persist_notification_delivery_snapshot(app, snapshot);
        }
        Err(error) => {
            snapshot.telegram_state.status = "failed".to_string();
            snapshot.telegram_state.last_error = Some(error);
            let _ = persist_notification_delivery_snapshot(app, snapshot);
        }
    }

    Ok(())
}

fn ensure_no_active_session(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppRuntime>();
    let sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "Failed to lock desktop sidecar.".to_string())?;

    if session_should_block_close(&sidecar) {
        return Err("Stop the active session before resetting runtime state.".to_string());
    }

    Ok(())
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

    let response = match rx.recv_timeout(Duration::from_secs(60)) {
        Ok(response) => response,
        Err(_) => {
            let state = app.state::<AppRuntime>();
            if let Ok(mut sidecar) = state.sidecar.lock() {
                sidecar.pending.remove(&request_id);
            }
            return Err(format!("Timed out waiting for desktop sidecar response for '{command}'."));
        }
    };

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
    let setup = save_secure_environment(&app, request)?;
    let _ = restore_inbox_monitor_if_enabled(&app);
    Ok(setup)
}

#[tauri::command]
fn clear_secure_token(app: AppHandle) -> Result<DesktopSetupState, String> {
    let setup = clear_secure_environment(&app)?;
    let _ = stop_inbox_monitor(app.clone());
    Ok(setup)
}

#[tauri::command]
fn load_inbox_monitor_settings(app: AppHandle) -> Result<InboxMonitorSettings, String> {
    send_sidecar_request(&app, "load_inbox_monitor_settings", json!({}))
}

#[tauri::command]
fn save_inbox_monitor_settings(
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
fn get_inbox_monitor_state(app: AppHandle) -> Result<InboxMonitorState, String> {
    send_sidecar_request(&app, "get_inbox_monitor_state", json!({}))
}

#[tauri::command]
fn start_inbox_monitor(app: AppHandle) -> Result<InboxMonitorState, String> {
    let token = resolve_effective_token(&app)?;
    send_sidecar_request(&app, "start_inbox_monitor", StartInboxMonitorRequest { token })
}

#[tauri::command]
fn stop_inbox_monitor(app: AppHandle) -> Result<InboxMonitorState, String> {
    send_sidecar_request(&app, "stop_inbox_monitor", json!({}))
}

#[tauri::command]
fn load_notification_delivery_settings(app: AppHandle) -> Result<NotificationDeliverySettings, String> {
    Ok(load_notification_delivery_snapshot(&runtime_paths(&app)?)?.settings)
}

#[tauri::command]
fn save_notification_delivery_settings(
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
fn get_notification_delivery_state(app: AppHandle) -> Result<NotificationDeliverySnapshot, String> {
    load_notification_delivery_snapshot(&runtime_paths(&app)?)
}

#[tauri::command]
fn save_telegram_bot_token(
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
fn clear_telegram_bot_token(app: AppHandle) -> Result<NotificationDeliverySnapshot, String> {
    let paths = runtime_paths(&app)?;
    clear_telegram_bot_token_files(&paths)?;
    let mut snapshot = load_notification_delivery_snapshot(&paths)?;
    snapshot.settings.telegram.bot_token_stored = false;
    snapshot.settings.telegram.enabled = false;
    persist_notification_delivery_snapshot(&app, snapshot)
}

#[tauri::command]
async fn detect_telegram_chat(app: AppHandle) -> Result<TelegramChatDetectionResult, String> {
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
async fn send_test_telegram_notification(app: AppHandle) -> Result<TelegramTestResult, String> {
    let paths = runtime_paths(&app)?;
    let token = read_telegram_bot_token(&paths)?
        .ok_or_else(|| "Save a Telegram bot token before sending a test notification.".to_string())?;
    let mut snapshot = load_notification_delivery_snapshot(&paths)?;
    let chat_id = snapshot.settings.telegram.chat_id.clone();
    if chat_id.trim().is_empty() {
        return Err("Save or detect a Telegram chat ID before sending a test notification.".to_string());
    }

    snapshot.telegram_state.status = "testing".to_string();
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
            snapshot.telegram_state.status = "ready".to_string();
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
            snapshot.telegram_state.status = "failed".to_string();
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

#[tauri::command]
fn discard_resume_session(app: AppHandle) -> Result<SenderStateRecord, String> {
    send_sidecar_request(&app, "discard_resume_session", json!({}))
}

#[tauri::command]
fn load_release_diagnostics(app: AppHandle) -> Result<ReleaseDiagnostics, String> {
    load_release_diagnostics_state(&app)
}

#[tauri::command]
fn open_logs_directory(app: AppHandle) -> Result<String, String> {
    let logs_dir = runtime_paths(&app)?.logs_dir;
    open_path_in_file_manager(&logs_dir)
}

#[tauri::command]
fn export_support_bundle(app: AppHandle) -> Result<SupportBundleResult, String> {
    let paths = runtime_paths(&app)?;
    let setup = read_desktop_setup_state(&paths)?;
    let diagnostics = build_release_diagnostics(
        &paths,
        &app.package_info().version.to_string(),
        &setup.token_storage,
        sidecar_status_value(&app)?,
    );
    export_support_bundle_at_paths(&paths, &diagnostics, &setup)
}

#[tauri::command]
fn reset_runtime_state(app: AppHandle) -> Result<ResetRuntimeStateResult, String> {
    ensure_no_active_session(&app)?;
    let paths = runtime_paths(&app)?;
    reset_runtime_state_at_paths(&paths)
}

#[tauri::command]
fn open_log_file(app: AppHandle, request: OpenLogFileRequest) -> Result<String, String> {
    let paths = runtime_paths(&app)?;
    let log_path = resolve_session_log_path(&paths, &request.session_id)?;
    open_path_in_file_manager(&log_path)
}

#[tauri::command]
fn open_data_directory(app: AppHandle) -> Result<String, String> {
    let data_dir = runtime_paths(&app)?.data_dir;
    open_path_in_file_manager(&data_dir)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CliCommand {
    PrintReleaseDiagnosticsJson,
    ExportSupportBundleJson,
    ResetRuntimeStateJson,
}

fn cli_command_from_iter<I>(args: I) -> Option<CliCommand>
where
    I: IntoIterator<Item = String>,
{
    args.into_iter().find_map(|arg| match arg.as_str() {
        "--print-release-diagnostics-json" => Some(CliCommand::PrintReleaseDiagnosticsJson),
        "--export-support-bundle-json" => Some(CliCommand::ExportSupportBundleJson),
        "--reset-runtime-state-json" => Some(CliCommand::ResetRuntimeStateJson),
        _ => None,
    })
}

fn cli_command_requested() -> Option<CliCommand> {
    cli_command_from_iter(env::args())
}

fn print_cli_json<T: Serialize>(payload: &T) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(payload).map_err(|error| format!("Failed to serialize CLI payload: {error}"))?
    );
    std::io::stdout()
        .flush()
        .map_err(|error| format!("Failed to flush CLI output: {error}"))?;
    Ok(())
}

fn handle_cli_command(app: &AppHandle, command: CliCommand) -> Result<(), String> {
    match command {
        CliCommand::PrintReleaseDiagnosticsJson => {
            let diagnostics = load_release_diagnostics_state(app)?;
            print_cli_json(&diagnostics)
        }
        CliCommand::ExportSupportBundleJson => {
            let bundle = export_support_bundle(app.clone())?;
            print_cli_json(&bundle)
        }
        CliCommand::ResetRuntimeStateJson => {
            let result = reset_runtime_state_at_paths(&runtime_paths(app)?)?;
            print_cli_json(&result)
        }
    }
}

#[cfg(not(test))]
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppRuntime::new())
        .setup(|app| {
            migrate_legacy_runtime_data(&app.handle())?;
            migrate_plaintext_token_to_secure_store(&app.handle())?;
            if let Some(command) = cli_command_requested() {
                handle_cli_command(&app.handle(), command)?;
                std::process::exit(0);
            }
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
            clear_secure_token,
            load_inbox_monitor_settings,
            save_inbox_monitor_settings,
            get_inbox_monitor_state,
            start_inbox_monitor,
            stop_inbox_monitor,
            load_notification_delivery_settings,
            save_notification_delivery_settings,
            get_notification_delivery_state,
            save_telegram_bot_token,
            clear_telegram_bot_token,
            detect_telegram_chat,
            send_test_telegram_notification,
            discard_resume_session,
            load_release_diagnostics,
            open_logs_directory,
            export_support_bundle,
            reset_runtime_state,
            open_log_file,
            open_data_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
fn main() {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, sync::OnceLock};

    static ENV_TEST_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

    fn env_test_mutex() -> &'static Mutex<()> {
        ENV_TEST_MUTEX.get_or_init(|| Mutex::new(()))
    }

    fn temp_runtime_paths(prefix: &str) -> RuntimePaths {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("{prefix}-{}-{unique}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let data_dir = root.join("data");
        let logs_dir = data_dir.join(RUNTIME_LOG_DIR);
        fs::create_dir_all(&logs_dir).expect("create logs dir");
        RuntimePaths { data_dir, logs_dir }
    }

    #[test]
    fn scrub_discord_token_from_env_contents_removes_only_token_lines() {
        let contents = "FOO=1\nDISCORD_TOKEN=test-token\nBAR=2\n";
        let scrubbed = scrub_discord_token_from_env_contents(contents).expect("scrubbed contents");
        assert_eq!(scrubbed, "FOO=1\nBAR=2\n");
    }

    #[test]
    fn build_release_diagnostics_reports_runtime_paths() {
        let paths = temp_runtime_paths("discord-release-diagnostics");
        let diagnostics = build_release_diagnostics(&paths, "1.2.3", "secure", SidecarStatus::Ready);

        assert_eq!(diagnostics.app_version, "1.2.3");
        assert_eq!(diagnostics.token_storage, "secure");
        assert_eq!(diagnostics.sidecar_status, SidecarStatus::Ready);
        assert!(diagnostics.data_dir.ends_with("data"));
        assert!(diagnostics.secure_store_path.ends_with(SECURE_TOKEN_FILE));
    }

    #[test]
    fn runtime_data_dir_override_reads_the_override_environment_variable() {
        let _guard = env_test_mutex().lock().expect("lock env test mutex");
        let override_path = std::env::temp_dir().join(format!("discord-runtime-override-{}", std::process::id()));
        std::env::set_var(APPDATA_OVERRIDE_ENV, &override_path);

        let resolved = runtime_data_dir_override();

        std::env::remove_var(APPDATA_OVERRIDE_ENV);
        assert_eq!(resolved, Some(override_path));
    }

    #[test]
    fn cli_command_parser_recognizes_release_cli_flags() {
        assert_eq!(
            cli_command_from_iter(["app.exe".to_string(), "--print-release-diagnostics-json".to_string()]),
            Some(CliCommand::PrintReleaseDiagnosticsJson)
        );
        assert_eq!(
            cli_command_from_iter(["app.exe".to_string(), "--export-support-bundle-json".to_string()]),
            Some(CliCommand::ExportSupportBundleJson)
        );
        assert_eq!(
            cli_command_from_iter(["app.exe".to_string(), "--reset-runtime-state-json".to_string()]),
            Some(CliCommand::ResetRuntimeStateJson)
        );
        assert_eq!(cli_command_from_iter(["app.exe".to_string()]), None);
    }

    #[test]
    fn open_logs_directory_helper_resolves_the_logs_path() {
        let paths = temp_runtime_paths("discord-open-logs");
        assert_eq!(path_to_string(&paths.logs_dir), path_to_string(&paths.logs_dir));
        assert!(path_to_string(&paths.logs_dir).ends_with(RUNTIME_LOG_DIR));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn clear_secure_token_files_removes_secure_store_and_scrubs_env() {
        let paths = temp_runtime_paths("discord-clear-token");
        write_secure_token(&paths, "secret-token").expect("write secure token");
        fs::write(environment_path(&paths), "DISCORD_TOKEN=secret-token\nOTHER_FLAG=1\n").expect("write env");

        clear_secure_token_files(&paths).expect("clear secure token files");

        assert!(!secure_token_path(&paths).exists());
        let env_contents = fs::read_to_string(environment_path(&paths)).expect("read scrubbed env");
        assert_eq!(env_contents, "OTHER_FLAG=1\n");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn migrate_plaintext_token_to_secure_store_copies_from_legacy_root_once() {
        let paths = temp_runtime_paths("discord-token-migrate");
        let legacy_root = paths.data_dir.parent().expect("runtime parent").join("legacy");
        fs::create_dir_all(&legacy_root).expect("create legacy root");
        fs::write(legacy_root.join(".env"), "DISCORD_TOKEN=legacy-token\n").expect("write legacy env");

        migrate_plaintext_token_to_secure_store_at_paths(&paths, &[legacy_root]).expect("migrate token");

        assert!(secure_token_path(&paths).exists());
        let setup = read_desktop_setup_state(&paths).expect("load setup state");
        assert_eq!(setup.token_storage, "secure");
        assert_eq!(setup.token_present, true);
        assert!(!environment_path(&paths).exists());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn export_support_bundle_excludes_secure_token_and_env_but_includes_generated_json() {
        let paths = temp_runtime_paths("discord-support-bundle");
        fs::write(
            config_path(&paths),
            serde_json::to_string_pretty(&json!({
                "userAgent": "UA",
                "channels": [{
                    "name": "general",
                    "id": "123",
                    "referrer": "https://discord.com/channels/@me/123",
                    "messageGroup": "default"
                }],
                "messageGroups": {
                    "default": ["secret template"]
                }
            }))
            .expect("serialize config"),
        )
        .expect("write config");
        fs::write(
            sender_state_path(&paths),
            serde_json::to_string_pretty(&json!({
                "schemaVersion": 1,
                "summaries": [],
                "recentFailures": [],
                "recentMessageHistory": {
                    "123": ["secret history"]
                },
                "lastSession": {
                    "id": "session-1",
                    "status": "completed",
                    "updatedAt": "2026-03-21T10:00:00.000Z",
                    "activeChannels": [],
                    "completedChannels": ["123"],
                    "failedChannels": [],
                    "sentMessages": 1,
                    "channelProgress": {
                        "123": {
                            "channelId": "123",
                            "channelName": "general",
                            "status": "completed",
                            "sentMessages": 1,
                            "sentToday": 1,
                            "consecutiveRateLimits": 0,
                            "lastMessage": "rendered secret"
                        }
                    }
                },
                "notificationDelivery": {
                    "settings": {
                        "windowsDesktopEnabled": true,
                        "telegram": {
                            "enabled": true,
                            "botTokenStored": true,
                            "chatId": "1",
                            "previewMode": "full"
                        }
                    },
                    "telegramState": {
                        "status": "failed",
                        "lastError": "Failed to call Telegram sendMessage: https://api.telegram.org/botsecret-telegram-token/sendMessage"
                    }
                }
            }))
            .expect("serialize sender state"),
        )
        .expect("write sender state");
        fs::write(environment_path(&paths), "DISCORD_TOKEN=plaintext-token\n").expect("write env");
        write_secure_token(&paths, "secret-token").expect("write secure token");
        write_telegram_bot_token(&paths, "secret-telegram-token").expect("write telegram token");

        for index in 0..6 {
            let log_path = paths.logs_dir.join(format!("session-{index}.jsonl"));
            fs::write(&log_path, format!("{{\"index\":{index}}}\n")).expect("write log");
        }

        let setup = read_desktop_setup_state(&paths).expect("load setup");
        let diagnostics = build_release_diagnostics(&paths, "1.0.0", "secure", SidecarStatus::Ready);
        let bundle = export_support_bundle_at_paths(&paths, &diagnostics, &setup).expect("export support bundle");

        let file = fs::File::open(&bundle.path).expect("open support bundle");
        let mut archive = zip::ZipArchive::new(file).expect("read support archive");
        let mut names = Vec::new();
        for index in 0..archive.len() {
            let entry = archive.by_index(index).expect("read archive entry");
            names.push(entry.name().to_string());
        }

        assert!(names.contains(&"diagnostics.json".to_string()));
        assert!(names.contains(&"setup.json".to_string()));
        assert!(names.contains(&"config.json".to_string()));
        assert!(names.contains(&".sender-state.json".to_string()));
        assert_eq!(names.iter().filter(|name| name.starts_with("logs/")).count(), 5);
        assert!(!names.iter().any(|name| name.contains("discord-token.secure")));
        assert!(!names.iter().any(|name| name.ends_with(".env")));

        let config_contents = {
            let mut config_entry = archive.by_name("config.json").expect("read config entry");
            let mut contents = String::new();
            std::io::Read::read_to_string(&mut config_entry, &mut contents).expect("read config contents");
            contents
        };
        assert!(!config_contents.contains("secret template"));
        assert!(config_contents.contains("[REDACTED 1 message template(s)]"));

        let state_contents = {
            let mut state_entry = archive.by_name(".sender-state.json").expect("read state entry");
            let mut contents = String::new();
            std::io::Read::read_to_string(&mut state_entry, &mut contents).expect("read state contents");
            contents
        };
        assert!(!state_contents.contains("secret history"));
        assert!(!state_contents.contains("rendered secret"));
        assert!(!state_contents.contains("secret-telegram-token"));
        assert!(state_contents.contains("[REDACTED 1 recent message(s)]"));
        assert!(state_contents.contains("[REDACTED]"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn reset_runtime_state_clears_state_and_logs_without_touching_support_archives() {
        let paths = temp_runtime_paths("discord-reset-runtime");
        fs::write(sender_state_path(&paths), "{\"schemaVersion\":1}").expect("write sender state");
        fs::write(paths.logs_dir.join("session-a.jsonl"), "{}\n").expect("write log a");
        fs::write(paths.logs_dir.join("session-b.jsonl"), "{}\n").expect("write log b");
        let support_dir = support_bundle_dir(&paths);
        fs::create_dir_all(&support_dir).expect("create support dir");
        fs::write(support_dir.join("keep.zip"), "bundle").expect("write support bundle");

        let result = reset_runtime_state_at_paths(&paths).expect("reset runtime state");

        assert!(result.ok);
        assert!(result.cleared_state_file);
        assert_eq!(result.deleted_log_files, 2);
        assert!(!sender_state_path(&paths).exists());
        assert_eq!(fs::read_dir(&paths.logs_dir).expect("read logs dir").count(), 0);
        assert!(support_dir.join("keep.zip").exists());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn read_desktop_setup_state_surfaces_warning_for_corrupted_secure_store() {
        let paths = temp_runtime_paths("discord-token-warning");
        fs::write(secure_token_path(&paths), [0_u8, 1, 2, 3]).expect("write corrupted secure token");

        let setup = read_desktop_setup_state(&paths).expect("load setup state");

        assert_eq!(setup.token_present, false);
        assert_eq!(setup.token_storage, "missing");
        assert!(setup.warning.is_some());
    }
}
