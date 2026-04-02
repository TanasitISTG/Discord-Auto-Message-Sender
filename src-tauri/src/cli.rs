use crate::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CliCommand {
    PrintReleaseDiagnosticsJson,
    ExportSupportBundleJson,
    ResetRuntimeStateJson,
}

pub(crate) fn cli_command_from_iter<I>(args: I) -> Option<CliCommand>
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

pub(crate) fn cli_command_requested() -> Option<CliCommand> {
    cli_command_from_iter(env::args())
}

fn print_cli_json<T: Serialize>(payload: &T) -> Result<(), String> {
    println!(
        "{}",
        serde_json::to_string(payload)
            .map_err(|error| format!("Failed to serialize CLI payload: {error}"))?
    );
    std::io::stdout()
        .flush()
        .map_err(|error| format!("Failed to flush CLI output: {error}"))?;
    Ok(())
}

pub(crate) fn handle_cli_command(app: &AppHandle, command: CliCommand) -> Result<(), String> {
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
