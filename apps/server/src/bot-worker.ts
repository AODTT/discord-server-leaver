import { Client, GatewayIntentBits, type Message } from 'discord.js';
import { config } from './config.js';
import { collections, memoryStore } from './db.js';
import { botSendMessage } from './discord.js';
import { saveMessages } from './repository.js';

type Rule = {
  _id: string; ownerUserId: string; guildId: string; channelId?: string; keyword: string;
  match: 'contains' | 'exact'; response: string; cooldownSeconds: number; maxPerHour: number; enabled: boolean;
};

type ScheduleDoc = {
  _id: string; ownerUserId: string; guildId: string; channelId: string; content: string; enabled: boolean;
  nextRunAt: Date; recurrence?: { kind: 'interval' | 'daily' | 'weekly'; minutes?: number; days?: number[] }; lockedUntil?: Date;
};

export function startBotWorker(): { stop(): void } | undefined {
  if (!config.DISCORD_BOT_TOKEN) { console.info('Discord bot is not configured; live sync and automation are disabled.'); return undefined; }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
  let scheduleTimer: NodeJS.Timeout | undefined;
  client.once('ready', () => { console.info(`Discord bot ready as ${client.user?.tag ?? 'unknown'}`); scheduleTimer = setInterval(() => void runDueSchedules(), 15_000); void runDueSchedules(); });
  client.on('messageCreate', (message) => void handleMessage(message));
  client.login(config.DISCORD_BOT_TOKEN).catch((error) => console.error('Discord bot login failed:', error instanceof Error ? error.message : error));
  return { stop() { if (scheduleTimer) clearInterval(scheduleTimer); void client.destroy(); } };
}

async function handleMessage(message: Message): Promise<void> {
  if (!message.inGuild() || message.author.bot || !message.content) return;
  const c = await collections();
  const settings = c
    ? await c.guildSettings.find({ guildId: message.guildId, indexingEnabled: true, indexedChannelIds: message.channelId }).toArray()
    : [...memoryStore().guildSettings.values()].filter((doc) => doc.guildId === message.guildId && doc.indexingEnabled === true && Array.isArray(doc.indexedChannelIds) && doc.indexedChannelIds.includes(message.channelId));

  for (const setting of settings) {
    if (Array.isArray(setting.optedOutUserIds) && setting.optedOutUserIds.includes(message.author.id)) continue;
    const ownerUserId = String(setting.ownerUserId);
    await saveMessages(ownerUserId, [{
      messageId: message.id, authorId: message.author.id, authorName: message.author.globalName ?? message.author.username,
      content: message.content, timestamp: message.createdAt, guildId: message.guildId, guildName: message.guild.name,
      channelId: message.channelId, channelName: 'name' in message.channel ? String(message.channel.name ?? '') : '',
      source: 'bot-sync', attachments: [...message.attachments.values()].map((attachment) => attachment.url).slice(0, 20),
      jumpUrl: message.url,
    }]);
    await runAutoReplies(message, ownerUserId);
  }
}

async function runAutoReplies(message: Message<true>, ownerUserId: string): Promise<void> {
  const c = await collections();
  const query = { ownerUserId, guildId: message.guildId, enabled: true, $or: [{ channelId: message.channelId }, { channelId: { $exists: false } }, { channelId: '' }] };
  const rules = (c ? await c.autoReplies.find(query).toArray() : [...memoryStore().autoReplies.values()].filter((doc) => doc.ownerUserId === ownerUserId && doc.guildId === message.guildId && doc.enabled === true && (!doc.channelId || doc.channelId === message.channelId))) as unknown as Rule[];
  for (const rule of rules) {
    if (!matchesRule(message.content, rule)) continue;
    if (!(await canFireRule(rule))) continue;
    try {
      await message.reply({ content: rule.response.slice(0, 2000), allowedMentions: { parse: [], repliedUser: false } });
      await recordRuleEvent(rule, message.id, message.channelId);
    } catch (error) { console.warn(`Auto-reply ${rule._id} failed:`, error instanceof Error ? error.message : error); }
  }
}

export function matchesRule(content: string, rule: Pick<Rule, 'keyword' | 'match'>): boolean {
  const text = content.trim().toLocaleLowerCase(); const keyword = rule.keyword.trim().toLocaleLowerCase();
  return Boolean(keyword && (rule.match === 'exact' ? text === keyword : text.includes(keyword)));
}

async function canFireRule(rule: Rule): Promise<boolean> {
  const sinceHour = new Date(Date.now() - 60 * 60 * 1000); const sinceCooldown = new Date(Date.now() - rule.cooldownSeconds * 1000); const c = await collections();
  if (c) {
    const [hourCount, recent] = await Promise.all([c.autoReplyEvents.countDocuments({ ruleId: String(rule._id), createdAt: { $gte: sinceHour } }), c.autoReplyEvents.findOne({ ruleId: String(rule._id), createdAt: { $gte: sinceCooldown } })]);
    return hourCount < rule.maxPerHour && !recent;
  }
  const events = [...memoryStore().autoReplyEvents.values()].filter((event) => event.ruleId === String(rule._id) && event.createdAt instanceof Date && event.createdAt >= sinceHour);
  return events.length < rule.maxPerHour && !events.some((event) => (event.createdAt as Date) >= sinceCooldown);
}

async function recordRuleEvent(rule: Rule, messageId: string, channelId: string): Promise<void> {
  const event = { _id: `${rule._id}:${messageId}`, ruleId: String(rule._id), ownerUserId: rule.ownerUserId, messageId, channelId, createdAt: new Date() }; const c = await collections();
  if (c) await c.autoReplyEvents.updateOne({ _id: event._id }, { $setOnInsert: event }, { upsert: true }); else memoryStore().autoReplyEvents.set(event._id, event);
}

async function runDueSchedules(): Promise<void> {
  const now = new Date(); const lockUntil = new Date(Date.now() + 60_000); const c = await collections();
  const due = c ? await c.schedules.find({ enabled: true, nextRunAt: { $lte: now }, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lt: now } }] }).limit(20).toArray() as unknown as ScheduleDoc[] : [...memoryStore().schedules.values()].filter((doc) => doc.enabled === true && doc.nextRunAt instanceof Date && doc.nextRunAt <= now && (!(doc.lockedUntil instanceof Date) || doc.lockedUntil < now)).slice(0, 20) as unknown as ScheduleDoc[];
  for (const schedule of due) {
    const claimed = await claimSchedule(schedule, lockUntil); if (!claimed) continue;
    try {
      await botSendMessage(schedule.channelId, schedule.content);
      const nextRunAt = nextOccurrence(schedule, now);
      await finishSchedule(schedule, { enabled: Boolean(nextRunAt), nextRunAt, lastRunAt: new Date(), lastStatus: 'sent', lockedUntil: null });
      await recordDelivery(schedule, 'sent');
    } catch (error) {
      await finishSchedule(schedule, { lastStatus: 'failed', lastError: error instanceof Error ? error.message.slice(0, 300) : 'unknown error', lockedUntil: null });
      await recordDelivery(schedule, 'failed', error instanceof Error ? error.message : 'unknown error');
    }
  }
}

async function claimSchedule(schedule: ScheduleDoc, lockedUntil: Date): Promise<boolean> {
  const c = await collections();
  if (c) return (await c.schedules.updateOne({ _id: schedule._id, enabled: true, nextRunAt: schedule.nextRunAt, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lt: new Date() } }] }, { $set: { lockedUntil } })).modifiedCount === 1;
  const doc = memoryStore().schedules.get(String(schedule._id)); if (!doc || doc.enabled !== true || (doc.lockedUntil instanceof Date && doc.lockedUntil >= new Date())) return false; doc.lockedUntil = lockedUntil; return true;
}

async function finishSchedule(schedule: ScheduleDoc, patch: Record<string, unknown>): Promise<void> { const c = await collections(); if (c) await c.schedules.updateOne({ _id: schedule._id }, { $set: patch }); else Object.assign(memoryStore().schedules.get(String(schedule._id)) ?? {}, patch); }
async function recordDelivery(schedule: ScheduleDoc, status: string, error?: string): Promise<void> { const event = { _id: `${schedule._id}:${Date.now()}`, scheduleId: String(schedule._id), ownerUserId: schedule.ownerUserId, channelId: schedule.channelId, status, error, createdAt: new Date() }; const c = await collections(); if (c) await c.deliveryEvents.insertOne(event); else memoryStore().deliveryEvents.set(event._id, event); }

export function nextOccurrence(schedule: Pick<ScheduleDoc, 'recurrence' | 'nextRunAt'>, now = new Date()): Date | undefined {
  const recurrence = schedule.recurrence; if (!recurrence) return undefined;
  if (recurrence.kind === 'interval') return new Date(Math.max(schedule.nextRunAt.getTime(), now.getTime()) + Math.max(recurrence.minutes ?? 15, 15) * 60_000);
  if (recurrence.kind === 'daily') { const next = new Date(schedule.nextRunAt); do next.setUTCDate(next.getUTCDate() + 1); while (next <= now); return next; }
  const allowed = new Set(recurrence.days?.length ? recurrence.days : [schedule.nextRunAt.getUTCDay()]); const next = new Date(schedule.nextRunAt); do next.setUTCDate(next.getUTCDate() + 1); while (next <= now || !allowed.has(next.getUTCDay())); return next;
}
