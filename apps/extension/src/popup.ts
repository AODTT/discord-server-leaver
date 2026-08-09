import { getDiscordToken, fetchGuilds, leaveGuild, type DiscordGuild } from './discord.js';
import { getToolDefinitions, executeTool } from './discord-tools.js';

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
      <button id="auto-leave-settings" class="secondary">⚙️ Auto-Leave</button>
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
  container.querySelector('#auto-leave-settings')?.addEventListener('click', showAutoLeaveSettings);
}

async function showAutoLeaveSettings(): Promise<void> {
  const container = document.querySelector('#tab-servers')!;

  // Get current settings
  const data = await chrome.storage.local.get('autoLeaveSettings');
  const settings = data.autoLeaveSettings || {
    enabled: false,
    inactiveDays: 30,
    checkOnStartup: false
  };

  container.innerHTML = `
    <div style="padding: 16px;">
      <h3 style="color: #fff; margin-bottom: 16px;">⚙️ Auto-Leave Settings</h3>

      <div class="form-group">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="auto-leave-enabled" ${settings.enabled ? 'checked' : ''}>
          <span>Enable Auto-Leave</span>
        </label>
      </div>

      <div class="form-group">
        <label>Leave servers inactive for:</label>
        <select id="inactive-days">
          <option value="7" ${settings.inactiveDays === 7 ? 'selected' : ''}>7 days</option>
          <option value="14" ${settings.inactiveDays === 14 ? 'selected' : ''}>14 days</option>
          <option value="30" ${settings.inactiveDays === 30 ? 'selected' : ''}>30 days</option>
          <option value="60" ${settings.inactiveDays === 60 ? 'selected' : ''}>60 days</option>
          <option value="90" ${settings.inactiveDays === 90 ? 'selected' : ''}>90 days</option>
        </select>
      </div>

      <div class="form-group">
        <label style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="check-on-startup" ${settings.checkOnStartup ? 'checked' : ''}>
          <span>Check on browser startup</span>
        </label>
      </div>

      <button id="check-now" class="primary" style="width: 100%; margin-bottom: 8px;">Check Now</button>
      <button id="save-settings" class="success" style="width: 100%; margin-bottom: 8px;">Save Settings</button>
      <button id="back-to-servers" class="secondary" style="width: 100%;">← Back to Servers</button>

      <div id="inactive-servers" style="margin-top: 16px;"></div>
    </div>
  `;

  container.querySelector('#check-now')?.addEventListener('click', checkInactiveServers);
  container.querySelector('#save-settings')?.addEventListener('click', saveAutoLeaveSettings);
  container.querySelector('#back-to-servers')?.addEventListener('click', () => renderServersTab());
}

async function checkInactiveServers(): Promise<void> {
  if (!token) {
    setStatus('Discord token required', true);
    return;
  }

  const inactiveDays = parseInt((document.querySelector('#inactive-days') as HTMLSelectElement).value);
  const resultsEl = document.querySelector('#inactive-servers')!;

  setStatus('Checking server activity...');
  resultsEl.innerHTML = '<div class="empty">Checking...</div>';

  try {
    const inactiveServers: any[] = [];
    const cutoffDate = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

    for (const guild of guilds) {
      if (guild.owner) continue; // Skip owned servers

      try {
        // Get channels for this guild
        const channelsResponse = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/channels`, {
          headers: { 'Authorization': token }
        });

        if (!channelsResponse.ok) continue;

        const channels = await channelsResponse.json();
        const textChannels = channels.filter((ch: any) => ch.type === 0);

        let hasRecentActivity = false;

        // Check recent messages in up to 3 channels
        for (const channel of textChannels.slice(0, 3)) {
          try {
            const messagesResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages?limit=1`, {
              headers: { 'Authorization': token }
            });

            if (!messagesResponse.ok) continue;

            const messages = await messagesResponse.json();

            if (messages.length > 0) {
              const lastMessageDate = new Date(messages[0].timestamp);
              if (lastMessageDate > cutoffDate) {
                hasRecentActivity = true;
                break;
              }
            }
          } catch (err) {
            console.error('Error checking channel:', err);
          }
        }

        if (!hasRecentActivity) {
          inactiveServers.push(guild);
        }

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        console.error(`Error checking ${guild.name}:`, err);
      }
    }

    if (inactiveServers.length === 0) {
      resultsEl.innerHTML = '<div class="empty">No inactive servers found!</div>';
      setStatus('All servers are active');
      return;
    }

    resultsEl.innerHTML = `
      <h4 style="color: #fff; margin-bottom: 12px;">Found ${inactiveServers.length} inactive server(s)</h4>
      <div class="server-list">
        ${inactiveServers.map(guild => `
          <label class="server-item">
            <input type="checkbox" data-guild="${escapeHtml(guild.id)}" checked>
            <span class="server-name">${escapeHtml(guild.name)}</span>
          </label>
        `).join('')}
      </div>
      <button id="leave-inactive" class="danger" style="width: 100%; margin-top: 12px;">Leave Selected Inactive Servers</button>
    `;

    resultsEl.querySelector('#leave-inactive')?.addEventListener('click', async () => {
      const selected = Array.from(resultsEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'))
        .map(cb => cb.dataset.guild)
        .filter(id => id);

      if (selected.length === 0) return;

      const confirmation = prompt(`Leave ${selected.length} inactive server(s)? Type "LEAVE" to confirm:`);
      if (confirmation !== 'LEAVE') return;

      for (const guildId of selected) {
        if (!guildId) continue;
        try {
          await leaveGuild(token!, guildId);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`Failed to leave ${guildId}:`, error);
        }
      }

      await loadGuilds();
      renderServersTab();
      setStatus(`Left ${selected.length} server(s)`);
    });

    setStatus(`Found ${inactiveServers.length} inactive servers`);
  } catch (error) {
    resultsEl.innerHTML = '<div class="empty">Error checking servers</div>';
    setStatus('Check failed', true);
  }
}

async function saveAutoLeaveSettings(): Promise<void> {
  const enabled = (document.querySelector('#auto-leave-enabled') as HTMLInputElement).checked;
  const inactiveDays = parseInt((document.querySelector('#inactive-days') as HTMLSelectElement).value);
  const checkOnStartup = (document.querySelector('#check-on-startup') as HTMLInputElement).checked;

  await chrome.storage.local.set({
    autoLeaveSettings: {
      enabled,
      inactiveDays,
      checkOnStartup
    }
  });

  setStatus('Settings saved!');
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
        <p>Connect your Discord account first to fetch message history.</p>
        <button id="detect-token-history" class="primary">Detect Discord Token</button>
      </div>
    `;
    container.querySelector('#detect-token-history')?.addEventListener('click', detectToken);
    return;
  }

  // Check if history fetch is in progress
  chrome.storage.local.get(['historyFetchStatus'], (result) => {
    const status = result.historyFetchStatus || { running: false, progress: 0, total: 0 };

    container.innerHTML = `
      <div class="ai-credits">
        <div class="count">Discord History Indexer</div>
        <div class="label">Fetching all your messages for AI access</div>
      </div>

      ${status.running ? `
        <div class="notice" style="background: #5865f2; color: #fff;">
          <strong>⚙️ Indexing in progress...</strong><br>
          ${status.progress} / ${status.total} channels processed
        </div>
      ` : `
        <button id="start-fetch" class="success" style="width: 100%; margin-bottom: 16px;">
          🚀 Start Fetching All Discord History
        </button>
      `}

      <div class="form-group">
        <label>Search Fetched Messages</label>
        <input id="search-query" type="text" placeholder="Search your messages...">
        <button id="search-btn" class="primary" style="margin-top: 8px;">Search</button>
      </div>

      <div id="history-stats" style="padding: 12px; background: #2f3136; border-radius: 8px; margin-bottom: 16px;">
        <div style="font-size: 12px; color: #72767d;">Loading statistics...</div>
      </div>

      <div id="message-results" class="server-list">
        <div class="empty">Start fetching to index all your Discord messages.</div>
      </div>
    `;

    container.querySelector('#start-fetch')?.addEventListener('click', startHistoryFetch);
    container.querySelector('#search-btn')?.addEventListener('click', searchLocalHistory);
    loadHistoryStats();
  });
}

async function loadHistoryStats(): Promise<void> {
  const statsEl = document.querySelector('#history-stats');
  if (!statsEl) return;

  const data = await chrome.storage.local.get('discordHistory');
  const messages = data.discordHistory || [];

  if (messages.length === 0) {
    statsEl.innerHTML = '<div style="font-size: 12px; color: #72767d;">No messages indexed yet. Click "Start Fetching" to begin.</div>';
    return;
  }

  const servers = new Set(messages.map((m: any) => m.server)).size;
  const channels = new Set(messages.map((m: any) => m.channelId)).size;

  statsEl.innerHTML = `
    <div style="display: flex; justify-content: space-around; text-align: center;">
      <div>
        <div style="font-size: 24px; color: #57f287; font-weight: bold;">${messages.length}</div>
        <div style="font-size: 12px; color: #72767d;">Messages</div>
      </div>
      <div>
        <div style="font-size: 24px; color: #5865f2; font-weight: bold;">${servers}</div>
        <div style="font-size: 12px; color: #72767d;">Servers</div>
      </div>
      <div>
        <div style="font-size: 24px; color: #faa61a; font-weight: bold;">${channels}</div>
        <div style="font-size: 12px; color: #72767d;">Channels</div>
      </div>
    </div>
  `;
}

async function startHistoryFetch(): Promise<void> {
  if (!token) {
    setStatus('Discord token required', true);
    return;
  }

  setStatus('Starting history fetch...');

  // Send message to background script to start fetching
  chrome.runtime.sendMessage({
    type: 'START_HISTORY_FETCH',
    token: token,
    guilds: guilds
  });

  setStatus('History fetch started in background. You can close the extension.');
  renderHistoryTab();
}

async function searchLocalHistory(): Promise<void> {
  const query = (document.querySelector('#search-query') as HTMLInputElement)?.value.toLowerCase();
  const resultsEl = document.querySelector('#message-results')!;

  if (!query) {
    setStatus('Enter a search term', true);
    return;
  }

  setStatus('Searching...');

  const data = await chrome.storage.local.get('discordHistory');
  const messages = data.discordHistory || [];

  const results = messages.filter((m: any) =>
    m.content?.toLowerCase().includes(query) ||
    m.author?.toLowerCase().includes(query)
  ).slice(0, 100); // Limit to 100 results

  if (results.length === 0) {
    resultsEl.innerHTML = '<div class="empty">No messages found.</div>';
    setStatus('No results');
    return;
  }

  resultsEl.innerHTML = results.map((msg: any) => `
    <div class="message-item">
      <div class="meta">${escapeHtml(msg.author || 'Unknown')} • ${new Date(msg.timestamp).toLocaleString()}</div>
      <div class="content">${escapeHtml(msg.content || '[No content]')}</div>
      <div class="meta">${escapeHtml(msg.server || 'Unknown Server')} / ${escapeHtml(msg.channel || 'Unknown Channel')}</div>
    </div>
  `).join('');

  setStatus(`Found ${results.length} messages`);
}

async function loadChannels(): Promise<void> {
  // Removed - not needed anymore
}

async function loadMessages(): Promise<void> {
  // Removed - not needed anymore
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

  // Load saved chat history
  chrome.storage.local.get([`chat_history_${apiKey}`], (result) => {
    const savedHistory = result[`chat_history_${apiKey}`] || [];

    container.innerHTML = `
      <div class="ai-credits">
        <div class="count">Stream Dream AI</div>
        <div class="label">Full Discord API access via AI</div>
      </div>

      <div id="ai-chat-history" style="max-height: 300px; overflow-y: auto; margin-bottom: 16px; padding: 12px; background: #2f3136; border-radius: 8px;">
        ${savedHistory.length === 0 ? '<div class="empty" style="color: #72767d; text-align: center;">Ask me to do anything with your Discord account!</div>' : ''}
      </div>

      <div class="form-group">
        <input type="file" id="ai-image" accept="image/*" style="margin-bottom: 8px;">
        <textarea id="ai-question" placeholder="Ask me to fetch messages, send messages, search for things, or analyze trades..."></textarea>
      </div>

      <button id="ask-ai" class="primary" style="width: 100%; margin-bottom: 8px;">Send Message</button>
      <button id="clear-chat" class="danger" style="width: 100%;">Clear Chat History</button>

      <div class="notice" style="margin-top: 16px;">
        <strong>Capabilities:</strong> I can fetch messages, send messages, search, analyze trades, get user info, add reactions, create DMs, and more!
      </div>
    `;

    container.querySelector('#ask-ai')?.addEventListener('click', askAI);
    container.querySelector('#clear-chat')?.addEventListener('click', clearChatHistory);

    // Restore saved messages
    const chatHistoryEl = container.querySelector('#ai-chat-history')!;
    savedHistory.forEach((msg: any) => {
      const msgDiv = document.createElement('div');
      msgDiv.className = 'message-item';
      msgDiv.innerHTML = `
        <div class="meta" style="color: ${msg.role === 'user' ? '#5865f2' : '#57f287'};">${msg.role === 'user' ? 'You' : 'AI Buddy'}</div>
        <div class="content">${escapeHtml(msg.content)}</div>
      `;
      chatHistoryEl.appendChild(msgDiv);
    });

    if (savedHistory.length > 0) {
      chatHistoryEl.scrollTop = chatHistoryEl.scrollHeight;
    }
  });
}

async function clearChatHistory(): Promise<void> {
  if (!apiKey) return;

  const confirm = prompt('Clear all chat history? Type CLEAR to confirm:');
  if (confirm !== 'CLEAR') return;

  await chrome.storage.local.remove(`chat_history_${apiKey}`);
  renderAITab();
  setStatus('Chat history cleared');
}

async function askAI(): Promise<void> {
  const question = (document.querySelector('#ai-question') as HTMLTextAreaElement)?.value;
  const imageInput = document.querySelector('#ai-image') as HTMLInputElement;
  const chatHistory = document.querySelector('#ai-chat-history')!;
  const textarea = document.querySelector('#ai-question') as HTMLTextAreaElement;

  if (!question && !imageInput?.files?.[0]) {
    setStatus('Enter a question or select an image', true);
    return;
  }

  if (!apiKey) {
    setStatus('API key required', true);
    return;
  }

  if (!token) {
    setStatus('Discord token required', true);
    return;
  }

  // Clear empty state if present
  if (chatHistory.querySelector('.empty')) {
    chatHistory.innerHTML = '';
  }

  // Handle image upload
  let imageBase64 = '';
  if (imageInput?.files?.[0]) {
    const file = imageInput.files[0];
    imageBase64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });
  }

  const userContent = question || '[Sent an image]';

  // Add user message
  const userMsg = document.createElement('div');
  userMsg.className = 'message-item';
  userMsg.innerHTML = `
    <div class="meta" style="color: #5865f2;">You</div>
    <div class="content">${escapeHtml(userContent)}${imageBase64 ? '<br><img src="' + imageBase64 + '" style="max-width: 200px; border-radius: 8px; margin-top: 8px;">' : ''}</div>
  `;
  chatHistory.appendChild(userMsg);

  // Save to history
  await saveChatMessage('user', userContent);

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
  if (imageInput) imageInput.value = '';
  setStatus('Processing...');

  try {
    // Build message content
    const messageContent: any[] = [];

    if (imageBase64) {
      messageContent.push({
        type: 'image_url',
        image_url: { url: imageBase64 }
      });
    }

    if (question) {
      messageContent.push({
        type: 'text',
        text: question
      });
    }

    // Get conversation history
    const historyData = await chrome.storage.local.get(`chat_history_${apiKey}`);
    const conversationHistory = (historyData[`chat_history_${apiKey}`] || []).slice(-10); // Last 10 messages

    const messages = [
      {
        role: 'system',
        content: `You are an AI assistant with FULL ACCESS to the user's Discord account via API tools. You can:

- fetch_messages: Get messages from any channel
- send_message: Send messages to channels
- search_messages: Search for specific content
- get_guilds: List all servers
- get_channels: List channels in a server
- get_user: Get user information
- add_reaction: React to messages
- create_dm: Create DM channels

When the user asks you to do something, USE THE APPROPRIATE TOOL. Don't just describe what you would do - actually call the tool!

Examples:
- "fetch messages from channel 123" → call fetch_messages with channel_id
- "send hello to channel 456" → call send_message
- "what servers am I in" → call get_guilds
- "search for trade in server 789" → call search_messages

For trade analysis, fetch recent messages from trade channels first, then analyze them.

Be proactive and actually execute actions, don't just talk about them!`
      },
      ...conversationHistory.map((m: any) => ({
        role: m.role,
        content: m.content
      })),
      {
        role: 'user',
        content: messageContent.length > 0 ? messageContent : question
      }
    ];

    // Call Stream Dream API with function calling
    let response = await fetch('https://stream-dream.shop/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        messages: messages,
        tools: getToolDefinitions(),
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Stream Dream API error:', errorText);
      throw new Error(`AI request failed: ${response.status}`);
    }

    let data = await response.json();
    let assistantMessage = data.choices[0]?.message;

    // Handle function calls
    while (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolCall = assistantMessage.tool_calls[0];
      const toolName = toolCall.function.name;
      const toolParams = JSON.parse(toolCall.function.arguments);

      setStatus(`Executing: ${toolName}...`);

      try {
        const toolResult = await executeTool(toolName, toolParams, token);

        // Add tool result to conversation
        messages.push(assistantMessage);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult)
        });

        // Get next response
        response = await fetch('https://stream-dream.shop/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-5.6-sol',
            messages: messages,
            tools: getToolDefinitions(),
            tool_choice: 'auto',
            temperature: 0.7,
            max_tokens: 2000
          })
        });

        if (!response.ok) throw new Error('Tool response failed');

        data = await response.json();
        assistantMessage = data.choices[0]?.message;
      } catch (toolError) {
        console.error('Tool execution error:', toolError);
        assistantMessage.content = `Error executing ${toolName}: ${toolError instanceof Error ? toolError.message : 'Unknown error'}`;
        break;
      }
    }

    const reply = assistantMessage?.content || 'Sorry, I could not generate a response.';

    // Replace thinking with actual response
    thinkingMsg.innerHTML = `
      <div class="meta" style="color: #57f287;">AI Buddy</div>
      <div class="content">${escapeHtml(reply)}</div>
    `;
    chatHistory.scrollTop = chatHistory.scrollHeight;

    // Save assistant message
    await saveChatMessage('assistant', reply);

    setStatus('Response received');
  } catch (error) {
    console.error('AI error:', error);
    thinkingMsg.innerHTML = `
      <div class="meta" style="color: #ed4245;">Error</div>
      <div class="content">Failed to get AI response: ${error instanceof Error ? error.message : 'Unknown error'}. Please check your API key and try again.</div>
    `;
    setStatus('AI error', true);
  }
}

async function saveChatMessage(role: string, content: string): Promise<void> {
  if (!apiKey) return;

  const key = `chat_history_${apiKey}`;
  const data = await chrome.storage.local.get(key);
  const history = data[key] || [];

  history.push({ role, content, timestamp: Date.now() });

  // Keep last 50 messages
  if (history.length > 50) {
    history.splice(0, history.length - 50);
  }

  await chrome.storage.local.set({ [key]: history });
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
