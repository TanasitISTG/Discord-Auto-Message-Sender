# Discord Auto Message Sender

CLI tool for sending repeated text messages to one or more Discord channels through a supported Discord bot account.

## Security Model

- Authentication uses `DISCORD_BOT_TOKEN` from your environment or local `.env`.
- Secrets are not stored in `config.json`.
- `config.json` is ignored by Git. Use `config.example.json` as the template.
- This project only supports Discord bot authentication. User-token automation has been removed.

## Requirements

- Node.js 18+
- npm
- A Discord bot with access to the target server and channels

Minimum bot permissions:

- `View Channels`
- `Send Messages`

## Install

```bash
npm install
```

## Setup

1. Create a Discord application and bot in the Discord Developer Portal.
2. Invite the bot to your server with `View Channels` and `Send Messages`.
3. Copy `config.example.json` to `config.json`.
4. Copy `.env.example` to `.env`.
5. Set `DISCORD_BOT_TOKEN` in `.env`.
6. Update `config.json` and `messages.json`.

## Configuration

### `.env`

```bash
DISCORD_BOT_TOKEN=your_bot_token_here
```

### `config.json`

```json
{
  "channels": [
    {
      "name": "general",
      "id": "123456789012345678",
      "message_group": "default"
    }
  ]
}
```

Field reference:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `channels` | `Channel[]` | Yes | List of channels processed in parallel. |
| `channels[].name` | `string` | Yes | Display label used in logs. |
| `channels[].id` | `string` | Yes | Discord channel ID. Must be a valid snowflake. |
| `channels[].message_group` | `string` | No | Falls back to `default` when omitted. |

### `messages.json`

```json
{
  "default": [
    "Hello from your Discord bot!"
  ],
  "announcements": [
    "Daily update",
    "Status check"
  ]
}
```

Each key is a group name and each value is a non-empty array of message strings. Messages must be 1 to 2000 characters long.

## Wizard

Run:

```bash
npm run configure
```

The wizard can:

- show the bot token setup instructions
- list, add, and remove channels
- list groups, create groups, add messages, and delete messages

The wizard never stores or displays your bot token.

## Run

```bash
npm start
```

At startup the app validates:

- `DISCORD_BOT_TOKEN` exists
- `config.json` is valid
- every configured channel ID is a valid Discord snowflake
- every referenced message group exists

Then it:

- authenticates a shared `discord.js` client
- resolves each configured channel once
- starts one worker per channel
- retries transient send failures up to 3 times with exponential backoff and jitter
- stops only the failing channel on fatal send errors such as missing access or unknown channel

## Troubleshooting

- `Environment error`
  Set `DISCORD_BOT_TOKEN` in `.env` or your shell environment.
- `Configuration not found or invalid`
  Copy `config.example.json` to `config.json` and ensure it passes validation.
- `Missing message groups referenced by config`
  Add the missing groups to `messages.json` or update the channel configuration.
- `Configured channel '...' is missing or does not support text messages`
  Confirm the bot can access the channel and that the ID points to a text-sendable channel.
- `Send attempt failed`
  Review the logged status/code summary. The logger intentionally omits raw payloads and secrets.

## Verification

```bash
npm run typecheck
```

## License

MIT. See [LICENSE](LICENSE).
