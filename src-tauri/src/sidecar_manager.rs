use super::*;

#[derive(Clone, Debug, Serialize)]
struct SidecarRequest<T: Serialize> {
    id: String,
    command: String,
    payload: T,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct SidecarResponseEnvelope {
    #[serde(rename = "type")]
    pub(crate) message_type: String,
    pub(crate) id: String,
    pub(crate) ok: bool,
    pub(crate) result: Option<Value>,
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) struct SidecarEventEnvelope {
    #[serde(rename = "type")]
    pub(crate) message_type: String,
    pub(crate) event: Value,
}

#[derive(Clone, Debug)]
pub(crate) struct PendingResponse {
    pub(crate) ok: bool,
    pub(crate) result: Option<Value>,
    pub(crate) error: Option<String>,
}

pub(crate) struct ManagedSidecar {
    pub(crate) child: Option<Child>,
    pub(crate) stdin: Option<ChildStdin>,
    pub(crate) session_state: Option<SessionSnapshot>,
    pub(crate) status: SidecarStatus,
    pub(crate) last_error: Option<String>,
    pub(crate) pending: HashMap<String, Sender<PendingResponse>>,
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

pub(crate) struct AppRuntime {
    pub(crate) sidecar: Mutex<ManagedSidecar>,
    next_request_id: AtomicU64,
}

impl AppRuntime {
    pub(crate) fn new() -> Self {
        Self {
            sidecar: Mutex::new(ManagedSidecar::new()),
            next_request_id: AtomicU64::new(1),
        }
    }
}

pub(crate) fn sidecar_status_value(app: &AppHandle) -> Result<SidecarStatus, String> {
    let state = app.state::<AppRuntime>();
    let sidecar = state
        .sidecar
        .lock()
        .map_err(|_| "Failed to lock desktop sidecar.".to_string())?;
    Ok(sidecar.status.clone())
}

fn next_request_id(app: &AppHandle) -> String {
    let state = app.state::<AppRuntime>();
    state.next_request_id.fetch_add(1, Ordering::Relaxed).to_string()
}

pub(crate) fn take_pending(sidecar: &mut ManagedSidecar, id: &str) -> Option<Sender<PendingResponse>> {
    sidecar.pending.remove(id)
}

pub(crate) fn mark_sidecar_status(sidecar: &mut ManagedSidecar, status: SidecarStatus, message: Option<String>) {
    sidecar.status = status;
    sidecar.last_error = message;
}

pub(crate) fn clear_sidecar(sidecar: &mut ManagedSidecar, error: &str, status: SidecarStatus) {
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

pub(crate) fn session_should_block_close(sidecar: &ManagedSidecar) -> bool {
    sidecar
        .session_state
        .as_ref()
        .map(|state| matches!(state.status.as_str(), "running" | "paused" | "stopping"))
        .unwrap_or(false)
}

pub(crate) fn start_sidecar_process(app: &AppHandle) -> Result<(), String> {
    crate::sidecar_process::start_sidecar_process(app)
}

pub(crate) fn start_sidecar_watcher(app: AppHandle) {
    crate::sidecar_process::start_sidecar_watcher(app);
}

fn ensure_sidecar_running(app: &AppHandle) -> Result<(), String> {
    start_sidecar_process(app)
}

pub(crate) fn restore_inbox_monitor_if_enabled(app: &AppHandle) -> Result<Option<InboxMonitorState>, String> {
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

pub(crate) fn ensure_no_active_session(app: &AppHandle) -> Result<(), String> {
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

pub(crate) fn send_sidecar_request<T, R>(app: &AppHandle, command: &str, payload: T) -> Result<R, String>
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
