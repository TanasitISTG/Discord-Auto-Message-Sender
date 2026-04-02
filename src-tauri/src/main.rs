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

mod cli;
mod commands;
mod contracts;
mod migrations;
mod notification_delivery;
mod runtime_paths;
mod sender_state;
mod sidecar_process;
mod sidecar_manager;
mod support_bundle;
mod token_store;

use cli::*;
use commands::*;
use contracts::*;
use migrations::*;
use notification_delivery::*;
use runtime_paths::*;
use sender_state::*;
use sidecar_manager::*;
use support_bundle::*;
use token_store::*;

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
mod tests;
