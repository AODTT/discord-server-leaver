# Discord Server Leaver

Discord Server Leaver helps you organize your Discord account by quickly removing unwanted servers. Select the servers you want to keep and leave all others, or choose specific servers to leave one-by-one. 

**Important:** You must be logged into Discord in your browser (discord.com) for this extension to work. It does not work with the Discord desktop app.

The extension is built for speed and simplicity, so you can clean up a crowded server list without the hassle. Whether you joined too many communities over time or just want a fresh start, Discord Server Leaver gives you an easy way to take control and stay organized.

## Features

- **Bulk Server Management** - Leave multiple servers at once
- **AI Search** - Search your Discord conversations with AI-powered context (3 free trial uses)
- **Discord Function Calling** - Send messages, search users, create DMs via AI commands
- **Smart Context** - Automatically fetches relevant Discord messages for trade analysis and more
- **Safe & Private** - All actions require confirmation, no data leaves your control

## Repository

- `apps/extension` — Chrome extension with AI chat and Discord API integration
- `apps/server` — TypeScript API, MongoDB logging, and analytics

## Local setup

1. Copy `.env.example` to `.env` and fill the required secrets.
2. Start MongoDB with `docker compose up -d mongo`, or provide a MongoDB Atlas URI.
3. Run `npm install`.
4. Start the API with `npm run dev:server`.
5. Build the extension with `npm run build -w @discord-memory/extension`.
6. Load `apps/extension/dist` as an unpacked extension in Chrome.
7. **Important:** Open discord.com in your browser and log in before using the extension.

## How to Use

1. Install the extension
2. Go to [discord.com](https://discord.com) and log in
3. Click the extension icon
4. Use the **Servers** tab to leave unwanted servers
5. Use the **AI** tab to search conversations and send messages

## Safety boundary

Leaving servers is destructive. The UI shows an exact preview, prevents owner guilds from being selected, requires typed confirmation, sends one request at a time, and reports every success/failure.
