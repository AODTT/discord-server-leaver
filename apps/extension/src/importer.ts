import { unzipSync, strFromU8 } from 'fflate';
import type { MessageRecord } from './types.js';

type ChannelContext = { channelId?: string; channelName?: string; guildId?: string; guildName?: string };

export async function parseDiscordDataPackage(file: File): Promise<MessageRecord[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!file.name.toLocaleLowerCase().endsWith('.zip')) return parseStandalone(strFromU8(bytes), file.name, {});
  const files = unzipSync(bytes); const output: MessageRecord[] = [];
  for (const [path, data] of Object.entries(files)) {
    const normalized = path.replace(/\\/g, '/');
    if (!/\/messages\.(json|csv)$/i.test(normalized)) continue;
    const folder = normalized.slice(0, normalized.lastIndexOf('/'));
    const channelData = findFile(files, `${folder}/channel.json`);
    const context = channelData ? parseChannel(strFromU8(channelData)) : inferContext(normalized);
    output.push(...parseStandalone(strFromU8(data), normalized, context));
    if (output.length > 1_000_000) throw new Error('This package contains more than one million messages. Import a smaller export.');
  }
  if (!output.length) {
    for (const [path, data] of Object.entries(files)) if (/messages.*\.json$/i.test(path)) output.push(...parseStandalone(strFromU8(data), path, inferContext(path)));
  }
  return dedupe(output);
}

function findFile(files: Record<string, Uint8Array>, target: string): Uint8Array | undefined { const key = Object.keys(files).find((path) => path.replace(/\\/g, '/').toLocaleLowerCase() === target.toLocaleLowerCase()); return key ? files[key] : undefined; }
function parseChannel(text: string): ChannelContext {
  try { const data = JSON.parse(text) as Record<string, unknown>; return { channelId: pick(data, ['id', 'channel_id', 'channelId']), channelName: pick(data, ['name', 'channel_name', 'channelName']), guildId: pick(data, ['guild_id', 'guildId']), guildName: pick(data, ['guild_name', 'guildName']) }; } catch { return {}; }
}
function inferContext(path: string): ChannelContext { const parts = path.replace(/\\/g, '/').split('/'); const folder = parts.at(-2) ?? ''; return { channelId: folder.replace(/^c/i, '') || undefined }; }

function parseStandalone(text: string, name: string, context: ChannelContext): MessageRecord[] {
  if (name.toLocaleLowerCase().endsWith('.csv')) return parseCsv(text).map((row) => normalize(row, context)).filter((record): record is MessageRecord => Boolean(record));
  try { const data: unknown = JSON.parse(text); const entries = Array.isArray(data) ? data : data && typeof data === 'object' && Array.isArray((data as Record<string, unknown>).messages) ? (data as { messages: unknown[] }).messages : [data]; return entries.map((entry) => normalize(entry, context)).filter((record): record is MessageRecord => Boolean(record)); } catch { return []; }
}

function normalize(value: unknown, context: ChannelContext): MessageRecord | undefined {
  if (!value || typeof value !== 'object') return undefined; const row = value as Record<string, unknown>;
  const content = pick(row, ['Contents', 'contents', 'content', 'message', 'text']); const timestamp = pick(row, ['Timestamp', 'timestamp', 'date', 'created_at']);
  if (!content || !timestamp || Number.isNaN(Date.parse(timestamp))) return undefined;
  const id = pick(row, ['ID', 'id', 'message_id', 'messageId']) || stableId(`${context.channelId ?? ''}:${timestamp}:${content}`);
  const author = row.author && typeof row.author === 'object' ? row.author as Record<string, unknown> : {}; const guildId = pick(row, ['guild_id', 'guildId']) || context.guildId; const channelId = pick(row, ['channel_id', 'channelId']) || context.channelId;
  const rawAttachments = row.Attachments ?? row.attachments;
  const attachments = Array.isArray(rawAttachments) ? rawAttachments.map((item: unknown) => typeof item === 'string' ? item : item && typeof item === 'object' ? pick(item as Record<string, unknown>, ['url']) : '').filter(Boolean) : [];
  return { messageId: id, content, timestamp: new Date(timestamp).toISOString(), authorId: pick(row, ['author_id', 'authorId']) || pick(author, ['id']), authorName: pick(row, ['author_name', 'authorName']) || pick(author, ['global_name', 'username']), guildId, guildName: pick(row, ['guild_name', 'guildName']) || context.guildName, channelId, channelName: pick(row, ['channel_name', 'channelName']) || context.channelName, source: 'data-package', attachments, jumpUrl: guildId && channelId ? `https://discord.com/channels/${guildId}/${channelId}/${id}` : undefined };
}

function pick(row: Record<string, unknown>, keys: string[]): string { for (const key of keys) { const value = row[key]; if (typeof value === 'string' && value.trim()) return value.trim(); if (typeof value === 'number') return String(value); } return ''; }
function stableId(text: string): string { let h1 = 0x811c9dc5; for (let i = 0; i < text.length; i += 1) { h1 ^= text.charCodeAt(i); h1 = Math.imul(h1, 0x01000193); } return `import-${(h1 >>> 0).toString(16)}-${text.length}`; }
function dedupe(records: MessageRecord[]): MessageRecord[] { const map = new Map<string, MessageRecord>(); for (const record of records) map.set(record.messageId, record); return [...map.values()]; }

export function parseCsv(input: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < input.length; i += 1) { const char = input[i]!; if (char === '"') { if (quoted && input[i + 1] === '"') { cell += '"'; i += 1; } else quoted = !quoted; } else if (char === ',' && !quoted) { row.push(cell); cell = ''; } else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && input[i + 1] === '\n') i += 1; row.push(cell); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; } else cell += char; }
  row.push(cell); if (row.some(Boolean)) rows.push(row); const header = rows.shift()?.map((item) => item.replace(/^\uFEFF/, '').trim()) ?? []; return rows.map((values) => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}
