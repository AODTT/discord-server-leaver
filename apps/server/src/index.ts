import express, { type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'node:crypto';
import Stripe from 'stripe';
import { z } from 'zod';
import { allowedOrigins, config, publicConfig } from './config.js';
import { closeDb, collections, memoryStore } from './db.js';
import { createSession, clearSessionCookie, createExchangeCode, consumeExchangeCode, getSessionUser, requireAuth, setSessionCookie, upsertOAuthUser, type AuthenticatedRequest } from './auth.js';
import { currentUser, exchangeCode, leaveGuild, oauthStartUrl as discordOauthStartUrl, userCanManageGuild, userGuilds } from './discord.js';
import { askHistory, indexEmbeddings } from './ai.js';
import { normalizeImportedMessages } from './importer.js';
import { countMessageRecords, createDocument, deleteDocument, deleteUserData, listDocuments, saveMessages, searchMessageRecords, updateDocument, getUser, updateUserCredits } from './repository.js';
import { startBotWorker } from './bot-worker.js';
import { createApiKey, validateApiKey, consumeCredit, getUserApiKeys, deactivateApiKey } from './api-keys.js';
import { createCustomDonation, createApiKeyPurchase, handleWebhook as handleStripeWebhook } from './stripe.js';
import { chatWithHistory, searchDiscordMessages, analyzeChannel } from './ai-chat.js';

const app = express();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const stripe = config.STRIPE_SECRET_KEY ? new Stripe(config.STRIPE_SECRET_KEY) : undefined;
const oauthStates = new Map<string, { returnTo: string; expiresAt: number }>();

app.set('trust proxy', 1);
app.use(cors({ origin(origin, callback) { if (!origin || allowedOrigins().some((allowed) => allowed === origin || (allowed.endsWith('*') && origin.startsWith(allowed.slice(0, -1))))) return callback(null, true); return callback(new Error('Origin not allowed')); }, credentials: true }));
app.use(cookieParser());
app.get('/health', (_request, response) => response.json({ ok: true, service: 'discord-memory-toolkit', version: '2.0.0' }));

// Stripe signs the raw request body; this route must precede express.json().
app.post('/billing/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
  if (!stripe || !config.STRIPE_WEBHOOK_SECRET) { response.status(503).json({ error: 'Billing is not configured' }); return; }
  try {
    const signature = request.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(request.body, signature as string, config.STRIPE_WEBHOOK_SECRET);
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = String(session.metadata?.userId ?? '');
      const credits = Number(session.metadata?.credits ?? 0);
      if (userId && Number.isSafeInteger(credits) && credits > 0) await updateUserCredits(userId, credits, { id: session.id, type: 'purchase', credits });
    }
    response.json({ received: true });
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Invalid webhook' }); }
});
app.use(express.json({ limit: '12mb' }));

app.get('/config/public', (_request, response) => response.json(publicConfig));

app.get('/auth/discord/start', (request, response) => {
  response.status(503).json({ error: 'Discord OAuth is not configured - using user tokens directly' });
});

app.get('/auth/discord/callback', async (request, response) => {
  const state = typeof request.query.state === 'string' ? request.query.state : ''; const entry = oauthStates.get(state); oauthStates.delete(state);
  if (!entry || entry.expiresAt < Date.now()) { response.status(400).send('Login expired. Close this tab and try again.'); return; }
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  if (!code) { response.status(400).send('Discord did not return an authorization code.'); return; }
  try { const token = await exchangeCode(code); const profile = await currentUser(token.access_token); const user = await upsertOAuthUser(profile, { accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in }); const session = await createSession(user); const isExtension = entry.returnTo.startsWith('chrome-extension://') || entry.returnTo.includes('.chromiumapp.org'); if (isExtension) { const exchangeCodeValue = createExchangeCode(session); response.redirect(`${entry.returnTo}${entry.returnTo.includes('?') ? '&' : '?'}code=${encodeURIComponent(exchangeCodeValue)}`); } else { setSessionCookie(response, session); response.send('<!doctype html><title>Connected</title><p>Discord connected. You can close this tab and return to the extension.</p>'); } }
  catch (error) { response.status(502).send(`Discord connection failed: ${error instanceof Error ? error.message : 'unknown error'}`); }
});
app.post('/auth/exchange', (request, response) => { const code = typeof request.body?.code === 'string' ? request.body.code : ''; const token = consumeExchangeCode(code); if (!token) { response.status(400).json({ error: 'Login code expired or already used' }); return; } response.json({ token }); });

app.get('/auth/me', async (request, response) => { const user = await getSessionUser(request); if (!user) { response.status(401).json({ error: 'Not signed in' }); return; } response.json({ user: safeUser(user) }); });
app.post('/auth/logout', async (request, response) => { clearSessionCookie(response); response.json({ ok: true }); });

app.get('/guilds', requireAuth, async (request: AuthenticatedRequest, response) => {
  try { const guilds = await userGuilds(request.user!.discordId); response.json({ guilds: guilds.map((guild) => ({ ...guild, leaveable: !guild.owner })) }); } catch (error) { response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load servers' }); }
});

app.post('/guilds/:guildId/leave', requireAuth, async (request: AuthenticatedRequest, response) => {
  const schema = z.object({ confirm: z.literal(true), guildName: z.string().max(200).optional() }); const parsed = schema.safeParse(request.body); if (!parsed.success) { response.status(400).json({ error: 'Confirmation is required' }); return; }
  try { await leaveGuild(request.user!.discordId, String(request.params.guildId), parsed.data.guildName); response.json({ ok: true, guildId: request.params.guildId }); } catch (error) { response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to leave server' }); }
});
app.get('/guilds/:guildId/channels', requireAuth, async (request: AuthenticatedRequest, response) => {
  try {
    if (!(await userCanManageGuild(request.user!.discordId, String(request.params.guildId)))) { response.status(403).json({ error: 'Manage Server permission is required' }); return; }
    const { userGuildChannels } = await import('./discord.js');
    const channels = await userGuildChannels(request.user!.discordId, String(request.params.guildId));
    response.json({ channels: channels.filter((channel) => [0, 5, 10, 11, 12, 15].includes(channel.type)).map((channel) => ({ id: channel.id, name: channel.name ?? channel.id, type: channel.type })) });
  } catch (error) { response.status(502).json({ error: error instanceof Error ? error.message : 'Unable to load channels' }); }
});

app.get('/messages/search', requireAuth, async (request: AuthenticatedRequest, response) => {
  const filters = { query: stringQuery(request.query.q), guildId: stringQuery(request.query.guild), channelId: stringQuery(request.query.channel), authorId: stringQuery(request.query.author), from: parseQueryDate(request.query.from), to: parseQueryDate(request.query.to) };
  const limit = clampNumber(request.query.limit, 100, 1, 500); const messages = await searchMessageRecords(request.user!.discordId, filters, limit); response.json({ messages: messages.map(publicMessage) });
});

app.post('/messages/import', requireAuth, async (request: AuthenticatedRequest, response) => {
  if (!request.user!.cloudEnabled) { response.status(402).json({ error: 'Cloud history unlocks after a credit purchase', code: 'CLOUD_REQUIRED' }); return; }
  const body = z.object({ messages: z.array(z.record(z.unknown())).max(100_000), mode: z.enum(['merge', 'replace']).default('merge') }).safeParse(request.body);
  if (!body.success) { response.status(400).json({ error: 'Expected an array of at most 100,000 normalized messages' }); return; }
  if (body.data.mode === 'replace') await deleteUserData(request.user!.discordId);
  const records = normalizeImportedMessages(request.user!.discordId, body.data.messages); const saved = await saveMessages(request.user!.discordId, records); await indexEmbeddings(request.user!.discordId, records.map((record) => ({ ...record, ownerUserId: request.user!.discordId }))); response.json({ imported: saved, total: await countMessageRecords(request.user!.discordId) });
});

app.post('/messages/import-json', requireAuth, upload.single('file'), async (request: AuthenticatedRequest, response) => {
  if (!request.user!.cloudEnabled) { response.status(402).json({ error: 'Cloud history unlocks after a credit purchase', code: 'CLOUD_REQUIRED' }); return; }
  if (!request.file) { response.status(400).json({ error: 'Attach one JSON file' }); return; }
  let parsed: unknown; try { parsed = JSON.parse(request.file.buffer.toString('utf8')); } catch { response.status(400).json({ error: 'Invalid JSON' }); return; }
  const entries = Array.isArray(parsed) ? parsed : [parsed]; const records = normalizeImportedMessages(request.user!.discordId, entries); const saved = await saveMessages(request.user!.discordId, records); await indexEmbeddings(request.user!.discordId, records.map((record) => ({ ...record, ownerUserId: request.user!.discordId }))); response.json({ imported: saved, total: await countMessageRecords(request.user!.discordId) });
});

app.get('/ai/status', requireAuth, async (request: AuthenticatedRequest, response) => { const user = await getUser(request.user!.discordId); response.json({ freeQuestionsRemaining: Math.max(0, 2 - (user?.freeQuestionsUsed ?? 0)), aiCredits: user?.aiCredits ?? 0, configured: Boolean(config.OPENAI_API_KEY) }); });
app.post('/ai/ask', requireAuth, async (request: AuthenticatedRequest, response) => { const body = z.object({ question: z.string().min(3).max(1000), context: z.array(z.object({ messageId: z.string(), content: z.string().max(20_000), timestamp: z.string(), authorId: z.string().optional(), authorName: z.string().optional(), guildId: z.string().optional(), guildName: z.string().optional(), channelId: z.string().optional(), channelName: z.string().optional(), source: z.enum(['data-package', 'bot-sync']), jumpUrl: z.string().optional() })).max(200).default([]) }).safeParse(request.body); if (!body.success) { response.status(400).json({ error: 'Question or local evidence is invalid' }); return; } try { const localContext = body.data.context.map((item) => ({ ...item, ownerUserId: request.user!.discordId, timestamp: new Date(item.timestamp) })).filter((item) => !Number.isNaN(item.timestamp.getTime())); response.json(await askHistory(request.user!.discordId, body.data.question, localContext)); } catch (error) { if (error instanceof Error && error.message === 'INSUFFICIENT_CREDITS') { response.status(402).json({ error: 'No AI credits remaining', code: 'INSUFFICIENT_CREDITS' }); return; } response.status(502).json({ error: error instanceof Error ? error.message : 'AI request failed' }); } });

app.get('/memories', requireAuth, async (request: AuthenticatedRequest, response) => response.json({ memories: await listDocuments('memories', request.user!.discordId) }));
app.post('/memories', requireAuth, async (request: AuthenticatedRequest, response) => { const body = z.object({ title: z.string().min(1).max(160), content: z.string().min(1).max(10_000), tags: z.array(z.string().max(40)).max(20).default([]) }).safeParse(request.body); if (!body.success) { response.status(400).json({ error: 'Invalid memory' }); return; } response.status(201).json({ memory: await createDocument('memories', request.user!.discordId, body.data) }); });
app.patch('/memories/:id', requireAuth, async (request: AuthenticatedRequest, response) => response.json({ memory: await updateDocument('memories', request.user!.discordId, String(request.params.id), request.body) }));
app.delete('/memories/:id', requireAuth, async (request: AuthenticatedRequest, response) => response.json({ ok: await deleteDocument('memories', request.user!.discordId, String(request.params.id)) }));

app.get('/schedules', requireAuth, async (request: AuthenticatedRequest, response) => response.json({ schedules: await listDocuments('schedules', request.user!.discordId) }));
app.post('/schedules', requireAuth, async (request: AuthenticatedRequest, response) => { const body = z.object({ guildId: z.string().regex(/^\d+$/), channelId: z.string().regex(/^\d+$/), content: z.string().min(1).max(2000), runAt: z.string().datetime(), recurrence: z.object({ kind: z.enum(['interval', 'daily', 'weekly']), minutes: z.number().int().min(15).max(10080).optional(), days: z.array(z.number().int().min(0).max(6)).max(7).optional() }).optional() }).safeParse(request.body); if (!body.success || Date.parse(body.data.runAt) < Date.now() - 60_000) { response.status(400).json({ error: 'Invalid schedule or run time' }); return; } if (!(await userCanManageGuild(request.user!.discordId, body.data.guildId))) { response.status(403).json({ error: 'Manage Server permission is required' }); return; } response.status(201).json({ schedule: await createDocument('schedules', request.user!.discordId, { ...body.data, enabled: true, nextRunAt: new Date(body.data.runAt) }) }); });
app.patch('/schedules/:id', requireAuth, async (request: AuthenticatedRequest, response) => response.json({ schedule: await updateDocument('schedules', request.user!.discordId, String(request.params.id), request.body) }));
app.delete('/schedules/:id', requireAuth, async (request: AuthenticatedRequest, response) => response.json({ ok: await deleteDocument('schedules', request.user!.discordId, String(request.params.id)) }));

app.get('/auto-replies', requireAuth, async (request: AuthenticatedRequest, response) => response.json({ rules: await listDocuments('autoReplies', request.user!.discordId) }));
app.post('/auto-replies', requireAuth, async (request: AuthenticatedRequest, response) => { const body = z.object({ guildId: z.string().regex(/^\d+$/), channelId: z.string().regex(/^\d+$/).optional(), keyword: z.string().min(1).max(100), match: z.enum(['contains', 'exact']).default('contains'), response: z.string().min(1).max(2000), cooldownSeconds: z.number().int().min(30).max(86400).default(300), maxPerHour: z.number().int().min(1).max(30).default(5) }).safeParse(request.body); if (!body.success) { response.status(400).json({ error: 'Invalid auto-reply rule' }); return; } if (!(await userCanManageGuild(request.user!.discordId, body.data.guildId))) { response.status(403).json({ error: 'Manage Server permission is required' }); return; } response.status(201).json({ rule: await createDocument('autoReplies', request.user!.discordId, { ...body.data, enabled: true }) }); });
app.patch('/auto-replies/:id', requireAuth, async (request: AuthenticatedRequest, response: Response) => response.json({ rule: await updateDocument('autoReplies', request.user!.discordId, String(request.params.id), request.body) }));
app.delete('/auto-replies/:id', requireAuth, async (request: AuthenticatedRequest, response) => response.json({ ok: await deleteDocument('autoReplies', request.user!.discordId, String(request.params.id)) }));

app.get('/guild-settings/:guildId', requireAuth, async (request: AuthenticatedRequest, response) => { const c = await collections(); const query = { guildId: request.params.guildId, ownerUserId: request.user!.discordId }; const settings = c ? await c.guildSettings.findOne(query) : memoryStore().guildSettings.get(`${request.user!.discordId}:${request.params.guildId}`); response.json({ settings: settings ?? { guildId: request.params.guildId, indexingEnabled: false, indexedChannelIds: [] } }); });
app.put('/guild-settings/:guildId', requireAuth, async (request: AuthenticatedRequest, response) => { const guildId = String(request.params.guildId); const body = z.object({ indexingEnabled: z.boolean(), indexedChannelIds: z.array(z.string().regex(/^\d+$/)).max(100), disclosureText: z.string().max(500).default('This server has opted in to message indexing by Discord Memory Toolkit.'), optedOutUserIds: z.array(z.string().regex(/^\d+$/)).max(10000).default([]) }).safeParse(request.body); if (!body.success) { response.status(400).json({ error: 'Invalid server settings' }); return; } if (!(await userCanManageGuild(request.user!.discordId, guildId))) { response.status(403).json({ error: 'Manage Server permission is required' }); return; } const c = await collections(); const doc = { guildId, ownerUserId: request.user!.discordId, ...body.data, updatedAt: new Date() }; if (c) await c.guildSettings.updateOne({ guildId, ownerUserId: request.user!.discordId }, { $set: doc }, { upsert: true }); else memoryStore().guildSettings.set(`${request.user!.discordId}:${guildId}`, doc); response.json({ settings: doc }); });

app.post('/billing/checkout', requireAuth, async (request: AuthenticatedRequest, response: Response) => {
  response.status(503).json({ error: 'Old billing system removed - use /api/donate or /api/purchase-key instead' });
});

app.get('/data/export', requireAuth, async (request: AuthenticatedRequest, response: Response) => { const userId = request.user!.discordId; const [messages, memories, schedules, autoReplies] = await Promise.all([searchMessageRecords(userId, {}, 100_000), listDocuments('memories', userId), listDocuments('schedules', userId), listDocuments('autoReplies', userId)]); response.setHeader('Content-Disposition', 'attachment; filename=discord-memory-export.json'); response.json({ exportedAt: new Date().toISOString(), messages: messages.map(publicMessage), memories, schedules, autoReplies }); });
app.delete('/data/all', requireAuth, async (request: AuthenticatedRequest, response: Response) => { await deleteUserData(request.user!.discordId); response.json({ ok: true }); });

// API Key middleware
async function requireApiKey(request: express.Request, response: express.Response, next: express.NextFunction) {
  const authHeader = request.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    response.status(401).json({ error: 'API key required' });
    return;
  }
  const apiKey = authHeader.slice(7);
  const key = await validateApiKey(apiKey);
  if (!key) {
    response.status(401).json({ error: 'Invalid or expired API key' });
    return;
  }
  (request as any).apiKey = key;
  next();
}

// Stripe donation endpoint
app.post('/api/donate', async (request, response) => {
  const body = z.object({
    amount: z.number().min(config.CUSTOM_PURCHASE_MIN_USD).max(config.CUSTOM_PURCHASE_MAX_USD),
    email: z.string().email()
  }).safeParse(request.body);

  if (!body.success) {
    response.status(400).json({ error: 'Invalid donation amount or email' });
    return;
  }

  try {
    const checkoutUrl = await createCustomDonation(body.data.amount, body.data.email);
    response.json({ url: checkoutUrl });
  } catch (error) {
    console.error('Donation checkout error:', error);
    response.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// API key purchase endpoint
app.post('/api/purchase-key', async (request, response) => {
  const body = z.object({
    credits: z.number().int().min(100).max(100000),
    email: z.string().email(),
    userId: z.string().min(1)
  }).safeParse(request.body);

  if (!body.success) {
    response.status(400).json({ error: 'Invalid purchase request' });
    return;
  }

  try {
    const priceUsd = body.data.credits / 10; // $0.10 per credit before discount
    const checkoutUrl = await createApiKeyPurchase(
      body.data.userId,
      body.data.email,
      body.data.credits,
      priceUsd
    );
    response.json({ url: checkoutUrl });
  } catch (error) {
    console.error('API key purchase error:', error);
    response.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// API key management
app.get('/api/keys', requireAuth, async (request: AuthenticatedRequest, response) => {
  try {
    const keys = await getUserApiKeys(request.user!.discordId);
    response.json({ keys });
  } catch (error) {
    console.error('List API keys error:', error);
    response.status(500).json({ error: 'Failed to retrieve API keys' });
  }
});

app.post('/api/keys', requireAuth, async (request: AuthenticatedRequest, response) => {
  const body = z.object({
    name: z.string().min(1).max(100),
    credits: z.number().int().min(1).max(1000000)
  }).safeParse(request.body);

  if (!body.success) {
    response.status(400).json({ error: 'Invalid key creation request' });
    return;
  }

  try {
    const key = await createApiKey(request.user!.discordId, body.data.name, body.data.credits);
    response.json({ key });
  } catch (error) {
    console.error('Create API key error:', error);
    response.status(500).json({ error: 'Failed to create API key' });
  }
});

app.delete('/api/keys/:key', requireAuth, async (request: AuthenticatedRequest, response) => {
  const key = request.params.key;
  if (!key) {
    response.status(400).json({ error: 'API key parameter required' });
    return;
  }

  try {
    const success = await deactivateApiKey(key, request.user!.discordId);
    if (!success) {
      response.status(404).json({ error: 'API key not found' });
      return;
    }
    response.json({ ok: true });
  } catch (error) {
    console.error('Deactivate API key error:', error);
    response.status(500).json({ error: 'Failed to deactivate API key' });
  }
});

// AI chat endpoints
app.post('/api/chat', requireApiKey, async (request, response) => {
  const body = z.object({
    message: z.string().min(1).max(10000)
  }).safeParse(request.body);

  if (!body.success) {
    response.status(400).json({ error: 'Invalid chat request' });
    return;
  }

  const apiKey = (request as any).apiKey;
  const consumed = await consumeCredit(apiKey.key, 1);
  if (!consumed) {
    response.status(402).json({ error: 'Insufficient credits' });
    return;
  }

  try {
    const reply = await chatWithHistory(apiKey.userId, body.data.message);
    response.json({ reply, creditsRemaining: apiKey.credits - 1 });
  } catch (error) {
    console.error('AI chat error:', error);
    response.status(500).json({ error: 'Failed to process chat request' });
  }
});

app.post('/api/search-messages', requireApiKey, async (request, response) => {
  const body = z.object({
    query: z.string().min(1).max(500),
    serverId: z.string().optional(),
    channelId: z.string().optional(),
    authorId: z.string().optional()
  }).safeParse(request.body);

  if (!body.success) {
    response.status(400).json({ error: 'Invalid search request' });
    return;
  }

  const apiKey = (request as any).apiKey;
  const consumed = await consumeCredit(apiKey.key, 1);
  if (!consumed) {
    response.status(402).json({ error: 'Insufficient credits' });
    return;
  }

  try {
    const messages = await searchDiscordMessages(apiKey.userId, body.data.query, {
      serverId: body.data.serverId,
      channelId: body.data.channelId,
      authorId: body.data.authorId
    });
    response.json({ messages, creditsRemaining: apiKey.credits - 1 });
  } catch (error) {
    console.error('Search messages error:', error);
    response.status(500).json({ error: 'Failed to search messages' });
  }
});

app.post('/api/analyze-channel', requireApiKey, async (request, response) => {
  const body = z.object({
    channelId: z.string(),
    analysisType: z.enum(['summary', 'value', 'math'])
  }).safeParse(request.body);

  if (!body.success) {
    response.status(400).json({ error: 'Invalid analysis request' });
    return;
  }

  const apiKey = (request as any).apiKey;
  const consumed = await consumeCredit(apiKey.key, 2); // Analysis costs 2 credits
  if (!consumed) {
    response.status(402).json({ error: 'Insufficient credits' });
    return;
  }

  try {
    const analysis = await analyzeChannel(apiKey.userId, body.data.channelId, body.data.analysisType);
    response.json({ analysis, creditsRemaining: apiKey.credits - 2 });
  } catch (error) {
    console.error('Analyze channel error:', error);
    response.status(500).json({ error: 'Failed to analyze channel' });
  }
});

app.use((_request, response) => response.status(404).json({ error: 'Not found' }));
app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => { console.error(error instanceof Error ? error.message : error); response.status(500).json({ error: 'Internal server error' }); });

function safeUser(user: { discordId: string; username: string; avatar?: string | null; aiCredits: number; freeQuestionsUsed: number; cloudEnabled: boolean }) { return { id: user.discordId, username: user.username, avatar: user.avatar, aiCredits: user.aiCredits, freeQuestionsRemaining: Math.max(0, 2 - user.freeQuestionsUsed), cloudEnabled: user.cloudEnabled }; }
function stringQuery(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined; }
function parseQueryDate(value: unknown): Date | undefined { const text = stringQuery(value); if (!text) return undefined; const date = new Date(text); return Number.isNaN(date.getTime()) ? undefined : date; }
function clampNumber(value: unknown, fallback: number, min: number, max: number): number { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback; }
function publicMessage(message: Record<string, unknown>) { const { embedding: _embedding, ownerUserId: _ownerUserId, ...safe } = message; return safe; }
function isAllowedReturnTo(value: string): boolean { try { const url = new URL(value); return url.protocol === 'chrome-extension:' || (url.protocol === 'https:' && url.hostname.endsWith('.chromiumapp.org')) || value.startsWith(config.APP_ORIGIN); } catch { return false; } }

const server = app.listen(config.PORT, () => console.log(`Discord Memory Toolkit API listening on ${config.PORT}`));
const worker = startBotWorker();
process.on('SIGTERM', async () => { worker?.stop(); server.close(); await closeDb(); process.exit(0); });
process.on('SIGINT', async () => { worker?.stop(); server.close(); await closeDb(); process.exit(0); });

export { app, server };
