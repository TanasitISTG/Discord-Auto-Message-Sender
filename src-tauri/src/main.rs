use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

struct ManagedSession {
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    state: Option<Value>,
    session_id: Option<String>,
}

impl ManagedSession {
    fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            state: None,
            session_id: None,
        }
    }
}

struct AppRuntime {
    session: Mutex<ManagedSession>,
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

fn refresh_session(runtime: &mut ManagedSession) {
    if let Some(child) = runtime.child.as_mut() {
        if let Ok(Some(_)) = child.try_wait() {
            runtime.child = None;
            runtime.stdin = None;
        }
    }
}

fn session_should_block_close(runtime: &ManagedSession) -> bool {
    runtime
        .state
        .as_ref()
        .and_then(|state| state.get("status"))
        .and_then(|status| status.as_str())
        .map(|status| matches!(status, "running" | "paused" | "stopping"))
        .unwrap_or(false)
}

fn run_bridge_with_input(command_name: &str, payload: Value) -> Result<Value, String> {
    let mut child = Command::new(bun_executable())
        .arg("run")
        .arg("src/desktop/bridge.ts")
        .arg(command_name)
        .current_dir(project_root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to spawn Bun bridge: {error}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|error| format!("Failed to write bridge payload: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("Failed to wait for Bun bridge: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        return Err(if !stderr.is_empty() { stderr } else { stdout });
    }

    serde_json::from_str::<Value>(&stdout).map_err(|error| format!("Invalid bridge response: {error}"))
}

fn attach_stream_reader<R: std::io::Read + Send + 'static>(app: AppHandle, reader: R) {
    std::thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line in buffered.lines().flatten() {
            if line.trim().is_empty() {
                continue;
            }

            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if value.get("type") == Some(&Value::String("state".into())) {
                    if let Some(next_state) = value.get("state").cloned() {
                        {
                            let state = app.state::<AppRuntime>();
                            if let Ok(mut session) = state.session.lock() {
                                session.state = Some(next_state);
                            };
                        }
                    }
                }

                if let Some(next_state) = value.get("state").cloned() {
                    {
                        let state = app.state::<AppRuntime>();
                        if let Ok(mut session) = state.session.lock() {
                            session.state = Some(next_state);
                        };
                    }
                }

                let _ = app.emit("app-event", value);
            }
        }
    });
}

#[tauri::command]
fn load_config() -> Result<Value, String> {
    run_bridge_with_input("load-config", json!({}))
}

#[tauri::command]
fn save_config(config: Value) -> Result<Value, String> {
    run_bridge_with_input("save-config", json!({ "config": config }))
}

#[tauri::command]
fn run_preflight() -> Result<Value, String> {
    run_bridge_with_input("run-preflight", json!({}))
}

#[tauri::command]
fn run_dry_run(runtime: Value) -> Result<Value, String> {
    run_bridge_with_input("dry-run", json!({ "runtime": runtime }))
}

#[tauri::command]
fn start_session(
    num_messages: u32,
    base_wait_seconds: f64,
    margin_seconds: f64,
    app: AppHandle,
    state: State<'_, AppRuntime>,
) -> Result<Value, String> {
    let mut runtime = state.session.lock().map_err(|_| "Failed to lock session runtime.".to_string())?;
    refresh_session(&mut runtime);
    if runtime.child.is_some() {
        return Err("A desktop session is already running.".to_string());
    }

    let session_id = format!("session-{}", chrono_like_timestamp());
    let mut child = Command::new(bun_executable())
        .arg("run")
        .arg("src/desktop/session-worker.ts")
        .arg("--base-dir")
        .arg(project_root())
        .arg("--session-id")
        .arg(&session_id)
        .arg("--num-messages")
        .arg(num_messages.to_string())
        .arg("--base-wait-seconds")
        .arg(base_wait_seconds.to_string())
        .arg("--margin-seconds")
        .arg(margin_seconds.to_string())
        .current_dir(project_root())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start session worker: {error}"))?;

    let stdout: ChildStdout = child.stdout.take().ok_or_else(|| "Failed to capture session stdout.".to_string())?;
    let stderr: ChildStderr = child.stderr.take().ok_or_else(|| "Failed to capture session stderr.".to_string())?;
    let stdin = child.stdin.take().ok_or_else(|| "Failed to capture session stdin.".to_string())?;

    runtime.session_id = Some(session_id.clone());
    runtime.stdin = Some(stdin);
    runtime.child = Some(child);
    runtime.state = Some(json!({
        "id": session_id,
        "status": "running",
        "updatedAt": "",
        "activeChannels": [],
        "completedChannels": [],
        "failedChannels": [],
        "sentMessages": 0
    }));

    drop(runtime);

    attach_stream_reader(app.clone(), stdout);
    attach_stream_reader(app, stderr);

    let runtime = state.session.lock().map_err(|_| "Failed to lock session runtime.".to_string())?;
    Ok(runtime.state.clone().unwrap_or(Value::Null))
}

#[tauri::command]
fn pause_session(state: State<'_, AppRuntime>) -> Result<Value, String> {
    send_session_control(state, json!({ "action": "pause" }))
}

#[tauri::command]
fn resume_session(state: State<'_, AppRuntime>) -> Result<Value, String> {
    send_session_control(state, json!({ "action": "resume" }))
}

#[tauri::command]
fn stop_session(state: State<'_, AppRuntime>) -> Result<Value, String> {
    send_session_control(state, json!({ "action": "stop", "reason": "Stop requested from Tauri." }))
}

fn send_session_control(state: State<'_, AppRuntime>, payload: Value) -> Result<Value, String> {
    let mut runtime = state.session.lock().map_err(|_| "Failed to lock session runtime.".to_string())?;
    refresh_session(&mut runtime);

    if let Some(stdin) = runtime.stdin.as_mut() {
        stdin
            .write_all(format!("{}\n", payload).as_bytes())
            .map_err(|error| format!("Failed to send session control message: {error}"))?;
    }

    Ok(runtime.state.clone().unwrap_or(Value::Null))
}

#[tauri::command]
fn get_session_state(state: State<'_, AppRuntime>) -> Result<Value, String> {
    let mut runtime = state.session.lock().map_err(|_| "Failed to lock session runtime.".to_string())?;
    refresh_session(&mut runtime);
    Ok(runtime.state.clone().unwrap_or(Value::Null))
}

#[tauri::command]
fn load_logs(session_id: String) -> Result<Value, String> {
    run_bridge_with_input("load-logs", json!({ "sessionId": session_id }))
}

#[tauri::command]
fn load_state() -> Result<Value, String> {
    run_bridge_with_input("load-state", json!({}))
}

#[tauri::command]
fn open_log_file(session_id: String) -> Result<String, String> {
    let log_path = project_root().join("logs").join(format!("{session_id}.jsonl"));
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

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    millis.to_string()
}

fn main() {
    tauri::Builder::default()
        .manage(AppRuntime {
            session: Mutex::new(ManagedSession::new()),
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<AppRuntime>();
                if let Ok(mut runtime) = state.session.lock() {
                    refresh_session(&mut runtime);
                    if session_should_block_close(&runtime) {
                        api.prevent_close();
                        let _ = window.app_handle().emit("app-event", json!({
                            "type": "close_blocked",
                            "message": "A session is still active. Pause or stop it before closing the app.",
                            "state": runtime.state.clone().unwrap_or(Value::Null)
                        }));
                    }
                }
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
            open_log_file,
            load_logs,
            load_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
