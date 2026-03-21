# Discord Auto Message Sender

Windows-only public beta desktop app for configuring, validating, previewing, and running local Discord message sessions with Bun, Tauri, Vite, and React.

## Public Beta Status

- Platform: Windows only
- Distribution: unsigned MSI installer
- Updates: manual only
- Auto-update: not included
- Downgrades: blocked by the installer

## Disclaimer

- Automating a personal Discord account can violate Discord's Terms of Service and platform policies.
- Repeated or unsolicited sending can trigger rate limits, restrictions, or account termination.
- Use this tool only if you understand and accept that risk.

## What The App Does

- Local config editing for channels, groups, and messages
- Dry run previews with no sends
- Preflight validation and access checks
- Start, pause, resume, and graceful stop controls
- Persistent logs, summaries, and resumable checkpoints
- Secure Windows token storage for packaged builds
- Support diagnostics and support-bundle export

## Install

### Public beta install

1. Download the latest Windows MSI.
2. Run the installer. Windows may show an unsigned-app warning.
3. Launch `Discord Auto Message Sender`.
4. Open `Config -> Desktop Setup`.
5. Save your Discord token with `Save Token Securely`.
6. Build or edit the config in the GUI.

### Developer install

Prerequisites:

- Bun 1.3+
- Rust/Cargo

```bash
bun install
```

Run the desktop app in development:

```bash
bun run dev
bun run desktop:dev
```

## Manual Update Flow

1. Close the app.
2. Install the newer MSI over the existing install.
3. Reopen the app.

Notes:

- There is no auto-update system.
- User data stays in the app-data directory.
- Installer downgrades are disabled.

## First-Time Setup

1. Open `Config -> Desktop Setup`.
2. Save `DISCORD_TOKEN` securely for the current Windows profile.
3. Create or edit your config in the GUI.
4. Run `Preflight`.
5. Run `Dry Run` if you want to preview routing and cadence without sending.
6. Start the session from the header or Session screen.

`Preflight` stays available even when setup is incomplete so the app can explain what is missing.

## Desktop Workflow

1. Configure channels, groups, and messages in `Config`.
2. Run `Dry Run`.
3. Run `Preflight`.
4. Start a session.
5. Pause, resume, or stop from `Session`.
6. Inspect logs in `Logs`.
7. Use `Support` for diagnostics, bundle export, and runtime reset.

## Security Model

- Packaged Windows builds store `DISCORD_TOKEN` in a DPAPI-protected local secure store.
- The frontend never receives the plaintext token back after save.
- Support exports exclude the secure token store, `.env`, and plaintext token values.
- Development builds can still use `DISCORD_TOKEN` from the shell environment or `.env`.

## Local Runtime Files

The packaged app keeps runtime data under the OS app-data directory. On Windows this is typically:

`%AppData%\com.local.discord-auto-message-sender`

Key files:

| Path | Purpose |
| --- | --- |
| `discord-token.secure` | DPAPI-protected token store for the packaged Windows app |
| `.env` | development and migration fallback only |
| `config.json` | canonical saved configuration |
| `.sender-state.json` | summaries, health data, and resumable checkpoint state |
| `logs/*.jsonl` | structured session logs |
| `support/*.zip` | exported support bundles |

The app can report the exact runtime paths from `Support -> Release Diagnostics`.

## Support Screen

The `Support` screen is the public-beta operator surface. It provides:

- app version
- runtime status
- token storage mode
- app-data, logs, config, state, and secure-token paths
- `Copy Diagnostics JSON`
- `Open Data Folder`
- `Open Logs Folder`
- `Export Support Bundle`
- `Reset Runtime State`

## Support Bundle Export

Use `Support -> Export Support Bundle` to generate a ZIP at:

`<dataDir>\support\discord-auto-message-sender-support-<timestamp>.zip`

When available, the export includes:

- `diagnostics.json`
- `setup.json`
- `config.json`
- `.sender-state.json`
- the latest 5 `logs/*.jsonl` files

The export does not include:

- `discord-token.secure`
- `.env`
- plaintext Discord tokens
- process environment dumps

## Reset Runtime State

Use `Support -> Reset Runtime State` when you need to clear local runtime history without deleting config or the secure token.

It removes:

- `.sender-state.json`
- session log files under `logs/`

It does not remove:

- `config.json`
- `discord-token.secure`
- `.env`
- support bundle archives

The action is blocked while a session is active.

## Troubleshooting

- `Token missing`
  Open `Config -> Desktop Setup` and save the token securely.
- `Stored token could not be decrypted`
  Save the token again from `Config -> Desktop Setup`.
- `Configuration missing or invalid`
  Rebuild the config in the GUI and save it again.
- `Runtime restarting` or `Runtime failed`
  Wait for the sidecar to reconnect, then review session/checkpoint state in `Session`.
- `HTTP 401`
  Your token is invalid or expired.
- `HTTP 403`
  The account cannot post in that channel.

## Issue Reporting

When reporting a bug:

1. Reproduce it if possible.
2. Open `Support`.
3. Export a support bundle.
4. Describe the exact screen, action, and expected result.
5. Attach the support ZIP.

See [SUPPORT.md](SUPPORT.md) for the support checklist and [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for current beta limitations.

## Release Verification

Run the full public-beta verification chain with:

```bash
bun run release:check
```

That runs:

1. `bun run typecheck`
2. `bun run test`
3. `cargo test --manifest-path src-tauri/Cargo.toml`
4. `bun run desktop:build`
5. `bun run smoke:desktop`
6. `bun run release:version-check`

You can also run the version guard by itself:

```bash
bun run release:version-check
```

## Packaging

Build the Windows MSI with:

```bash
bun run desktop:build
```

Artifacts are written under `src-tauri/target/release/`.

For the packaged boot smoke test:

```bash
bun run smoke:desktop
```

## Public Beta Smoke Checklist

1. Install the MSI.
2. Launch the app.
3. Save the token securely.
4. Save config.
5. Run preflight.
6. Start, pause, resume, and stop.
7. Restart and verify resume/discard checkpoint behavior.
8. Open `Support`.
9. Copy diagnostics JSON.
10. Export a support bundle.
11. Open the data folder and logs folder.
12. Reset runtime state.
13. Confirm config and secure token remain.
14. Confirm logs, summaries, and checkpoint data are cleared.

## Additional Docs

- [CHANGELOG.md](CHANGELOG.md)
- [SUPPORT.md](SUPPORT.md)
- [KNOWN_ISSUES.md](KNOWN_ISSUES.md)

## License

MIT. See [LICENSE](LICENSE).
