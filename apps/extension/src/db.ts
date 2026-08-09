import type { MessageRecord, SearchFilters } from './types.js';

const DB_NAME = 'discord-memory-toolkit';
const DB_VERSION = 1;
const MESSAGE_STORE = 'messages';
const META_STORE = 'meta';

type Meta = { key: string; value: unknown };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const messages = db.objectStoreNames.contains(MESSAGE_STORE)
        ? request.transaction!.objectStore(MESSAGE_STORE)
        : db.createObjectStore(MESSAGE_STORE, { keyPath: 'messageId' });
      for (const index of ['timestamp', 'guildId', 'channelId', 'authorId']) {
        if (!messages.indexNames.contains(index)) messages.createIndex(index, index, { unique: false });
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open local history database'));
  });
}

async function tx<T>(mode: IDBTransactionMode, work: (stores: { messages: IDBObjectStore; meta: IDBObjectStore }) => Promise<T> | T): Promise<T> {
  const db = await openDb();
  const transaction = db.transaction([MESSAGE_STORE, META_STORE], mode);
  const result = await work({ messages: transaction.objectStore(MESSAGE_STORE), meta: transaction.objectStore(META_STORE) });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Local database transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Local database transaction aborted'));
  });
  db.close();
  return result;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export async function upsertMessages(records: MessageRecord[]): Promise<number> {
  if (!records.length) return 0;
  return tx('readwrite', ({ messages }) => {
    let count = 0;
    for (const record of records) { messages.put(record); count += 1; }
    return count;
  });
}

export async function countMessages(): Promise<number> {
  return tx('readonly', ({ messages }) => requestResult(messages.count()));
}

export async function clearMessages(): Promise<void> {
  await tx('readwrite', ({ messages }) => { messages.clear(); });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await tx('readwrite', ({ meta }) => { meta.put({ key, value } satisfies Meta); });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return tx('readonly', async ({ meta }) => {
    const result = await requestResult(meta.get(key));
    return (result as Meta | undefined)?.value as T | undefined;
  });
}

function normalize(s: string): string { return s.trim().toLocaleLowerCase(); }

export async function searchMessages(filters: SearchFilters, limit = 250): Promise<MessageRecord[]> {
  const query = normalize(filters.query ?? '');
  const from = filters.from ? Date.parse(filters.from) : Number.NEGATIVE_INFINITY;
  const to = filters.to ? Date.parse(filters.to) + 86_399_999 : Number.POSITIVE_INFINITY;
  return tx('readonly', async ({ messages }) => {
    const all = await requestResult(messages.getAll()) as MessageRecord[];
    return all.filter((message) => {
      const timestamp = Date.parse(message.timestamp);
      if (timestamp < from || timestamp > to) return false;
      if (filters.guildId && message.guildId !== filters.guildId) return false;
      if (filters.channelId && message.channelId !== filters.channelId) return false;
      if (query && !normalize(message.content).includes(query)) return false;
      return true;
    }).sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, limit);
  });
}

export async function allMessages(limit = 10000): Promise<MessageRecord[]> { return searchMessages({}, limit); }

