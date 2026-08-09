import { ObjectId } from 'mongodb';
import { collections, memoryStore } from './db.js';
import type { MessageRecord, User } from './types.js';

function mapKey(ownerUserId: string, messageId: string): string { return `${ownerUserId}:${messageId}`; }

export async function saveMessages(ownerUserId: string, records: Omit<MessageRecord, 'ownerUserId'>[]): Promise<number> {
  const c = await collections();
  const normalized = records.filter((record) => record.messageId && record.content && !Number.isNaN(record.timestamp.getTime())).map((record) => ({ ...record, ownerUserId, indexedAt: new Date() }));
  if (c) {
    if (!normalized.length) return 0;
    const result = await c.messages.bulkWrite(normalized.map((record) => ({ updateOne: { filter: { ownerUserId, messageId: record.messageId }, update: { $set: record }, upsert: true } })), { ordered: false });
    return result.upsertedCount + result.modifiedCount;
  }
  for (const record of normalized) memoryStore().messages.set(mapKey(ownerUserId, record.messageId), record);
  return normalized.length;
}

export async function searchMessageRecords(ownerUserId: string, filters: { query?: string; guildId?: string; channelId?: string; from?: Date; to?: Date; authorId?: string }, limit = 100): Promise<MessageRecord[]> {
  const c = await collections();
  if (c) {
    const mongo: Record<string, unknown> = { ownerUserId };
    if (filters.guildId) mongo.guildId = filters.guildId;
    if (filters.channelId) mongo.channelId = filters.channelId;
    if (filters.authorId) mongo.authorId = filters.authorId;
    if (filters.from || filters.to) mongo.timestamp = { ...(filters.from ? { $gte: filters.from } : {}), ...(filters.to ? { $lte: filters.to } : {}) };
    if (filters.query) mongo.$text = { $search: filters.query };
    try { return await c.messages.find(mongo, { projection: { embedding: 0 } }).sort({ timestamp: -1 }).limit(Math.min(limit, 500)).toArray(); }
    catch {
      delete mongo.$text;
      if (filters.query) mongo.content = { $regex: escapeRegex(filters.query), $options: 'i' };
      return c.messages.find(mongo, { projection: { embedding: 0 } }).sort({ timestamp: -1 }).limit(Math.min(limit, 500)).toArray();
    }
  }
  const query = filters.query?.toLocaleLowerCase();
  return [...memoryStore().messages.values()].filter((message) => {
    if (message.ownerUserId !== ownerUserId) return false;
    if (filters.guildId && message.guildId !== filters.guildId) return false;
    if (filters.channelId && message.channelId !== filters.channelId) return false;
    if (filters.authorId && message.authorId !== filters.authorId) return false;
    if (filters.from && message.timestamp < filters.from) return false;
    if (filters.to && message.timestamp > filters.to) return false;
    if (query && !message.content.toLocaleLowerCase().includes(query)) return false;
    return true;
  }).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
}

export async function countMessageRecords(ownerUserId: string): Promise<number> {
  const c = await collections(); return c ? c.messages.countDocuments({ ownerUserId }) : [...memoryStore().messages.values()].filter((message) => message.ownerUserId === ownerUserId).length;
}

export async function getUser(userId: string): Promise<User | undefined> {
  const c = await collections(); return c ? (await c.users.findOne({ discordId: userId }) ?? undefined) : memoryStore().users.get(userId);
}

export async function updateUserCredits(userId: string, delta: number, event: { id: string; type: string; credits: number }): Promise<User> {
  const c = await collections();
  if (c) {
    const previous = await c.creditEvents.findOne({ _id: event.id });
    if (!previous) {
      await c.creditEvents.insertOne({ _id: event.id, userId, type: event.type, credits: event.credits, createdAt: new Date() });
      await c.users.updateOne({ discordId: userId }, { $inc: { aiCredits: delta }, $set: { updatedAt: new Date(), ...(event.type === 'purchase' ? { cloudEnabled: true } : {}) } });
    }
    return (await c.users.findOne({ discordId: userId }))!;
  }
  if (!memoryStore().creditEvents.has(event.id)) {
    memoryStore().creditEvents.set(event.id, event);
    const user = memoryStore().users.get(userId); if (!user) throw new Error('User not found'); user.aiCredits = Math.max(0, user.aiCredits + delta); if (event.type === 'purchase') user.cloudEnabled = true; user.updatedAt = new Date();
  }
  return memoryStore().users.get(userId)!;
}

export async function consumeAiCredits(userId: string, cost: number): Promise<{ user: User; usedFree: boolean }> {
  const c = await collections();
  if (c) {
    const free = await c.users.findOneAndUpdate({ discordId: userId, freeQuestionsUsed: { $lt: 2 } }, { $inc: { freeQuestionsUsed: 1 }, $set: { updatedAt: new Date() } }, { returnDocument: 'after' });
    if (free) return { user: free, usedFree: true };
    const paid = await c.users.findOneAndUpdate({ discordId: userId, aiCredits: { $gte: cost } }, { $inc: { aiCredits: -cost }, $set: { updatedAt: new Date() } }, { returnDocument: 'after' });
    if (!paid) throw new Error('INSUFFICIENT_CREDITS');
    return { user: paid, usedFree: false };
  }
  const user = memoryStore().users.get(userId); if (!user) throw new Error('User not found');
  if (user.freeQuestionsUsed < 2) { user.freeQuestionsUsed += 1; return { user, usedFree: true }; }
  if (user.aiCredits < cost) throw new Error('INSUFFICIENT_CREDITS');
  user.aiCredits -= cost; return { user, usedFree: false };
}

export async function refundAiCredits(userId: string, cost: number, usedFree: boolean): Promise<void> {
  const c = await collections();
  if (c) { await c.users.updateOne({ discordId: userId }, { $inc: usedFree ? { freeQuestionsUsed: -1 } : { aiCredits: cost } }); return; }
  const user = memoryStore().users.get(userId); if (!user) return; if (usedFree) user.freeQuestionsUsed = Math.max(0, user.freeQuestionsUsed - 1); else user.aiCredits += cost;
}

export async function listDocuments(kind: 'memories' | 'schedules' | 'autoReplies', ownerUserId: string): Promise<Record<string, unknown>[]> {
  const c = await collections();
  if (c) { const collection = kind === 'autoReplies' ? c.autoReplies : c[kind]; return collection.find({ ownerUserId }).sort({ createdAt: -1 }).toArray(); }
  return [...memoryStore()[kind].values()].filter((doc) => doc.ownerUserId === ownerUserId);
}

export async function createDocument(kind: 'memories' | 'schedules' | 'autoReplies', ownerUserId: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
  const id = new ObjectId().toHexString(); const doc = { _id: id, ...data, ownerUserId, createdAt: new Date(), updatedAt: new Date() }; const c = await collections();
  if (c) { const collection = kind === 'autoReplies' ? c.autoReplies : c[kind]; await collection.insertOne(doc); } else memoryStore()[kind].set(id, doc); return doc;
}

export async function updateDocument(kind: 'memories' | 'schedules' | 'autoReplies', ownerUserId: string, id: string, patch: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
  const c = await collections();
  if (c) { const collection = kind === 'autoReplies' ? c.autoReplies : c[kind]; return (await collection.findOneAndUpdate({ _id: id, ownerUserId }, { $set: { ...patch, updatedAt: new Date() } }, { returnDocument: 'after' })) ?? undefined; }
  const map = memoryStore()[kind]; const doc = map.get(id); if (!doc || doc.ownerUserId !== ownerUserId) return undefined; const updated = { ...doc, ...patch, updatedAt: new Date() }; map.set(id, updated); return updated;
}

export async function deleteDocument(kind: 'memories' | 'schedules' | 'autoReplies', ownerUserId: string, id: string): Promise<boolean> {
  const c = await collections(); if (c) { const collection = kind === 'autoReplies' ? c.autoReplies : c[kind]; return (await collection.deleteOne({ _id: id, ownerUserId })).deletedCount === 1; }
  const map = memoryStore()[kind]; const doc = map.get(id); return Boolean(doc?.ownerUserId === ownerUserId && map.delete(id));
}

export async function deleteUserData(ownerUserId: string): Promise<void> {
  const c = await collections();
  if (c) { await Promise.all([c.messages.deleteMany({ ownerUserId }), c.memories.deleteMany({ ownerUserId }), c.schedules.deleteMany({ ownerUserId }), c.autoReplies.deleteMany({ ownerUserId })]); return; }
  for (const map of [memoryStore().messages, memoryStore().memories, memoryStore().schedules, memoryStore().autoReplies]) for (const [key, doc] of map) if ('ownerUserId' in doc && doc.ownerUserId === ownerUserId) map.delete(key);
}

function escapeRegex(text: string): string { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
