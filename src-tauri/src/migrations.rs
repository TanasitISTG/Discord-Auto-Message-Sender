use super::*;

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

pub(crate) fn migrate_legacy_runtime_data(app: &AppHandle) -> Result<(), String> {
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

pub(crate) fn migrate_plaintext_token_to_secure_store(app: &AppHandle) -> Result<(), String> {
    let paths = runtime_paths(app)?;
    migrate_plaintext_token_to_secure_store_at_paths(&paths, &legacy_runtime_roots())
}

pub(crate) fn migrate_plaintext_token_to_secure_store_at_paths(paths: &RuntimePaths, legacy_roots: &[PathBuf]) -> Result<(), String> {
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
