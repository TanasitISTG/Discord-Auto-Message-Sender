# Discord Auto Message Sender

Local-first desktop app for configuring, previewing, validating, and running repeated Discord message sessions with a Bun, Tauri, Vite, and React stack.

## Disclaimer

- Automating a personal Discord account can violate Discord's Terms of Service and platform policies.
- Sending repeated or unsolicited messages can trigger rate limits, temporary access restrictions, or account termination.
- Use this tool only if you understand and accept that risk.

## Security Model

- Authentication uses `DISCORD_TOKEN` from your environment or local `.env`.
- Secrets are not stored in `config.json`.
- `config.json` is ignored by Git. Use `config.example.json` as the tracked template.
- Legacy `messages.json` files are only read for one-way compatibility with older configs.

## Requirements

- Bun 1.3+
- Rust/Cargo for the Tauri shell
- A personal Discord account token

## Install

```bash
bun install
```

## First-Time Setup

1. Copy `.env.example` to `.env`.
2. Set `DISCORD_TOKEN` in `.env` to your personal Discord token.
3. Optional: copy `config.example.json` to `config.json` if you want a starting template.
4. Launch the desktop app and build or edit the config in the GUI.

The app resolves `.env`, `config.json`, `logs/`, and `.sender-state.json` from the project root. It does not use a hosted backend or external database.

## Desktop Development

```bash
bun run dev
bun run desktop:dev
```

Desktop runtime architecture:

- the React UI calls Tauri commands
- Tauri supervises one long-lived Bun sidecar process
- the Bun sidecar owns config IO, preflight, dry-run, session control, logs, and persisted local state
- the TypeScript sender core still runs locally inside that sidecar

## Desktop Workflow

1. Open `Config` and create or edit channels, groups, and messages.
2. Run `Dry Run` to preview routing and cadence without sending anything.
3. Run `Preflight` to validate config and check channel access.
4. Start a session from the header or the Session screen.
5. Use `Pause`, `Resume`, or `Stop` from the Session screen while the run is active.
6. Review `Logs` and the dashboard summary after the run finishes.

## Configuration

### `.env`

```bash
DISCORD_TOKEN=your_token_here
```

### `config.json`

```json
{
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "channels": [
    {
      "name": "general",
      "id": "123456789012345678",
      "referrer": "https://discord.com/channels/@me/123456789012345678",
      "messageGroup": "default"
    }
  ],
  "messageGroups": {
    "default": [
      "Hello!"
    ]
  }
}
```

Field reference:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userAgent` | `string` | Yes | Browser User-Agent sent in every request. |
| `channels` | `AppChannel[]` | Yes | List of channels processed in parallel. |
| `channels[].name` | `string` | Yes | Display label used in logs. |
| `channels[].id` | `string` | Yes | Discord channel ID. Must be a valid snowflake. |
| `channels[].referrer` | `string` | No | URL sent as HTTP Referer header. Defaults to `https://discord.com/channels/@me/{id}` when omitted. |
| `channels[].messageGroup` | `string` | No | Must reference a key in `messageGroups`. Defaults to `default` when omitted. |
| `messageGroups` | `Record<string, string[]>` | Yes | Non-empty map of message groups. |

Compatibility notes:

- Older `config.json` files using `user_agent` and `message_group` are still read.
- If a legacy config is loaded, `messages.json` must still exist so message groups can be imported.
- Saving through the desktop UI writes only the new canonical `config.json` format.

## Local Files

The desktop runtime keeps everything local to the repository root:

| Path | Purpose |
| --- | --- |
| `.env` | Local token storage. |
| `config.json` | Canonical saved configuration. |
| `.sender-state.json` | Persistent summaries, health tracking, and resumable checkpoint data. |
| `logs/<session-id>.jsonl` | Structured per-session logs used by the Logs screen and export/open actions. |
| `messages.json` | Legacy import-only compatibility file for older configs. |

## Recovery And Reset

- If a run is interrupted safely enough to resume, the dashboard and Session screen show `Resume Session` and `Discard Checkpoint`.
- If `.sender-state.json` is corrupted, the app logs a warning and starts from a fresh local state.
- To fully reset local runtime state, stop the app and remove `.sender-state.json` plus any old files in `logs/`.
- Removing `.sender-state.json` does not delete `config.json` or `.env`.

## Troubleshooting

- `Environment error`
  Set `DISCORD_TOKEN` in `.env` or your shell environment.
- `Configuration not found or invalid`
  Copy `config.example.json` to `config.json`, then edit it in the desktop app.
- `HTTP 401`
  Your token is invalid or expired. Re-copy it from Discord.
- `HTTP 403`
  You do not have access to send messages in that channel.
- `Local sender state was corrupted and has been reset`
  Delete `.sender-state.json` if the warning persists after restart.

## Verification

```bash
bun run typecheck
bun run test
bun run build
```

## Desktop Packaging

Build a Windows installer with:

```bash
bun run desktop:build
```

Current packaging target:

- Windows MSI bundle

The packaged executable and installer artifacts are written under `src-tauri/target/release/`.

## Suggested Smoke Test

After a release build, verify this flow in the packaged desktop app:

1. Launch the app.
2. Load or create config in the GUI.
3. Save config.
4. Run dry run.
5. Run preflight.
6. Start a session, then pause, resume, and stop.
7. Restart the app and verify resume/discard checkpoint behavior.
8. Open the log file from the Logs screen.

## License

MIT. See [LICENSE](LICENSE).
