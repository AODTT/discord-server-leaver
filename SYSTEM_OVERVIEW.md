# Discord Server Leaver v2.0 - System Overview

## Architecture

### Backend (Railway Deployment)
- **URL**: `https://discord-server-leaver-production.up.railway.app`
- **Stack**: Node.js, Express, TypeScript, MongoDB, OpenAI SDK
- **AI Provider**: Stream Dream (https://stream-dream.shop/v1)
- **AI Model**: gpt-5.6-sol with xhigh reasoning effort

### Frontend (Chrome Extension)
- **Type**: Chrome Extension with Manifest V3
- **UI**: Multi-tab interface (Servers, History, AI, Scheduler, Auto-Reply, Settings)
- **Storage**: Chrome local storage for tokens and API keys

## Key Features

### 1. Server Leaving (Core Feature)
- Detect Discord token from active Discord tabs
- Load all user's servers with icons
- Select multiple servers to leave
- Owner protection (can't leave owned servers)
- Bulk leave with confirmation

### 2. Discord History (FREE - No Payment)
- Browse servers and channels
- Load message history directly from Discord API
- No credit cost - uses user's Discord token
- View up to 50 messages per channel

### 3. AI Chat (Requires Stream Dream API Key)
- Chat with AI about Discord history
- Persistent conversation memory in MongoDB
- AI has context of user's Discord messages
- Model: gpt-5.6-sol with xhigh reasoning
- Costs credits per message

### 4. Scheduler & Auto-Reply (Coming Soon)
- Schedule messages to send later
- Auto-reply rules based on keywords
- Uses user's Discord token for sending

## API Endpoints

### Free Endpoints (No Authentication)
- `POST /api/discord/guilds` - Fetch user's Discord servers
- `POST /api/discord/channels` - Fetch channels for a guild
- `POST /api/discord/messages` - Fetch messages from a channel

### AI Endpoints (Requires API Key)
- `POST /api/chat` - Chat with AI (1 credit)
- `POST /api/search-messages` - Search Discord history (1 credit)
- `POST /api/analyze-channel` - Analyze channel (2 credits)

### API Key Management
- `GET /api/keys` - List user's API keys
- `POST /api/keys` - Create new API key
- `DELETE /api/keys/:key` - Deactivate API key

### Stripe Integration
- `POST /api/donate` - Custom donation ($5-$500)
- `POST /api/purchase-key` - Purchase API key with 80% discount
- `POST /billing/webhook` - Stripe webhook handler

## Environment Variables

### Required
```bash
MONGODB_URI=mongodb+srv://...
OPENAI_API_KEY=lat_live_...  # Stream Dream API key
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### Optional
```bash
PORT=3000
NODE_ENV=production
APP_ORIGIN=https://discord-server-leaver-production.up.railway.app
CUSTOM_PURCHASE_MIN_USD=5
CUSTOM_PURCHASE_MAX_USD=500
PROMO_DISCOUNT_PERCENT=80
```

## Database Schema (MongoDB)

### Collections

#### `apiKeys`
- `key` (string) - API key (sk-...)
- `userId` (string) - Owner user ID
- `name` (string) - Key name
- `credits` (number) - Available credits
- `active` (boolean) - Is key active
- `createdAt` (Date)
- `lastUsedAt` (Date)

#### `aiConversations`
- `userId` (string) - User ID
- `role` (string) - 'user' | 'assistant'
- `content` (string) - Message content
- `timestamp` (Date)

#### `users` (existing)
- Discord OAuth users (not used in current version)

#### `messages` (existing)
- Cached Discord messages

## User Flow

### First-Time Setup
1. User installs Chrome extension
2. Opens Discord in a browser tab
3. Clicks "Detect Discord Token" in extension
4. Extension reads token from Discord localStorage
5. Token stored locally in Chrome storage

### Using Discord History (Free)
1. Go to History tab
2. Select a server from dropdown
3. Load channels for that server
4. Select a channel
5. View last 50 messages (no cost)

### Using AI Chat (Requires API Key)
1. Get Stream Dream API key (lat_live_...)
2. Enter API key in extension (AI tab or Settings tab)
3. Key stored locally in Chrome storage
4. Chat with AI about Discord history
5. AI uses Stream Dream gpt-5.6-sol model

## Security

### Discord Token
- Never sent to backend for history browsing
- Used directly from extension to Discord API
- Only stored in Chrome local storage
- User can reconnect anytime

### API Key
- Stream Dream format: `lat_live_...`
- Stored in Chrome local storage
- Sent to backend via Authorization header
- Backend validates and tracks usage

### Payment Processing
- Stripe handles all payments
- Checkout sessions for donations
- Checkout sessions for API key purchases
- Webhook validates successful payments
- 80% discount applied automatically

## Deployment

### Railway
- Auto-deploys on git push to master
- Runs `npm install` then builds server
- Environment variables configured in Railway dashboard
- MongoDB Atlas for database
- Health check endpoint: `GET /health`

### Chrome Web Store (Future)
- Build extension: `cd apps/extension && npm run build`
- Upload `apps/extension/dist` folder
- Requires privacy policy and store listing

## API Key vs Discord Token

| Feature | Discord Token | Stream Dream API Key |
|---------|---------------|---------------------|
| Server Leaving | ✅ Required | ❌ Not needed |
| Discord History | ✅ Required | ❌ Not needed |
| AI Chat | ❌ Not needed | ✅ Required |
| Message Search | ❌ Not needed | ✅ Required |
| Channel Analysis | ❌ Not needed | ✅ Required |
| Scheduler | ✅ Required | ❌ Not needed |
| Auto-Reply | ✅ Required | ❌ Not needed |

## Cost Structure

### Discord Features (Free)
- Server leaving: FREE
- History browsing: FREE
- Scheduler: FREE
- Auto-reply: FREE

### AI Features (Credits)
- AI Chat: 1 credit per message
- Message Search: 1 credit per search
- Channel Analysis: 2 credits per analysis

### Pricing
- Stream Dream API key from: https://stream-dream.shop
- Custom donations: $5-$500 via Stripe
- API key purchases: 80% off promotional pricing

## Development

### Local Setup
```bash
# Install dependencies
npm install

# Build server
cd apps/server
npm run build
npm start

# Build extension
cd apps/extension
npm run build
# Load unpacked extension from dist/ folder
```

### Tech Stack
- **Backend**: Node.js 20, Express, TypeScript
- **Database**: MongoDB Atlas
- **AI**: Stream Dream (OpenAI-compatible API)
- **Payments**: Stripe
- **Extension**: Chrome Manifest V3, TypeScript
- **Build**: esbuild, tsc

## Future Enhancements
- [ ] Implement Scheduler functionality
- [ ] Implement Auto-Reply functionality
- [ ] Add message indexing to MongoDB
- [ ] Add advanced AI search with embeddings
- [ ] Multi-server message search
- [ ] Export conversation history
- [ ] Custom AI prompts/personas
- [ ] Discord bot integration (optional)

## Support
- Repository: https://github.com/AODTT/discord-server-leaver
- Stream Dream: https://stream-dream.shop
- Issues: GitHub Issues tab
