use super::*;
use crate::sidecar_manager::{
    clear_sidecar, mark_sidecar_status, restore_inbox_monitor_if_enabled, take_pending, AppRuntime,
    SidecarEventEnvelope, SidecarResponseEnvelope,
};

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

fn update_cached_session_state(
    sidecar: &mut crate::sidecar_manager::ManagedSidecar,
    event: &Value,
) {
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
                        let _ = responder.send(crate::sidecar_manager::PendingResponse {
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
                            if event.event.get("type").and_then(Value::as_str)
                                == Some("sidecar_ready")
                            {
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
                    if event.event.get("type").and_then(Value::as_str)
                        == Some("inbox_notification_ready")
                    {
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
                        Some(format!(
                            "Desktop sidecar produced an invalid message: {trimmed}"
                        )),
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

pub(crate) fn start_sidecar_process(app: &AppHandle) -> Result<(), String> {
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
                    clear_sidecar(
                        &mut sidecar,
                        "Desktop sidecar stopped.",
                        SidecarStatus::Restarting,
                    );
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
        command
            .arg("run")
            .arg(sidecar_entry)
            .current_dir(project_root());
        command
    } else {
        return Err(
            "Could not locate a packaged desktop sidecar or the development sidecar entrypoint."
                .to_string(),
        );
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

pub(crate) fn start_sidecar_watcher(app: AppHandle) {
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
                        clear_sidecar(
                            &mut sidecar,
                            "Desktop sidecar stopped unexpectedly.",
                            SidecarStatus::Restarting,
                        );
                        true
                    }
                    Ok(None) => false,
                    Err(_) => {
                        clear_sidecar(
                            &mut sidecar,
                            "Desktop sidecar status could not be read.",
                            SidecarStatus::Restarting,
                        );
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
