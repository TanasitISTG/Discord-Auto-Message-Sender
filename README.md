# Discord Auto Message Sender

CLI tool for sending repeated text messages to one or more Discord channels using a personal Discord account token.

## Security Model

- Authentication uses `DISCORD_TOKEN` from your environment or local `.env`.
- Secrets are not stored in `config.json`.
- Legacy `messages.json` files are only read for one-way compatibility with older configs.

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
4. Update channel IDs and message groups in `config.json`.

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
| `channels[].referrer` | `string` | Yes | URL sent as HTTP Referer header. |
| `channels[].messageGroup` | `string` | Yes | Must reference a key in `messageGroups`. |
| `messageGroups` | `Record<string, string[]>` | Yes | Non-empty map of message groups. |

Legacy compatibility:

- Older `config.json` files using `user_agent` and `message_group` are still read.
- If a legacy config is loaded, `messages.json` must still exist so message groups can be imported.
- Saving through the wizard writes only the new canonical `config.json` format.

## Wizard

```bash
npm run configure
```

The wizard can:

- show token setup instructions
- update the request User-Agent
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
- every channel references an existing message group

Then it:

- starts one worker per channel
- retries transient send failures up to 3 times with exponential backoff and jitter
- handles `429` rate limits by waiting the `retry_after` duration

## Troubleshooting

- `Environment error`
  Set `DISCORD_TOKEN` in `.env` or your shell environment.
- `Configuration not found or invalid`
  Copy `config.example.json` to `config.json` or run `npm run configure`.
- `HTTP 401`
  Your token is invalid or expired. Re-copy it from Discord.
- `HTTP 403`
  You do not have access to send messages in that channel.

## Verification

```bash
npm run typecheck
npm test
```

## License

MIT. See [LICENSE](LICENSE).
