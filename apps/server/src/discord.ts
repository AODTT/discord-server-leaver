import { config } from './config.js';
import { getOAuthToken } from './auth.js';

const API = 'https://discord.com/api/v10';

export type DiscordGuild = { id: string; name: string; icon?: string | null; owner?: boolean; permissions?: string; approximate_member_count?: number };
export type DiscordChannel = { id: string; guild_id?: string; name?: string; type: number; parent_id?: string | null };

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', token);
  const response = await fetch(`${API}${path}`, { ...init, headers });
  if (response.status === 429) {
    const body = await response.json().catch(() => ({})) as { retry_after?: number };
    const wait = Math.min(Math.max(Number(body.retry_after ?? 1), 0.25), 30);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    return request<T>(path, init, token);
  }
  if (!response.ok) { const detail = await response.text(); throw new Error(`Discord API ${response.status}: ${detail.slice(0, 300)}`); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function oauthStartUrl(state: string): string {
  const params = new URLSearchParams({ client_id: config.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: config.DISCORD_REDIRECT_URI, scope: 'identify guilds messages.read', state, prompt: 'consent' });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams({ client_id: config.DISCORD_CLIENT_ID, client_secret: config.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: config.DISCORD_REDIRECT_URI });
  return request('/oauth2/token', { method: 'POST', body });
}

export async function currentUser(token: string): Promise<{ id: string; username: string; avatar?: string | null }> { return request('/users/@me', {}, `Bearer ${token}`); }
export async function userGuilds(userId: string): Promise<DiscordGuild[]> { const token = await getOAuthToken(userId); return token ? request('/users/@me/guilds', {}, `Bearer ${token.accessToken}`) : []; }
export async function leaveGuild(userId: string, guildId: string, expectedName?: string): Promise<void> {
  const token = await getOAuthToken(userId); if (!token) throw new Error('Discord authorization expired');
  const guild = (await request<DiscordGuild[]>('/users/@me/guilds', {}, `Bearer ${token.accessToken}`)).find((item) => item.id === guildId);
  if (!guild) throw new Error('Server is not in this Discord account');
  if (guild.owner) throw new Error('Transfer or delete an owned server before leaving it');
  if (expectedName && guild.name !== expectedName) throw new Error('Server changed; refresh and confirm again');
  await request(`/users/@me/guilds/${encodeURIComponent(guildId)}`, { method: 'DELETE' }, `Bearer ${token.accessToken}`);
}

export async function userCanManageGuild(userId: string, guildId: string): Promise<boolean> {
  const guild = (await userGuilds(userId)).find((item) => item.id === guildId);
  if (!guild) return false;
  if (guild.owner) return true;
  try { return (BigInt(guild.permissions ?? '0') & 0x20n) === 0x20n; } catch { return false; }
}

export async function userGuildChannels(userId: string, guildId: string): Promise<DiscordChannel[]> {
  const token = await getOAuthToken(userId);
  if (!token) return [];
  try {
    return request(`/guilds/${encodeURIComponent(guildId)}/channels`, {}, `Bearer ${token.accessToken}`);
  } catch {
    return [];
  }
}

export async function userChannelMessages(userId: string, channelId: string, limit = 100, before?: string): Promise<Record<string, unknown>[]> {
  const token = await getOAuthToken(userId);
  if (!token) return [];
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) });
  if (before) params.set('before', before);
  try {
    return request(`/channels/${encodeURIComponent(channelId)}/messages?${params}`, {}, `Bearer ${token.accessToken}`);
  } catch {
    return [];
  }
}

export async function userSendMessage(userId: string, channelId: string, content: string): Promise<void> {
  const token = await getOAuthToken(userId);
  if (!token) throw new Error('Discord authorization expired');
  await request(`/channels/${encodeURIComponent(channelId)}/messages`, { method: 'POST', body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }) }, `Bearer ${token.accessToken}`);
}

export async function botGuildChannels(guildId: string): Promise<DiscordChannel[]> {
  if (!config.DISCORD_BOT_TOKEN) return [];
  return request(`/guilds/${encodeURIComponent(guildId)}/channels`, {}, `Bot ${config.DISCORD_BOT_TOKEN}`);
}

export async function botChannelMessages(channelId: string, limit = 100, before?: string): Promise<Record<string, unknown>[]> {
  if (!config.DISCORD_BOT_TOKEN) return [];
  const params = new URLSearchParams({ limit: String(Math.min(Math.max(limit, 1), 100)) }); if (before) params.set('before', before);
  return request(`/channels/${encodeURIComponent(channelId)}/messages?${params}`, {}, `Bot ${config.DISCORD_BOT_TOKEN}`);
}

export async function botSendMessage(channelId: string, content: string): Promise<void> {
  if (!config.DISCORD_BOT_TOKEN) throw new Error('Bot is not configured');
  await request(`/channels/${encodeURIComponent(channelId)}/messages`, { method: 'POST', body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: [] } }) }, `Bot ${config.DISCORD_BOT_TOKEN}`);
}
