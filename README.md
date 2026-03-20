# Discord Auto Message Sender

CLI tool for sending repeated text messages to one or more Discord channels using a personal Discord account token.

## Security Model

- Authentication uses `DISCORD_TOKEN` from your environment or local `.env`.
- Secrets are not stored in `config.json`.
- `config.json` is ignored by Git. Use `config.example.json` as the template.

## Requirements

- Node.js 18+
- npm
- A personal Discord account token

## Install

```bash
npm install
```

## Setup

1. Copy `config.example.json` to `config.json`.
2. Copy `.env.example` to `.env`.
3. Set `DISCORD_TOKEN` in `.env` to your personal Discord token.
4. Set `user_agent` in `config.json` to a browser User-Agent string.
5. Update channel IDs and `messages.json`.

## Configuration

### `.env`

```bash
DISCORD_TOKEN=your_token_here
```

### `config.json`

```json
{
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "channels": [
    {
      "name": "general",
      "id": "123456789012345678",
      "referrer": "https://discord.com/channels/@me/123456789012345678",
      "message_group": "default"
    }
  ]
}
```

Field reference:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `user_agent` | `string` | Yes | Browser User-Agent sent in every request. |
| `channels` | `Channel[]` | Yes | List of channels processed in parallel. |
| `channels[].name` | `string` | Yes | Display label used in logs. |
| `channels[].id` | `string` | Yes | Discord channel ID. Must be a valid snowflake. |
| `channels[].referrer` | `string` | No | URL sent as HTTP Referer header. Defaults to `https://discord.com/channels/@me/{id}`. |
| `channels[].message_group` | `string` | No | Falls back to `default` when omitted. |

### `messages.json`

```json
{
  "default": [
    "Hello!"
  ],
  "announcements": [
    "Daily update",
    "Status check"
  ]
}
```

Each key is a group name and each value is a non-empty array of message strings. Messages must be 1 to 2000 characters long.

## Wizard

```bash
npm run configure
```

The wizard can:

- show token setup instructions
- list, add, and remove channels
- list groups, create groups, add messages, and delete messages

## Run

```bash
npm start
```

At startup the app validates:

- `DISCORD_TOKEN` exists
- `config.json` is valid
- every configured channel ID is a valid Discord snowflake
- every referenced message group exists

Then it:

- builds channel targets from `config.json`
- starts one worker per channel
- retries transient send failures up to 3 times with exponential backoff and jitter
- handles 429 rate limits by waiting the `retry_after` duration

## Troubleshooting

- `Environment error`
  Set `DISCORD_TOKEN` in `.env` or your shell environment.
- `Configuration not found or invalid`
  Copy `config.example.json` to `config.json`. Make sure `user_agent` is present.
- `Missing message groups referenced by config`
  Add the missing groups to `messages.json` or update the channel configuration.
- `HTTP 401`
  Your token is invalid or expired. Re-copy it from Discord.
- `HTTP 403`
  You don't have access to send messages in that channel.

## Verification

```bash
npm run typecheck
```

## License

MIT. See [LICENSE](LICENSE).
