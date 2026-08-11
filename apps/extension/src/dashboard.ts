import type { Guild } from './types.js';
import { ApiError, apiOrigin, createDonation, createMemory, currentUser, deleteCloudData, exchangeLoginCode, listGuilds, listMemories, leaveOneGuild, logout } from './api.js';

type User = { id: string; username: string; aiCredits: number; freeQuestionsRemaining: number; cloudEnabled: boolean };
type View = 'overview' | 'servers' | 'memory' | 'donate' | 'settings';

let view: View = 'overview';
let user: User | undefined;
let guilds: Guild[] = [];
let memories: Record<string, unknown>[] = [];
let notice = '';
const app = document.querySelector<HTMLDivElement>('#app')!;

const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] || char));
const errorText = (error: unknown): string => error instanceof ApiError || error instanceof Error ? error.message : 'Unexpected error';

function dashboardDialog(options: { title: string; message: string; confirmLabel?: string; requiredText?: string; danger?: boolean }): Promise<boolean> {
  document.querySelector('#dashboard-dialog')?.remove();
  const wrapper = document.createElement('div');
  wrapper.id = 'dashboard-dialog';
  wrapper.className = 'dashboard-dialog-backdrop';
  wrapper.innerHTML = '<section class="dashboard-dialog" role="dialog" aria-modal="true"><div class="dashboard-dialog-icon">!</div><h2>' + esc(options.title) + '</h2><p>' + esc(options.message) + '</p>' + (options.requiredText ? '<label>Type ' + esc(options.requiredText) + ' to continue<input id="dashboard-dialog-input" autocomplete="off"></label>' : '') + '<div class="dashboard-dialog-actions"><button class="btn ghost" data-dialog-cancel>Cancel</button><button class="btn ' + (options.danger ? 'danger' : 'primary') + '" data-dialog-confirm' + (options.requiredText ? ' disabled' : '') + '>' + esc(options.confirmLabel || 'Confirm') + '</button></div></section>';
  document.body.appendChild(wrapper);
  const input = wrapper.querySelector<HTMLInputElement>('#dashboard-dialog-input');
  const confirmButton = wrapper.querySelector<HTMLButtonElement>('[data-dialog-confirm]')!;
  return new Promise((resolve) => {
    const close = (value: boolean) => { wrapper.remove(); resolve(value); };
    input?.addEventListener('input', () => { confirmButton.disabled = input.value !== options.requiredText; });
    wrapper.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => close(false));
    confirmButton.addEventListener('click', () => close(true));
    wrapper.addEventListener('click', (event) => { if (event.target === wrapper) close(false); });
    window.setTimeout(() => (input || wrapper.querySelector<HTMLButtonElement>('[data-dialog-cancel]'))?.focus(), 0);
  });
}

async function boot(): Promise<void> {
  const code = new URLSearchParams(location.search).get('code');
  if (code) { try { await exchangeLoginCode(code); history.replaceState({}, '', location.pathname); } catch (error) { notice = errorText(error); } }
  try { user = (await currentUser()).user; await refresh(); } catch { user = undefined; }
  render();
}

async function refresh(): Promise<void> {
  if (!user) return;
  try { guilds = (await listGuilds()).guilds; } catch (error) { notice = errorText(error); }
  try { memories = (await listMemories()).memories; } catch { /* optional cloud panel */ }
}

function nav(key: View, label: string): string { return '<button class="' + (view === key ? 'active' : '') + '" data-view="' + key + '">' + label + '</button>'; }
function pageTitle(): string { return ({ overview: 'Your Discord workspace', servers: 'Manage servers', memory: 'AI Memory', donate: 'Support development', settings: 'Privacy & Settings' } as Record<View, string>)[view]; }

function render(): void {
  const content = view === 'overview' ? overview() : view === 'servers' ? servers() : view === 'memory' ? memoryPage() : view === 'donate' ? donationPage() : settingsPage();
  app.innerHTML = '<div class="shell"><aside class="side"><div class="brand">Discord Server Leaver</div><p class="tagline">Focused tools for managing your Discord servers.</p><nav class="nav">' + nav('overview', 'Overview') + nav('servers', 'Servers') + nav('memory', 'AI Memory') + nav('donate', 'Support') + nav('settings', 'Privacy & Settings') + '</nav><div class="side-footer">Your data stays local until you explicitly import it to cloud storage.</div></aside><main class="content"><div class="top"><div><div class="eyebrow">Discord Server Leaver · V2</div><h1 class="title">' + pageTitle() + '</h1><p class="sub">' + (user ? 'Signed in as ' + esc(user.username) : 'Connect Discord when you are ready.') + '</p></div><div class="actions">' + (user ? '<span class="pill">' + user.freeQuestionsRemaining + ' free AI · ' + user.aiCredits + ' credits</span><button class="btn ghost" data-action="logout">Sign out</button>' : '<button class="btn primary" data-action="login">Connect Discord</button>') + '</div></div>' + (notice ? '<div class="notice">' + esc(notice) + ' <button class="btn ghost" data-action="dismiss">Dismiss</button></div>' : '') + content + '</main></div>';
  wire();
}

function overview(): string { return '<div class="grid"><div class="stat"><div class="label">Servers</div><div class="value">' + (guilds.length || '—') + '</div></div><div class="stat"><div class="label">AI credits</div><div class="value">' + (user?.aiCredits || 0) + '</div></div><div class="stat"><div class="label">Memories</div><div class="value">' + memories.length + '</div></div></div><section class="card"><h2>Start here</h2><p>Connect Discord to manage servers, or open AI Memory to save the context that matters.</p><div class="toolbar"><button class="btn primary" data-view="servers">Manage servers</button><button class="btn" data-view="donate">Support development</button></div></section>'; }
function servers(): string { return '<section class="card"><div class="row"><div><h2>Bulk leave</h2><p>Select servers to leave. Owned servers are protected.</p></div><button class="btn danger" data-action="leave">Leave selected</button></div><div class="toolbar"><input class="input" id="guild-filter" placeholder="Search servers"><button class="btn ghost" data-action="refresh">Refresh</button></div><div class="table-wrap"><table class="table"><thead><tr><th></th><th>Server</th><th>Members</th><th>Status</th></tr></thead><tbody>' + (guilds.length ? guilds.map((guild) => '<tr><td><input type="checkbox" data-guild="' + esc(guild.id) + '" ' + (guild.owner ? 'disabled' : '') + '></td><td><div class="server-cell">' + guildIcon(guild) + '<span>' + esc(guild.name) + '</span></div></td><td>' + (guild.approximate_member_count ?? '—') + '</td><td>' + (guild.owner ? '<span class="pill">Owner</span>' : '<span class="pill">Leaveable</span>') + '</td></tr>').join('') : '<tr><td colspan="4">Connect Discord and refresh to load servers.</td></tr>') + '</tbody></table></div></section>'; }
function guildIcon(guild: Guild): string { if (guild.icon) { const iconUrl = 'https://cdn.discordapp.com/icons/' + esc(guild.id) + '/' + esc(guild.icon) + (guild.icon.startsWith('a_') ? '.gif' : '.png') + '?size=64'; return '<img class="guild-icon" src="' + iconUrl + '" alt="">'; } return '<div class="guild-icon-placeholder"></div>'; }
function memoryPage(): string { return '<section class="card"><h2>Saved memories</h2><form id="memory-form" class="form-grid"><div class="field"><label>Title</label><input class="input" name="title" required></div><div class="field"><label>Tags</label><input class="input" name="tags"></div><div class="field full"><label>Memory</label><textarea name="content" required></textarea></div><button class="btn primary">Save memory</button></form></section><section class="card">' + (memories.length ? memories.map((memory) => '<div class="card"><strong>' + esc(memory.title) + '</strong><p>' + esc(memory.content) + '</p></div>').join('') : '<div class="empty">No saved memories yet.</div>') + '</section>'; }
function donationPage(): string { return '<section class="card donation-panel"><div class="eyebrow">Support the project</div><h2>Keep Discord Server Leaver maintained.</h2><p>Choose a preset or enter a custom amount. Stripe securely handles payment details.</p><div class="form-grid"><div class="field"><label>Amount (USD)</label><div class="donation-input-wrapper"><span class="currency-symbol">$</span><input class="input donation-input" id="custom-amount" type="number" min="5" max="500" step="0.01" placeholder="10.00" required></div></div><div class="field"><label>Receipt email</label><input class="input" id="donation-email" type="email" placeholder="you@example.com" required></div></div><div class="quick-amounts"><button class="btn" type="button" data-action="donate-5">$5</button><button class="btn" type="button" data-action="donate-10">$10</button><button class="btn" type="button" data-action="donate-25">$25</button><button class="btn" type="button" data-action="donate-50">$50</button></div><button class="btn primary full-width" data-action="donate-custom">Continue to secure checkout</button><p class="donation-footnote">Your card information is sent directly to Stripe.</p></section>'; }
function settingsPage(): string { return '<section class="card"><h2>Privacy & data</h2><p>Account data is scoped to your Discord identity. Local browser data is never uploaded automatically.</p><button class="btn danger" data-action="delete-cloud">Delete cloud data</button></section>'; }

function wire(): void {
  document.querySelectorAll<HTMLElement>('[data-view]').forEach((button) => button.addEventListener('click', () => { view = button.dataset.view as View; notice = ''; render(); }));
  document.querySelector('[data-action=dismiss]')?.addEventListener('click', () => { notice = ''; render(); });
  document.querySelector('[data-action=login]')?.addEventListener('click', () => void login());
  document.querySelector('[data-action=logout]')?.addEventListener('click', () => void doLogout());
  document.querySelector('[data-action=refresh]')?.addEventListener('click', () => void refreshPage());
  document.querySelector('[data-action=leave]')?.addEventListener('click', () => void leaveSelected());
  document.querySelector('[data-action=delete-cloud]')?.addEventListener('click', () => void deleteCloud());
  document.querySelector('[data-action=donate-custom]')?.addEventListener('click', () => void donateCustom());
  for (const amount of [5, 10, 25, 50]) document.querySelector('[data-action=donate-' + amount + ']')?.addEventListener('click', () => { const input = document.querySelector<HTMLInputElement>('#custom-amount'); if (input) input.value = String(amount); });
  document.querySelector('#memory-form')?.addEventListener('submit', (event) => void saveMemory(event));
}

async function login(): Promise<void> { try { const origin = await apiOrigin(); const redirect = chrome.identity.getRedirectURL(); const result = await chrome.identity.launchWebAuthFlow({ url: origin + '/auth/discord/start?return_to=' + encodeURIComponent(redirect), interactive: true }); if (!result) throw new Error('Discord login did not complete'); const code = new URL(result).searchParams.get('code'); if (!code) throw new Error('Discord login did not complete'); await exchangeLoginCode(code); user = (await currentUser()).user; await refresh(); render(); } catch (error) { notice = 'Error: ' + errorText(error); render(); } }
async function doLogout(): Promise<void> { await logout(); user = undefined; guilds = []; memories = []; render(); }
async function refreshPage(): Promise<void> { await refresh(); render(); }
async function leaveSelected(): Promise<void> { const selected = Array.from(document.querySelectorAll<HTMLInputElement>('[data-guild]:checked')).map((input) => guilds.find((guild) => guild.id === input.dataset.guild)).filter((guild): guild is Guild => Boolean(guild && !guild.owner)); if (!selected.length) { notice = 'Select at least one leaveable server.'; render(); return; } if (!await dashboardDialog({ title: 'Leave selected servers?', message: 'You are about to leave ' + selected.length + ' server(s). This cannot be undone.', confirmLabel: 'Leave servers', danger: true })) return; for (const guild of selected) { try { await leaveOneGuild(guild); } catch (error) { notice = 'Error leaving ' + guild.name + ': ' + errorText(error); } } await refresh(); render(); }
async function saveMemory(event: Event): Promise<void> { event.preventDefault(); const data = new FormData(event.target as HTMLFormElement); try { await createMemory({ title: data.get('title'), content: data.get('content'), tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean) }); memories = (await listMemories()).memories; render(); } catch (error) { notice = 'Error: ' + errorText(error); render(); } }
async function deleteCloud(): Promise<void> { if (await dashboardDialog({ title: 'Delete cloud data?', message: 'Saved memories will be removed from your account.', confirmLabel: 'Delete cloud data', requiredText: 'DELETE', danger: true })) { await deleteCloudData(); memories = []; notice = 'Cloud data deleted.'; render(); } }
async function donateCustom(): Promise<void> { const input = document.querySelector<HTMLInputElement>('#custom-amount'); const emailInput = document.querySelector<HTMLInputElement>('#donation-email'); const amount = Number(input?.value || 0); const email = emailInput?.value.trim() || ''; if (!Number.isFinite(amount) || amount < 5 || amount > 500 || !emailInput?.validity.valid) { notice = 'Enter a valid amount ($5-$500) and receipt email.'; render(); return; } try { const result = await createDonation(Math.round(amount * 100) / 100, email); await chrome.tabs.create({ url: result.url }); notice = 'Secure checkout opened in a new tab.'; } catch (error) { notice = 'Error: ' + errorText(error); render(); } }

boot().catch((error) => { notice = 'Error: ' + errorText(error); render(); });
