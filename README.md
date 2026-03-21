# Discord Auto Message Sender

Local-first desktop app for configuring and running repeated Discord message sessions with a Bun, Tauri, Vite, and React stack.

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

## Setup

1. Copy `config.example.json` to `config.json`.
2. Copy `.env.example` to `.env`.
3. Set `DISCORD_TOKEN` in `.env` to your personal Discord token.
4. Update channel IDs and message groups in `config.json`.
5. Keep `config.json` and `.env` in the project root so the desktop runtime can resolve them locally.

## Desktop Development

```bash
bun run dev
bun run desktop:dev
```

Desktop commands are local-only:

- the React UI calls Tauri commands
- Tauri supervises one long-lived Bun sidecar process
- the Bun sidecar owns config IO, preflight, dry-run, session control, logs, and persisted local state
- the TypeScript sender core still runs locally inside that sidecar

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

## Troubleshooting

- `Environment error`
  Set `DISCORD_TOKEN` in `.env` or your shell environment.
- `Configuration not found or invalid`
  Copy `config.example.json` to `config.json`, then edit it in the desktop app.
- `HTTP 401`
  Your token is invalid or expired. Re-copy it from Discord.
- `HTTP 403`
  You do not have access to send messages in that channel.

## Verification

```bash
bun run typecheck
bun test
bun run build
```

## License

MIT. See [LICENSE](LICENSE).
