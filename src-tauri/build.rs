use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR is missing."));
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let profile = env::var("PROFILE").unwrap_or_default();
    let sidecar_name = if target_os == "windows" {
        "desktop-sidecar.exe"
    } else {
        "desktop-sidecar"
    };
    let sidecar_path = manifest_dir
        .join("resources")
        .join("sidecar")
        .join(sidecar_name);

    println!("cargo:rerun-if-changed={}", sidecar_path.display());

    if profile != "release" && !sidecar_path.exists() {
        let config_path = manifest_dir.join("tauri.conf.json");
        let config_text = fs::read_to_string(&config_path)
            .expect("Failed to read tauri.conf.json for debug/test build configuration.");
        let mut config: serde_json::Value = serde_json::from_str(&config_text)
            .expect("Failed to parse tauri.conf.json for debug/test build configuration.");

        if let Some(bundle) = config
            .get_mut("bundle")
            .and_then(|value| value.as_object_mut())
        {
            bundle.insert(
                "resources".to_string(),
                serde_json::Value::Object(serde_json::Map::new()),
            );
        }

        let generated_config =
            serde_json::to_string(&config).expect("Failed to serialize debug/test Tauri config.");
        env::set_var("TAURI_CONFIG", generated_config);
    }

    tauri_build::build()
}
