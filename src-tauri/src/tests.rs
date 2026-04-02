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
    let diagnostics = build_release_diagnostics(
        &paths,
        "1.2.3",
        TokenStorageMode::Secure,
        SidecarStatus::Ready,
    );

    assert_eq!(diagnostics.app_version, "1.2.3");
    assert_eq!(diagnostics.token_storage, TokenStorageMode::Secure);
    assert_eq!(diagnostics.sidecar_status, SidecarStatus::Ready);
    assert!(diagnostics.data_dir.ends_with("data"));
    assert!(diagnostics.secure_store_path.ends_with(SECURE_TOKEN_FILE));
}

#[test]
fn runtime_data_dir_override_reads_the_override_environment_variable() {
    let _guard = env_test_mutex().lock().expect("lock env test mutex");
    let override_path =
        std::env::temp_dir().join(format!("discord-runtime-override-{}", std::process::id()));
    std::env::set_var(APPDATA_OVERRIDE_ENV, &override_path);

    let resolved = runtime_data_dir_override();

    std::env::remove_var(APPDATA_OVERRIDE_ENV);
    assert_eq!(resolved, Some(override_path));
}

#[test]
fn cli_command_parser_recognizes_release_cli_flags() {
    assert_eq!(
        cli_command_from_iter([
            "app.exe".to_string(),
            "--print-release-diagnostics-json".to_string()
        ]),
        Some(CliCommand::PrintReleaseDiagnosticsJson)
    );
    assert_eq!(
        cli_command_from_iter([
            "app.exe".to_string(),
            "--export-support-bundle-json".to_string()
        ]),
        Some(CliCommand::ExportSupportBundleJson)
    );
    assert_eq!(
        cli_command_from_iter([
            "app.exe".to_string(),
            "--reset-runtime-state-json".to_string()
        ]),
        Some(CliCommand::ResetRuntimeStateJson)
    );
    assert_eq!(cli_command_from_iter(["app.exe".to_string()]), None);
}

#[test]
fn open_logs_directory_helper_resolves_the_logs_path() {
    let paths = temp_runtime_paths("discord-open-logs");
    assert_eq!(
        path_to_string(&paths.logs_dir),
        path_to_string(&paths.logs_dir)
    );
    assert!(path_to_string(&paths.logs_dir).ends_with(RUNTIME_LOG_DIR));
}

#[cfg(target_os = "windows")]
#[test]
fn clear_secure_token_files_removes_secure_store_and_scrubs_env() {
    let paths = temp_runtime_paths("discord-clear-token");
    write_secure_token(&paths, "secret-token").expect("write secure token");
    fs::write(
        environment_path(&paths),
        "DISCORD_TOKEN=secret-token\nOTHER_FLAG=1\n",
    )
    .expect("write env");

    clear_secure_token_files(&paths).expect("clear secure token files");

    assert!(!secure_token_path(&paths).exists());
    let env_contents = fs::read_to_string(environment_path(&paths)).expect("read scrubbed env");
    assert_eq!(env_contents, "OTHER_FLAG=1\n");
}

#[cfg(target_os = "windows")]
#[test]
fn migrate_plaintext_token_to_secure_store_copies_from_legacy_root_once() {
    let paths = temp_runtime_paths("discord-token-migrate");
    let legacy_root = paths
        .data_dir
        .parent()
        .expect("runtime parent")
        .join("legacy");
    fs::create_dir_all(&legacy_root).expect("create legacy root");
    fs::write(legacy_root.join(".env"), "DISCORD_TOKEN=legacy-token\n").expect("write legacy env");

    migrate_plaintext_token_to_secure_store_at_paths(&paths, &[legacy_root])
        .expect("migrate token");

    assert!(secure_token_path(&paths).exists());
    let setup = read_desktop_setup_state(&paths).expect("load setup state");
    assert_eq!(setup.token_storage, TokenStorageMode::Secure);
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
    let diagnostics = build_release_diagnostics(
        &paths,
        "1.0.0",
        TokenStorageMode::Secure,
        SidecarStatus::Ready,
    );
    let bundle = export_support_bundle_at_paths(&paths, &diagnostics, &setup)
        .expect("export support bundle");

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
    assert_eq!(
        names
            .iter()
            .filter(|name| name.starts_with("logs/"))
            .count(),
        5
    );
    assert!(!names
        .iter()
        .any(|name| name.contains("discord-token.secure")));
    assert!(!names.iter().any(|name| name.ends_with(".env")));

    let config_contents = {
        let mut config_entry = archive.by_name("config.json").expect("read config entry");
        let mut contents = String::new();
        std::io::Read::read_to_string(&mut config_entry, &mut contents)
            .expect("read config contents");
        contents
    };
    assert!(!config_contents.contains("secret template"));
    assert!(config_contents.contains("[REDACTED 1 message template(s)]"));

    let state_contents = {
        let mut state_entry = archive
            .by_name(".sender-state.json")
            .expect("read state entry");
        let mut contents = String::new();
        std::io::Read::read_to_string(&mut state_entry, &mut contents)
            .expect("read state contents");
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
    assert_eq!(
        fs::read_dir(&paths.logs_dir)
            .expect("read logs dir")
            .count(),
        0
    );
    assert!(support_dir.join("keep.zip").exists());
}

#[cfg(target_os = "windows")]
#[test]
fn read_desktop_setup_state_surfaces_warning_for_corrupted_secure_store() {
    let paths = temp_runtime_paths("discord-token-warning");
    fs::write(secure_token_path(&paths), [0_u8, 1, 2, 3]).expect("write corrupted secure token");

    let setup = read_desktop_setup_state(&paths).expect("load setup state");

    assert_eq!(setup.token_present, false);
    assert_eq!(setup.token_storage, TokenStorageMode::Missing);
    assert!(setup.warning.is_some());
}
