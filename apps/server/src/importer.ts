import { createHash } from 'node:crypto';
import type { MessageRecord } from './types.js';

type UnknownRecord = Record<string, unknown>;

function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function findString(record: UnknownRecord, keys: string[]): string { for (const key of keys) { const value = stringValue(record[key]); if (value) return value; } return ''; }
function parseDate(value: unknown): Date | undefined { const text = stringValue(value); if (!text) return undefined; const date = new Date(text); return Number.isNaN(date.getTime()) ? undefined : date; }

export function normalizeImportedMessages(ownerUserId: string, entries: unknown[], context: { guildId?: string; guildName?: string; channelId?: string; channelName?: string } = {}): Omit<MessageRecord, 'ownerUserId'>[] {
  const result: Omit<MessageRecord, 'ownerUserId'>[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const record = raw as UnknownRecord;
    const content = findString(record, ['Contents', 'content', 'message', 'text']);
    const timestamp = parseDate(record.Timestamp ?? record.timestamp ?? record.date);
    if (!content || !timestamp) continue;
    const messageId = findString(record, ['ID', 'id', 'message_id', 'messageId']) || createHash('sha256').update(`${ownerUserId}:${timestamp.toISOString()}:${content}`).digest('hex');
    const author = record.author && typeof record.author === 'object' ? record.author as UnknownRecord : {};
    const rawAttachments = record.Attachments ?? record.attachments;
    const attachments = Array.isArray(rawAttachments) ? rawAttachments.map((item: unknown) => typeof item === 'string' ? item : '').filter(Boolean).slice(0, 20) : [];
    result.push({ messageId, content: content.slice(0, 20_000), timestamp, source: 'data-package', authorId: findString(record, ['authorId', 'author_id']) || findString(author, ['id']), authorName: findString(record, ['authorName', 'author_name']) || findString(author, ['global_name', 'username']), guildId: findString(record, ['guildId', 'guild_id']) || context.guildId, guildName: findString(record, ['guildName', 'guild_name']) || context.guildName, channelId: findString(record, ['channelId', 'channel_id']) || context.channelId, channelName: findString(record, ['channelName', 'channel_name']) || context.channelName, jumpUrl: findString(record, ['jumpUrl', 'jump_url']) || undefined, attachments });
  }
  return result;
}

export function parseDataPackageJson(ownerUserId: string, json: string, context?: { guildId?: string; guildName?: string; channelId?: string; channelName?: string }): Omit<MessageRecord, 'ownerUserId'>[] {
  try { const parsed: unknown = JSON.parse(json); return Array.isArray(parsed) ? normalizeImportedMessages(ownerUserId, parsed, context) : normalizeImportedMessages(ownerUserId, [parsed], context); }
  catch { return []; }
}
