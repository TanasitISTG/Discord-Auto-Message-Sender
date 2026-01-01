# Discord Auto Message Sender

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue) ![License](https://img.shields.io/badge/License-MIT-yellow)

A powerful, multi-channel auto-messaging bot for Discord, built with **Node.js** and **TypeScript**. 
Designed for performance, flexibility, and ease of use.

## 🚀 Features

-   **Multi-Channel Support**: Send messages to unlimited channels simultaneously.
-   **Message Groups**: Target specific channels with specific message sets (e.g., "Trade", "General", "Spam").
-   **Smart Rate Limiting**: Automatically handles Discord's `429 Too Many Requests` with dynamic backoff.
-   **Interactive Configuration**: Built-in CLI Menu for easy setup—no manual JSON editing required.
-   **Infinite Loop Mode**: Run indefinitely or stop after a set number of messages.

## 🛠️ Prerequisites

-   [Node.js](https://nodejs.org/) (v16 or higher)
-   [npm](https://www.npmjs.com/)

## 📦 Installation

1.  **Clone the repository** (or download the source):
    ```bash
    git clone https://github.com/TanasitISTG/Discord-Auto-Message-Sender.git
    cd Discord-Auto-Message-Sender
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

## ⚙️ Configuration

You can configure the bot entirely through the interactive CLI.

```bash
npx ts-node src/bot.ts --configure
```

This will launch the **Configuration Wizard**, where you can:
1.  **Edit Authentication**: Set your User Agent and Discord Token.
2.  **Manage Channels**: Add, remove, or list target channels.
3.  **Manage Messages**: Create message groups and add/remove messages.

### Manual Configuration
Alternatively, you can edit the JSON files directly:

**`config.json`**
```json
{
    "user_agent": "Mozilla/5.0 ...",
    "discord_token": "YOUR_TOKEN",
    "channels": [
        {
            "name": "Trade Channel",
            "id": "123456789",
            "referrer": "https://discord.com/channels/...",
            "message_group": "trade"
        }
    ]
}
```

**`messages.json`**
```json
{
    "default": ["Hello world"],
    "trade": ["Selling items!", "Buying gold!"]
}
```

## ▶️ Usage

Start the bot with a single command:

```bash
npx ts-node src/bot.ts
```

1.  Select the **Number of Messages** (Enter `0` for infinite).
2.  Set the **Base Wait Time** (in seconds).
3.  Set the **Random Error Margin** (extra random seconds added to wait time).

The bot will spawn concurrent workers for each channel and begin sending.

## ⚠️ Disclaimer

**Educational Purposes Only.**
Automating user accounts (Self-Botting) is against [Discord's Terms of Service](https://discord.com/terms). Using this tool may result in account termination. The authors are not responsible for any consequences resulting from the use of this software.

## 📄 License

This project is licensed under the MIT License.
