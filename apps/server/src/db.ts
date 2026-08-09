import { MongoClient, ObjectId, type Db, type Collection } from 'mongodb';
import { config } from './config.js';
import type { MessageRecord, User } from './types.js';

export type AnyDoc = { _id?: string | ObjectId; [key: string]: any };

let client: MongoClient | undefined;
let database: Db | undefined;
const memory = {
  users: new Map<string, User>(),
  messages: new Map<string, MessageRecord>(),
  sessions: new Map<string, { userId: string; expiresAt: Date }>(),
  tokens: new Map<string, { userId: string; accessToken: string; refreshToken?: string; expiresAt?: Date }>(),
  memories: new Map<string, Record<string, unknown>>(),
  schedules: new Map<string, Record<string, unknown>>(),
  autoReplies: new Map<string, Record<string, unknown>>(),
  autoReplyEvents: new Map<string, Record<string, unknown>>(),
  deliveryEvents: new Map<string, Record<string, unknown>>(),
  creditEvents: new Map<string, Record<string, unknown>>(),
  guildSettings: new Map<string, Record<string, unknown>>(),
  apiKeys: new Map<string, Record<string, unknown>>(),
  aiConversations: new Map<string, Record<string, unknown>>(),
};

export async function getDb(): Promise<Db | undefined> {
  if (!config.MONGODB_URI) return undefined;
  if (!database) {
    client = new MongoClient(config.MONGODB_URI, { maxPoolSize: 10 });
    await client.connect();
    database = client.db(config.MONGODB_DB);
    await ensureIndexes(database);
  }
  return database;
}

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('users').createIndex({ discordId: 1 }, { unique: true }),
    db.collection('messages').createIndex({ ownerUserId: 1, timestamp: -1 }),
    db.collection('messages').createIndex({ ownerUserId: 1, messageId: 1 }, { unique: true }),
    db.collection('messages').createIndex({ ownerUserId: 1, guildId: 1, channelId: 1, timestamp: -1 }),
    db.collection('memories').createIndex({ ownerUserId: 1, updatedAt: -1 }),
    db.collection('schedules').createIndex({ ownerUserId: 1, enabled: 1, nextRunAt: 1 }),
    db.collection('auto_replies').createIndex({ ownerUserId: 1, enabled: 1 }),
    db.collection('auto_reply_events').createIndex({ ruleId: 1, createdAt: -1 }),
    db.collection('auto_reply_events').createIndex({ createdAt: 1 }, { expireAfterSeconds: 86400 }),
    db.collection('delivery_events').createIndex({ scheduleId: 1, createdAt: -1 }),
    db.collection('credit_events').createIndex({ checkoutSessionId: 1 }, { unique: true, sparse: true }),
    db.collection('api_keys').createIndex({ key: 1 }, { unique: true }),
    db.collection('api_keys').createIndex({ userId: 1, active: 1 }),
    db.collection('ai_conversations').createIndex({ userId: 1, timestamp: -1 }),
    db.collection('messages').createIndex({ content: 'text', authorName: 'text' }),
  ]);
}

export function memoryStore() { return memory; }

export async function closeDb(): Promise<void> { if (client) await client.close(); client = undefined; database = undefined; }

export type Collections = {
  users: Collection<User>;
  messages: Collection<MessageRecord>;
  memories: Collection<AnyDoc>;
  schedules: Collection<AnyDoc>;
  autoReplies: Collection<AnyDoc>;
  sessions: Collection<AnyDoc>;
  tokens: Collection<AnyDoc>;
  creditEvents: Collection<AnyDoc>;
  guildSettings: Collection<AnyDoc>;
  autoReplyEvents: Collection<AnyDoc>;
  deliveryEvents: Collection<AnyDoc>;
  apiKeys: Collection<AnyDoc>;
  aiConversations: Collection<AnyDoc>;
};

export async function collections(): Promise<Collections | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  return {
    users: db.collection<User>('users'),
    messages: db.collection<MessageRecord>('messages'),
    memories: db.collection<AnyDoc>('memories'),
    schedules: db.collection<AnyDoc>('schedules'),
    autoReplies: db.collection<AnyDoc>('auto_replies'),
    sessions: db.collection<AnyDoc>('sessions'),
    tokens: db.collection<AnyDoc>('tokens'),
    creditEvents: db.collection<AnyDoc>('credit_events'),
    guildSettings: db.collection<AnyDoc>('guild_settings'),
    autoReplyEvents: db.collection<AnyDoc>('auto_reply_events'),
    deliveryEvents: db.collection<AnyDoc>('delivery_events'),
    apiKeys: db.collection<AnyDoc>('api_keys'),
    aiConversations: db.collection<AnyDoc>('ai_conversations'),
  };
}
