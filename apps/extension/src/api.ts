import type { AiAnswer, AutoReplyRule, Guild, MessageRecord, Schedule } from './types.js';

declare const process: { env: { API_ORIGIN: string } };
const DEFAULT_ORIGIN = process.env.API_ORIGIN.replace(/\/$/, '');

export async function apiOrigin(): Promise<string> {
  const result = await chrome.storage.local.get('apiOrigin');
  return String(result.apiOrigin || DEFAULT_ORIGIN).replace(/\/$/, '');
}

async function authToken(): Promise<string | undefined> { const result = await chrome.storage.local.get('sessionToken'); return typeof result.sessionToken === 'string' ? result.sessionToken : undefined; }

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const origin = await apiOrigin(); const headers = new Headers(init.headers); const token = await authToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${origin}${path}`, { ...init, headers, credentials: 'include' });
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new ApiError(response.status, body.error || `Request failed (${response.status})`, body);
  return body;
}

export class ApiError extends Error { constructor(public status: number, message: string, public detail: unknown) { super(message); } }

export async function exchangeLoginCode(code: string): Promise<void> { const result = await api<{ token: string }>('/auth/exchange', { method: 'POST', body: JSON.stringify({ code }) }); await chrome.storage.local.set({ sessionToken: result.token }); }
export async function currentUser() { return api<{ user: { id: string; username: string; avatar?: string | null; aiCredits: number; freeQuestionsRemaining: number; cloudEnabled: boolean } }>('/auth/me'); }
export async function listGuilds() { return api<{ guilds: Guild[] }>('/guilds'); }
export async function leaveOneGuild(guild: Guild) { return api<{ ok: boolean }>(`/guilds/${encodeURIComponent(guild.id)}/leave`, { method: 'POST', body: JSON.stringify({ confirm: true, guildName: guild.name }) }); }
export async function listChannels(guildId: string) { return api<{ channels: { id: string; name: string; type: number }[] }>(`/guilds/${encodeURIComponent(guildId)}/channels`); }
export async function askAi(question: string, context: MessageRecord[]): Promise<AiAnswer> { return api('/ai/ask', { method: 'POST', body: JSON.stringify({ question, context }) }); }
export async function cloudImport(messages: MessageRecord[], mode: 'merge' | 'replace' = 'merge') { return api<{ imported: number; total: number }>('/messages/import', { method: 'POST', body: JSON.stringify({ messages, mode }) }); }
export async function listSchedules() { return api<{ schedules: Schedule[] }>('/schedules'); }
export async function createSchedule(data: Record<string, unknown>) { return api<{ schedule: Schedule }>('/schedules', { method: 'POST', body: JSON.stringify(data) }); }
export async function updateSchedule(id: string, data: Record<string, unknown>) { return api<{ schedule: Schedule }>(`/schedules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }); }
export async function deleteSchedule(id: string) { return api<{ ok: boolean }>(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function listRules() { return api<{ rules: AutoReplyRule[] }>('/auto-replies'); }
export async function createRule(data: Record<string, unknown>) { return api<{ rule: AutoReplyRule }>('/auto-replies', { method: 'POST', body: JSON.stringify(data) }); }
export async function updateRule(id: string, data: Record<string, unknown>) { return api<{ rule: AutoReplyRule }>(`/auto-replies/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }); }
export async function deleteRule(id: string) { return api<{ ok: boolean }>(`/auto-replies/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
export async function listMemories() { return api<{ memories: Record<string, unknown>[] }>('/memories'); }
export async function createMemory(data: Record<string, unknown>) { return api<{ memory: Record<string, unknown> }>('/memories', { method: 'POST', body: JSON.stringify(data) }); }
export async function createCheckout(pack: '50' | '120' | '300') { return api<{ url: string }>('/billing/checkout', { method: 'POST', body: JSON.stringify({ pack }) }); }
export async function createDonation(amount: number, email: string) { return api<{ url: string }>('/api/donate', { method: 'POST', body: JSON.stringify({ amount, email }) }); }
export async function deleteCloudData() { return api<{ ok: boolean }>('/data/all', { method: 'DELETE' }); }
export async function getPublicConfig() { return api<{ apiOrigin: string; minDonation?: number; maxDonation?: number; promoDiscount?: number; donationUrl?: string; siteUrl?: string; botInviteUrl?: string }>('/config/public'); }
export async function logout() { try { await api('/auth/logout', { method: 'POST' }); } finally { await chrome.storage.local.remove('sessionToken'); } }
