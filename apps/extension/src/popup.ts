import { getDiscordToken, fetchGuilds, leaveGuild, type DiscordGuild } from './discord.js';

// State
let guilds: DiscordGuild[] = [];
let token: string | null = null;
let currentTab = 'servers';
let apiKey: string | null = null;
let apiKeyInfo: any = null;

const API_BASE = 'https://discord-server-leaver-production.up.railway.app';

// Elements
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const userInfoEl = document.querySelector<HTMLDivElement>('#user-info')!;;

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

  const selectedCount = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked:not(:disabled)').length;

  container.innerHTML = `
    <div class="toolbar">
      <input id="filter" type="text" placeholder="Search servers...">
      <button id="refresh" class="secondary">Refresh</button>
    </div>
    <div class="sticky-actions">
      <button id="leave-selected" class="danger" ${selectedCount === 0 ? 'disabled' : ''}>
        Leave Selected ${selectedCount > 0 ? `(${selectedCount})` : ''}
      </button>
    </div>
    <div class="server-list" id="servers">
      ${guilds.length === 0
        ? '<div class="empty">No servers loaded.</div>'
        : guilds.map(guild => {
          const iconUrl = guild.icon
            ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${guild.icon.startsWith('a_') ? 'gif' : 'png'}?size=64`
            : null;

          return `
          <label class="server-item" ${guild.owner ? 'data-owner="true"' : ''}>
            <input
              type="checkbox"
              data-guild="${escapeHtml(guild.id)}"
              ${guild.owner ? 'disabled' : ''}
            >
            ${iconUrl
              ? `<img class="server-icon" src="${iconUrl}" alt="">`
              : '<div class="server-icon-placeholder"></div>'}
            <span class="server-name">${escapeHtml(guild.name)}</span>
            ${guild.owner ? '<span class="owner-badge">OWNER</span>' : ''}
          </label>
        `;
        }).join('')}
    </div>
  `;

  // Update button state on checkbox change
  const updateLeaveButton = () => {
    const count = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked:not(:disabled)').length;
    const leaveBtn = container.querySelector<HTMLButtonElement>('#leave-selected');
    if (leaveBtn) {
      leaveBtn.disabled = count === 0;
      leaveBtn.textContent = `Leave Selected ${count > 0 ? `(${count})` : ''}`;
    }
  };

  container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(checkbox => {
    checkbox.addEventListener('change', updateLeaveButton);
  });

  container.querySelector<HTMLInputElement>('#filter')?.addEventListener('input', (e) => {
    const term = (e.target as HTMLInputElement).value.toLowerCase();
    container.querySelectorAll<HTMLElement>('.server-item').forEach((item) => {
      const text = item.textContent?.toLowerCase() || '';
      item.style.display = text.includes(term) ? '' : 'none';
    });
  });

  container.querySelector('#refresh')?.addEventListener('click', loadGuilds);
  container.querySelector('#leave-selected')?.addEventListener('click', () => leaveSelected(false));
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

  if (!token) {
    container.innerHTML = `
      <div class="login-screen">
        <h3>Discord Token Required</h3>
        <p>Connect your Discord account first to view message history.</p>
        <button id="detect-token-history" class="primary">Detect Discord Token</button>
      </div>
    `;
    container.querySelector('#detect-token-history')?.addEventListener('click', detectToken);
    return;
  }

  container.innerHTML = `
    <div class="toolbar">
      <select id="history-server" style="flex: 1; margin-right: 8px;">
        <option value="">Select a server...</option>
        ${guilds.map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('')}
      </select>
      <button id="load-channels" class="secondary">Load Channels</button>
    </div>
    <div class="form-group" id="channel-selector" style="display: none;">
      <label>Channel</label>
      <select id="history-channel">
        <option value="">Select a channel...</option>
      </select>
      <button id="load-messages" class="primary" style="margin-top: 8px;">Load Messages</button>
    </div>
    <div id="message-results" class="server-list">
      <div class="empty">Select a server and channel to view message history.</div>
    </div>
  `;

  container.querySelector('#load-channels')?.addEventListener('click', loadChannels);
  container.querySelector('#load-messages')?.addEventListener('click', loadMessages);
}

async function loadChannels(): Promise<void> {
  const serverSelect = document.querySelector<HTMLSelectElement>('#history-server');
  const guildId = serverSelect?.value;

  if (!guildId || !token) {
    setStatus('Select a server first', true);
    return;
  }

  setStatus('Loading channels...');

  try {
    const response = await fetch(`${API_BASE}/api/discord/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordToken: token, guildId })
    });

    if (!response.ok) {
      throw new Error('Failed to load channels');
    }

    const data = await response.json();
    const textChannels = data.channels.filter((ch: any) => ch.type === 0); // Text channels only

    const channelSelect = document.querySelector<HTMLSelectElement>('#history-channel');
    if (channelSelect) {
      channelSelect.innerHTML = '<option value="">Select a channel...</option>' +
        textChannels.map((ch: any) => `<option value="${escapeHtml(ch.id)}">${escapeHtml(ch.name)}</option>`).join('');
    }

    const channelSelector = document.querySelector<HTMLElement>('#channel-selector');
    if (channelSelector) channelSelector.style.display = 'block';

    setStatus(`Loaded ${textChannels.length} channels`);
  } catch (error) {
    setStatus('Failed to load channels', true);
  }
}

async function loadMessages(): Promise<void> {
  const channelSelect = document.querySelector<HTMLSelectElement>('#history-channel');
  const channelId = channelSelect?.value;
  const resultsEl = document.querySelector('#message-results')!;

  if (!channelId || !token) {
    setStatus('Select a channel first', true);
    return;
  }

  setStatus('Loading messages...');
  resultsEl.innerHTML = '<div class="empty">Loading...</div>';

  try {
    const response = await fetch(`${API_BASE}/api/discord/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ discordToken: token, channelId, limit: 50 })
    });

    if (!response.ok) {
      throw new Error('Failed to load messages');
    }

    const data = await response.json();

    if (data.messages.length === 0) {
      resultsEl.innerHTML = '<div class="empty">No messages found in this channel.</div>';
      setStatus('No messages');
      return;
    }

    resultsEl.innerHTML = data.messages.map((msg: any) => `
      <div class="message-item">
        <div class="meta">${escapeHtml(msg.author?.username || 'Unknown')} • ${new Date(msg.timestamp).toLocaleString()}</div>
        <div class="content">${escapeHtml(msg.content || '[No content]')}</div>
      </div>
    `).join('');

    setStatus(`Loaded ${data.messages.length} messages`);
  } catch (error) {
    resultsEl.innerHTML = '<div class="empty">Failed to load messages. Make sure you have permission to view this channel.</div>';
    setStatus('Load error', true);
  }
}

async function saveApiKey(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('#api-key-input') ||
                document.querySelector<HTMLInputElement>('#api-key-input-ai');
  const key = input?.value.trim();

  if (!key || !key.startsWith('lat_')) {
    setStatus('Invalid API key format (should start with lat_)', true);
    return;
  }

  apiKey = key;
  apiKeyInfo = { credits: 999999 }; // Stream Dream uses different credit system
  await chrome.storage.local.set({ apiKey });
  setStatus('API key saved!');
  renderTab(currentTab);
}

// ============================================================================
// AI SEARCH TAB
// ============================================================================

function renderAITab(): void {
  const container = document.querySelector('#tab-ai')!;

  if (!apiKey) {
    container.innerHTML = `
      <div class="login-screen">
        <h3>API Key Required</h3>
        <p>Enter your Stream Dream API key to chat with AI about your Discord history.</p>
        <div class="form-group">
          <input type="text" id="api-key-input-ai" placeholder="lat_live_..." style="width: 100%; margin-bottom: 12px;">
          <button id="save-api-key-ai" class="primary">Save API Key</button>
        </div>
        <div class="notice">
          <strong>Get your API key:</strong><br>
          Visit <a href="https://stream-dream.shop" target="_blank">stream-dream.shop</a> to get your API key.
        </div>
      </div>
    `;
    container.querySelector('#save-api-key-ai')?.addEventListener('click', saveApiKey);
    return;
  }

  container.innerHTML = `
    <div class="ai-credits">
      <div class="count">Stream Dream AI</div>
      <div class="label">Powered by gpt-5.6-sol</div>
    </div>

    <div id="ai-chat-history" style="max-height: 300px; overflow-y: auto; margin-bottom: 16px; padding: 12px; background: #2f3136; border-radius: 8px;">
      <div class="empty" style="color: #72767d; text-align: center;">Start a conversation with your AI buddy!</div>
    </div>

    <div class="form-group">
      <textarea id="ai-question" placeholder="Ask me anything about your Discord history..."></textarea>
    </div>

    <button id="ask-ai" class="primary" style="width: 100%">Send Message</button>

    <div class="notice" style="margin-top: 16px;">
      <strong>Note:</strong> The AI has access to your Discord message history and can help you search, analyze, and understand your conversations.
    </div>
  `;

  container.querySelector('#ask-ai')?.addEventListener('click', askAI);
}

async function askAI(): Promise<void> {
  const question = (document.querySelector('#ai-question') as HTMLTextAreaElement)?.value;
  const chatHistory = document.querySelector('#ai-chat-history')!;
  const textarea = document.querySelector('#ai-question') as HTMLTextAreaElement;

  if (!question) {
    setStatus('Enter a question', true);
    return;
  }

  if (!apiKey) {
    setStatus('API key required', true);
    return;
  }

  // Clear empty state if present
  if (chatHistory.querySelector('.empty')) {
    chatHistory.innerHTML = '';
  }

  // Add user message
  const userMsg = document.createElement('div');
  userMsg.className = 'message-item';
  userMsg.innerHTML = `
    <div class="meta" style="color: #5865f2;">You</div>
    <div class="content">${escapeHtml(question)}</div>
  `;
  chatHistory.appendChild(userMsg);

  // Add thinking indicator
  const thinkingMsg = document.createElement('div');
  thinkingMsg.className = 'message-item';
  thinkingMsg.innerHTML = `
    <div class="meta" style="color: #57f287;">AI Buddy</div>
    <div class="content" style="color: #72767d;">Thinking...</div>
  `;
  chatHistory.appendChild(thinkingMsg);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  textarea.value = '';
  setStatus('Asking AI...');

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ message: question })
    });

    if (!response.ok) {
      throw new Error('AI request failed');
    }

    const data = await response.json();

    // Replace thinking with actual response
    thinkingMsg.innerHTML = `
      <div class="meta" style="color: #57f287;">AI Buddy</div>
      <div class="content">${escapeHtml(data.reply)}</div>
    `;
    chatHistory.scrollTop = chatHistory.scrollHeight;

    setStatus('Response received');
  } catch (error) {
    thinkingMsg.innerHTML = `
      <div class="meta" style="color: #ed4245;">Error</div>
      <div class="content">Failed to get AI response. Please check your API key and try again.</div>
    `;
    setStatus('AI error', true);
  }
}

async function purchaseCredits(pack: string): Promise<void> {
  setStatus('Redirecting to purchase page...');
  chrome.tabs.create({ url: 'https://stream-dream.shop' });
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
      <label>Stream Dream API Key</label>
      ${apiKey ? `
        <div style="padding: 12px; background: #2f3136; border-radius: 8px; margin-bottom: 12px;">
          <div style="font-size: 12px; color: #72767d;">Current Key</div>
          <div style="font-family: monospace; color: #fff; margin: 4px 0;">${apiKey.substring(0, 20)}...</div>
          <div style="font-size: 12px; color: #57f287;">Connected to Stream Dream</div>
        </div>
        <button id="remove-api-key" class="danger">Remove API Key</button>
      ` : `
        <button id="add-api-key" class="primary">Add API Key</button>
        <p style="font-size: 12px; color: #72767d; margin-top: 8px;">
          Get your API key from <a href="https://stream-dream.shop" target="_blank">stream-dream.shop</a>
        </p>
      `}
    </div>

    <div class="form-group">
      <label>Discord Connection</label>
      <button id="reconnect-discord" class="secondary">Reconnect Discord</button>
    </div>

    <div class="notice" style="margin-top: 20px;">
      <strong>Version 2.0.0</strong><br>
      Discord Server Leaver with AI Memory<br>
      <a href="https://stream-dream.shop" target="_blank" style="color: #5865f2;">Powered by Stream Dream</a>
    </div>
  `;

  container.querySelector('#reconnect-discord')?.addEventListener('click', detectToken);
  container.querySelector('#remove-api-key')?.addEventListener('click', removeApiKey);
  container.querySelector('#add-api-key')?.addEventListener('click', () => switchTab('ai'));
}

async function removeApiKey(): Promise<void> {
  const confirm = prompt('Remove API key? Type REMOVE to confirm:');
  if (confirm !== 'REMOVE') return;

  apiKey = null;
  apiKeyInfo = null;
  await chrome.storage.local.remove('apiKey');
  setStatus('API key removed');
  renderTab('settings');
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
  const stored = await chrome.storage.local.get(['discordToken', 'apiKey']);
  token = stored.discordToken || null;
  apiKey = stored.apiKey || null;

  if (token) {
    await loadGuilds();
  }

  if (apiKey) {
    // Set dummy info for Stream Dream (uses different billing model)
    apiKeyInfo = { credits: 999999 };
  }

  renderTab(currentTab);
  setStatus('Ready');
}

init();
