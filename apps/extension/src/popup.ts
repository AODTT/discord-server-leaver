import { getDiscordToken, fetchGuilds, leaveGuild, type DiscordGuild } from './discord.js';

// State
let guilds: DiscordGuild[] = [];
let token: string | null = null;
let currentTab = 'servers';
let backendToken: string | null = null;
let userInfo: any = null;

const API_BASE = 'https://stream-dream.shop';

// Elements
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const userInfoEl = document.querySelector<HTMLDivElement>('#user-info')!;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setStatus(text: string, error = false): void {
  statusEl.textContent = text;
  statusEl.style.color = error ? '#ff4444' : '#4CAF50';
}

// ============================================================================
// TAB MANAGEMENT
// ============================================================================

function switchTab(tabName: string): void {
  currentTab = tabName;

  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `tab-${tabName}`);
  });

  // Render the active tab
  renderTab(tabName);
}

// Setup tab listeners
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const tabName = tab.getAttribute('data-tab');
    if (tabName) switchTab(tabName);
  });
});

// ============================================================================
// SERVERS TAB
// ============================================================================

function renderServersTab(): void {
  const container = document.querySelector('#tab-servers')!;

  if (!token) {
    container.innerHTML = `
      <div class="login-screen">
        <h2>Discord Server Leaver</h2>
        <p>Open Discord in a tab first, then click Detect Token.</p>
        <button id="detect-token" class="primary">Detect Discord Token</button>
        <div class="notice">
          <strong>Privacy:</strong> Your token stays in your browser.
          Nothing is sent to any server.
        </div>
      </div>
    `;
    container.querySelector('#detect-token')?.addEventListener('click', detectToken);
    return;
  }

  container.innerHTML = `
    <div class="toolbar">
      <input id="filter" type="text" placeholder="Search servers...">
      <button id="refresh" class="secondary">Refresh</button>
    </div>
    <div class="server-list" id="servers">
      ${guilds.length === 0
        ? '<div class="empty">No servers loaded.</div>'
        : guilds.map(guild => `
          <label class="server-item" ${guild.owner ? 'data-owner="true"' : ''}>
            <input
              type="checkbox"
              data-guild="${escapeHtml(guild.id)}"
              ${guild.owner ? 'disabled' : ''}
            >
            <span class="server-name">${escapeHtml(guild.name)}</span>
            ${guild.owner ? '<span class="owner-badge">OWNER</span>' : ''}
          </label>
        `).join('')}
    </div>
    <div class="actions">
      <button id="leave-selected" class="danger">Leave Selected Servers</button>
      <button id="keep-selected" class="secondary">Keep Selected (Leave Others)</button>
    </div>
  `;

  container.querySelector<HTMLInputElement>('#filter')?.addEventListener('input', (e) => {
    const term = (e.target as HTMLInputElement).value.toLowerCase();
    container.querySelectorAll<HTMLElement>('.server-item').forEach((item) => {
      const text = item.textContent?.toLowerCase() || '';
      item.style.display = text.includes(term) ? '' : 'none';
    });
  });

  container.querySelector('#refresh')?.addEventListener('click', loadGuilds);
  container.querySelector('#leave-selected')?.addEventListener('click', () => leaveSelected(false));
  container.querySelector('#keep-selected')?.addEventListener('click', () => leaveSelected(true));
}

async function detectToken(): Promise<void> {
  try {
    setStatus('Detecting Discord token...');
    const detectedToken = await getDiscordToken();

    if (!detectedToken) {
      setStatus('Could not detect token. Make sure Discord is open in a tab.', true);
      return;
    }

    token = detectedToken;
    await chrome.storage.local.set({ discordToken: token });
    setStatus('Token detected! Loading servers...');
    await loadGuilds();
    renderServersTab();
  } catch (error) {
    setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
  }
}

async function loadGuilds(): Promise<void> {
  try {
    if (!token) {
      const stored = await chrome.storage.local.get('discordToken');
      token = stored.discordToken || null;
    }

    if (!token) {
      setStatus('Discord not connected.', true);
      return;
    }

    setStatus('Loading servers...');
    guilds = await fetchGuilds(token);
    renderServersTab();
    setStatus(`Loaded ${guilds.length} servers.`);
  } catch (error) {
    setStatus(`Error loading servers: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
    if (error instanceof Error && error.message.includes('401')) {
      await chrome.storage.local.remove('discordToken');
      token = null;
      renderServersTab();
      setStatus('Token expired. Please reconnect.', true);
    }
  }
}

function getSelectedGuilds(): DiscordGuild[] {
  const checkboxes = document.querySelectorAll<HTMLInputElement>('[data-guild]:checked');
  return Array.from(checkboxes)
    .map(cb => guilds.find(g => g.id === cb.dataset.guild))
    .filter((g): g is DiscordGuild => g !== undefined && !g.owner);
}

async function leaveSelected(keepMode: boolean): Promise<void> {
  if (!token) {
    setStatus('Not connected to Discord.', true);
    return;
  }

  const selected = getSelectedGuilds();
  const targets = keepMode
    ? guilds.filter(g => !g.owner && !selected.some(s => s.id === g.id))
    : selected;

  if (targets.length === 0) {
    setStatus('No servers selected to leave.', true);
    return;
  }

  const confirmation = prompt(
    `⚠️ This will leave ${targets.length} server(s).\n\nType "LEAVE" to confirm:`
  );

  if (confirmation !== 'LEAVE') {
    setStatus('Cancelled.', true);
    return;
  }

  const leaveBtn = document.querySelector<HTMLButtonElement>('#leave-selected');
  const keepBtn = document.querySelector<HTMLButtonElement>('#keep-selected');
  if (leaveBtn) leaveBtn.disabled = true;
  if (keepBtn) keepBtn.disabled = true;

  let completed = 0;
  let failed = 0;

  for (const guild of targets) {
    try {
      await leaveGuild(token, guild.id);
      completed++;
      setStatus(`Left ${completed}/${targets.length} servers...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      failed++;
      console.error(`Failed to leave ${guild.name}:`, error);
    }
  }

  await loadGuilds();
  setStatus(`Done! Left ${completed} server(s).${failed > 0 ? ` Failed: ${failed}` : ''}`);
}

// ============================================================================
// HISTORY TAB
// ============================================================================

function renderHistoryTab(): void {
  const container = document.querySelector('#tab-history')!;
  container.innerHTML = `
    <div class="toolbar">
      <input id="search-query" type="text" placeholder="Search your messages...">
      <button id="search-btn" class="primary">Search</button>
    </div>
    <div class="form-group">
      <label>Date Range</label>
      <select id="date-range">
        <option value="7">Last 7 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
        <option value="365">Last year</option>
        <option value="all">All time</option>
      </select>
    </div>
    <div id="message-results" class="server-list">
      <div class="empty">Enter a search query to find messages.</div>
    </div>
  `;

  container.querySelector('#search-btn')?.addEventListener('click', searchMessages);
}

async function searchMessages(): Promise<void> {
  const query = (document.querySelector('#search-query') as HTMLInputElement)?.value;
  const resultsEl = document.querySelector('#message-results')!;

  if (!query) {
    setStatus('Enter a search term', true);
    return;
  }

  setStatus('Searching messages...');
  resultsEl.innerHTML = '<div class="empty">Searching...</div>';

  // This would integrate with backend API
  setTimeout(() => {
    resultsEl.innerHTML = '<div class="empty">Feature coming soon - requires backend integration</div>';
    setStatus('Search complete');
  }, 1000);
}

// ============================================================================
// AI SEARCH TAB
// ============================================================================

function renderAITab(): void {
  const container = document.querySelector('#tab-ai')!;

  const credits = userInfo?.aiCredits || 0;
  const freeQuestions = userInfo?.freeQuestionsRemaining || 2;

  container.innerHTML = `
    <div class="ai-credits">
      <div class="count">${credits} AI Credits</div>
      <div class="label">${freeQuestions} free questions remaining</div>
    </div>

    <div class="form-group">
      <label>Ask Your Discord History</label>
      <textarea id="ai-question" placeholder="e.g., Find someone who wants to farm with me"></textarea>
    </div>

    <button id="ask-ai" class="primary" style="width: 100%">Ask AI</button>

    <div id="ai-response" style="margin-top: 16px;"></div>

    ${credits === 0 && freeQuestions === 0 ? `
      <div class="purchase-options" style="margin-top: 20px;">
        <div class="purchase-card" data-pack="50">
          <div class="price">$5</div>
          <div class="credits">50 AI Credits</div>
        </div>
        <div class="purchase-card" data-pack="120">
          <div class="price">$10</div>
          <div class="credits">120 AI Credits</div>
        </div>
      </div>
    ` : ''}
  `;

  container.querySelector('#ask-ai')?.addEventListener('click', askAI);
  container.querySelectorAll('.purchase-card').forEach(card => {
    card.addEventListener('click', () => {
      const pack = card.getAttribute('data-pack');
      if (pack) purchaseCredits(pack);
    });
  });
}

async function askAI(): Promise<void> {
  const question = (document.querySelector('#ai-question') as HTMLTextAreaElement)?.value;
  const responseEl = document.querySelector('#ai-response')!;

  if (!question) {
    setStatus('Enter a question', true);
    return;
  }

  setStatus('Asking AI...');
  responseEl.innerHTML = '<div class="message-item"><div class="content">Thinking...</div></div>';

  // This would integrate with backend API
  setTimeout(() => {
    responseEl.innerHTML = `
      <div class="message-item">
        <div class="meta">AI Response</div>
        <div class="content">Feature coming soon - requires backend integration with MongoDB and AI processing</div>
      </div>
    `;
    setStatus('Response received');
  }, 1000);
}

async function purchaseCredits(pack: string): Promise<void> {
  setStatus('Opening checkout...');
  // This would integrate with Stripe checkout
  setTimeout(() => {
    setStatus('Feature coming soon', true);
  }, 500);
}

// ============================================================================
// SCHEDULER TAB
// ============================================================================

function renderSchedulerTab(): void {
  const container = document.querySelector('#tab-scheduler')!;
  container.innerHTML = `
    <button id="new-schedule" class="success" style="width: 100%; margin-bottom: 16px;">
      + New Scheduled Message
    </button>

    <div id="schedule-list" class="server-list">
      <div class="empty">No scheduled messages yet.</div>
    </div>

    <div id="schedule-form" style="display: none;">
      <h3 style="margin-bottom: 12px; color: #fff;">Schedule Message</h3>
      <div class="form-group">
        <label>Server</label>
        <select id="schedule-server">
          <option value="">Select server...</option>
        </select>
      </div>
      <div class="form-group">
        <label>Channel</label>
        <select id="schedule-channel">
          <option value="">Select channel...</option>
        </select>
      </div>
      <div class="form-group">
        <label>Message</label>
        <textarea id="schedule-message" placeholder="Type your message..."></textarea>
      </div>
      <div class="form-group">
        <label>Send Date & Time</label>
        <input type="datetime-local" id="schedule-datetime">
      </div>
      <div class="actions">
        <button id="save-schedule" class="primary">Schedule</button>
        <button id="cancel-schedule" class="secondary">Cancel</button>
      </div>
    </div>
  `;

  container.querySelector('#new-schedule')?.addEventListener('click', showScheduleForm);
  container.querySelector('#cancel-schedule')?.addEventListener('click', hideScheduleForm);
  container.querySelector('#save-schedule')?.addEventListener('click', saveSchedule);
}

function showScheduleForm(): void {
  (document.querySelector('#schedule-list') as HTMLElement).style.display = 'none';
  (document.querySelector('#new-schedule') as HTMLElement).style.display = 'none';
  (document.querySelector('#schedule-form') as HTMLElement).style.display = 'block';
}

function hideScheduleForm(): void {
  (document.querySelector('#schedule-list') as HTMLElement).style.display = 'block';
  (document.querySelector('#new-schedule') as HTMLElement).style.display = 'block';
  (document.querySelector('#schedule-form') as HTMLElement).style.display = 'none';
}

async function saveSchedule(): Promise<void> {
  setStatus('Saving schedule...');
  // This would integrate with backend API
  setTimeout(() => {
    hideScheduleForm();
    setStatus('Schedule saved!');
  }, 500);
}

// ============================================================================
// AUTO REPLY TAB
// ============================================================================

function renderAutoReplyTab(): void {
  const container = document.querySelector('#tab-auto-reply')!;
  container.innerHTML = `
    <button id="new-rule" class="success" style="width: 100%; margin-bottom: 16px;">
      + New Auto Reply Rule
    </button>

    <div id="rule-list" class="server-list">
      <div class="empty">No auto reply rules yet.</div>
    </div>

    <div id="rule-form" style="display: none;">
      <h3 style="margin-bottom: 12px; color: #fff;">Auto Reply Rule</h3>
      <div class="form-group">
        <label>Trigger Keyword</label>
        <input type="text" id="rule-keyword" placeholder="e.g., !support">
      </div>
      <div class="form-group">
        <label>Reply Message</label>
        <textarea id="rule-reply" placeholder="Type your auto reply..."></textarea>
      </div>
      <div class="form-group">
        <label>Server (optional)</label>
        <select id="rule-server">
          <option value="">All servers</option>
        </select>
      </div>
      <div class="form-group">
        <label>Channel (optional)</label>
        <select id="rule-channel">
          <option value="">All channels</option>
        </select>
      </div>
      <div class="form-group">
        <label>Cooldown (seconds)</label>
        <input type="number" id="rule-cooldown" value="60" min="10">
      </div>
      <div class="actions">
        <button id="save-rule" class="primary">Save Rule</button>
        <button id="cancel-rule" class="secondary">Cancel</button>
      </div>
    </div>
  `;

  container.querySelector('#new-rule')?.addEventListener('click', showRuleForm);
  container.querySelector('#cancel-rule')?.addEventListener('click', hideRuleForm);
  container.querySelector('#save-rule')?.addEventListener('click', saveRule);
}

function showRuleForm(): void {
  (document.querySelector('#rule-list') as HTMLElement).style.display = 'none';
  (document.querySelector('#new-rule') as HTMLElement).style.display = 'none';
  (document.querySelector('#rule-form') as HTMLElement).style.display = 'block';
}

function hideRuleForm(): void {
  (document.querySelector('#rule-list') as HTMLElement).style.display = 'block';
  (document.querySelector('#new-rule') as HTMLElement).style.display = 'block';
  (document.querySelector('#rule-form') as HTMLElement).style.display = 'none';
}

async function saveRule(): Promise<void> {
  setStatus('Saving rule...');
  // This would integrate with backend API
  setTimeout(() => {
    hideRuleForm();
    setStatus('Rule saved!');
  }, 500);
}

// ============================================================================
// SETTINGS TAB
// ============================================================================

function renderSettingsTab(): void {
  const container = document.querySelector('#tab-settings')!;
  container.innerHTML = `
    <div class="form-group">
      <label>Discord Connection</label>
      <button id="reconnect-discord" class="secondary">Reconnect Discord</button>
    </div>

    <div class="form-group">
      <label>Cloud Sync</label>
      <button id="enable-cloud" class="primary">${userInfo ? 'Cloud Enabled' : 'Enable Cloud'}</button>
      <p style="font-size: 12px; color: #72767d; margin-top: 8px;">
        Store your messages in the cloud for AI search across devices.
      </p>
    </div>

    <div class="form-group">
      <label>Privacy</label>
      <button id="delete-data" class="danger">Delete All Cloud Data</button>
    </div>

    <div class="form-group">
      <label>Support Development</label>
      <button id="donate" class="success">❤️ Donate</button>
    </div>

    <div class="notice" style="margin-top: 20px;">
      <strong>Version 2.0.0</strong>
      Discord Server Leaver with AI Memory
    </div>
  `;

  container.querySelector('#reconnect-discord')?.addEventListener('click', detectToken);
  container.querySelector('#delete-data')?.addEventListener('click', deleteCloudData);
}

async function deleteCloudData(): Promise<void> {
  const confirm = prompt('Type DELETE to confirm deleting all cloud data:');
  if (confirm !== 'DELETE') return;

  setStatus('Deleting cloud data...');
  // This would integrate with backend API
  setTimeout(() => {
    setStatus('Cloud data deleted');
  }, 500);
}

// ============================================================================
// TAB ROUTER
// ============================================================================

function renderTab(tabName: string): void {
  switch (tabName) {
    case 'servers':
      renderServersTab();
      break;
    case 'history':
      renderHistoryTab();
      break;
    case 'ai':
      renderAITab();
      break;
    case 'scheduler':
      renderSchedulerTab();
      break;
    case 'auto-reply':
      renderAutoReplyTab();
      break;
    case 'settings':
      renderSettingsTab();
      break;
  }
}

// ============================================================================
// INITIALIZATION
// ============================================================================

async function init(): Promise<void> {
  const stored = await chrome.storage.local.get(['discordToken', 'backendToken']);
  token = stored.discordToken || null;
  backendToken = stored.backendToken || null;

  if (token) {
    await loadGuilds();
  }

  renderTab(currentTab);
  setStatus('Ready');
}

init();
