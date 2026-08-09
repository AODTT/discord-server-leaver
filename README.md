# Discord Memory Toolkit

A from-scratch, policy-conscious remake of **Discord Server Leaver**. It keeps the original bulk server-management workflow and adds local message-history import/search, cloud sync, cited AI retrieval, saved memories, credit packs, bot-based scheduling, and guarded keyword auto-replies.

The project intentionally does **not** accept raw Discord user tokens, inject scripts into Discord, or automate a normal Discord account. Complete personal history comes from a user-selected official Discord Data Package. Live messages and automation use an installed Discord bot in explicitly configured server channels.

## Repository

- `apps/extension` — Manifest V3 Chrome extension with IndexedDB-backed local history.
- `apps/server` — TypeScript API, Discord OAuth/bot, MongoDB storage, AI retrieval, Stripe credits, scheduler, and privacy endpoints.
- `docs` — setup, data handling, store disclosure, and acceptance checklist.

## Local setup

1. Copy `.env.example` to `.env` and fill the required secrets.
2. Start MongoDB with `docker compose up -d mongo`, or provide a MongoDB Atlas URI.
3. Run `npm install`.
4. Start the API with `npm run dev:server`.
5. Build the extension with `npm run build -w @discord-memory/extension`.
6. Load `apps/extension/dist` as an unpacked extension in Chrome.

OAuth, AI, bot automation, and checkout controls stay visibly unavailable until their server-side configuration exists. Local Data Package import/search works without a paid account.

## Safety boundary

Leaving servers is destructive. The UI shows an exact preview, prevents owner guilds from being selected, requires typed confirmation, sends one request at a time, and reports every success/failure. Scheduling and auto-replies are sent by the bot, require server-management permission, have minimum cooldowns and hourly caps, and can be disabled per rule or server.
