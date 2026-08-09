# Discord Memory Toolkit - Deployment Guide

## Railway Deployment

### Prerequisites
1. [Railway account](https://railway.app)
2. MongoDB Atlas account (or Railway MongoDB plugin)
3. Discord application credentials
4. OpenAI API key
5. Stripe account (optional, for payments)

### Environment Variables

Set these in your Railway project settings:

```bash
# Server Configuration
NODE_ENV=production
PORT=3000

# MongoDB
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/discord-memory?retryWrites=true&w=majority
MONGODB_DB=discord-memory

# Discord OAuth
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_REDIRECT_URI=https://your-app.railway.app/auth/discord/callback

# Discord Bot (for scheduled messages & auto-replies)
DISCORD_BOT_TOKEN=your_bot_token

# OpenAI (for AI features)
OPENAI_API_KEY=sk-your-openai-api-key

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=your_random_jwt_secret_here

# App Configuration
APP_ORIGIN=https://your-app.railway.app
ALLOWED_ORIGINS=https://your-app.railway.app,chrome-extension://*

# Stripe (optional - for credit purchases)
STRIPE_SECRET_KEY=sk_live_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_PRICE_50=price_id_for_50_credits
STRIPE_PRICE_120=price_id_for_120_credits
STRIPE_PRICE_300=price_id_for_300_credits

# Public URLs (optional)
DONATION_URL=https://your-donation-page.com
SITE_URL=https://your-website.com
BOT_INVITE_URL=https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_ID&permissions=2048&scope=bot
```

### Quick Deploy to Railway

1. **Connect your repository**
   ```bash
   railway login
   railway link
   ```

2. **Set environment variables**
   ```bash
   railway variables set MONGODB_URI="your_mongodb_uri"
   railway variables set DISCORD_CLIENT_ID="your_client_id"
   railway variables set DISCORD_CLIENT_SECRET="your_client_secret"
   railway variables set JWT_SECRET="$(openssl rand -base64 32)"
   # ... set other variables
   ```

3. **Deploy**
   ```bash
   railway up
   ```

### MongoDB Setup

#### Option 1: Railway MongoDB Plugin
1. Add MongoDB plugin in Railway dashboard
2. Copy the `MONGO_URL` variable
3. Set `MONGODB_URI` to this value

#### Option 2: MongoDB Atlas
1. Create free cluster at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Add IP `0.0.0.0/0` to network access (for Railway)
3. Create database user
4. Get connection string and set as `MONGODB_URI`

### Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create new application
3. Go to "OAuth2" → Copy Client ID and Secret
4. Set redirect URL: `https://your-app.railway.app/auth/discord/callback`
5. Go to "Bot" → Create bot → Copy token
6. Enable required intents: "Message Content Intent"
7. Generate bot invite URL with permissions: `Send Messages` (2048)

### OpenAI Setup

1. Create account at [OpenAI](https://platform.openai.com)
2. Generate API key
3. Set as `OPENAI_API_KEY`

### Stripe Setup (Optional)

1. Create [Stripe account](https://stripe.com)
2. Create products for credit packs:
   - 50 AI Credits → $5
   - 120 AI Credits → $10
   - 300 AI Credits → $20
3. Copy price IDs
4. Set webhook endpoint: `https://your-app.railway.app/billing/webhook`
5. Copy webhook signing secret

### Extension Configuration

Update your extension to point to your Railway backend:

```javascript
// In apps/extension/src/api.ts
const API_ORIGIN = 'https://your-app.railway.app';
```

Rebuild and republish the extension.

### Verify Deployment

```bash
curl https://your-app.railway.app/health
```

Should return:
```json
{
  "ok": true,
  "service": "discord-memory-toolkit",
  "version": "2.0.0"
}
```

## Local Development

```bash
# Install dependencies
npm install

# Set environment variables in apps/server/.env
cp apps/server/.env.example apps/server/.env

# Start the backend
npm run dev --workspace=@discord-memory/server

# Build the extension
npm run build --workspace=@discord-memory/extension
```

## Architecture

```
┌─────────────────┐
│ Chrome Extension│
│  (Frontend UI)  │
└────────┬────────┘
         │
         │ HTTP/REST
         ▼
┌─────────────────┐
│  Railway Server │
│   (Express.js)  │
└────────┬────────┘
         │
    ┌────┴────┬──────────┬─────────┐
    ▼         ▼          ▼         ▼
┌────────┐ ┌──────┐ ┌────────┐ ┌────────┐
│MongoDB │ │OpenAI│ │Discord │ │ Stripe │
│ Atlas  │ │ API  │ │  API   │ │  API   │
└────────┘ └──────┘ └────────┘ └────────┘
```

## Security Notes

- Never commit `.env` files
- Rotate JWT_SECRET periodically
- Use Stripe test mode for development
- Keep bot token secure
- Review MongoDB network access rules
- Enable 2FA on all service accounts
