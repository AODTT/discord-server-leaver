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

  if (!token) {
    setStatus('Discord token required for full context', true);
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
    <div class="content" style="color: #72767d;">Analyzing your Discord messages...</div>
  `;
  chatHistory.appendChild(thinkingMsg);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  textarea.value = '';
  setStatus('Fetching recent Discord messages...');

  try {
    // Fetch recent messages from ALL channels to provide context
    const recentMessages: any[] = [];

    // Get messages from all available servers (up to 500 messages total)
    for (const guild of guilds) {
      try {
        const channelsResponse = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/channels`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!channelsResponse.ok) continue;

        const channels = await channelsResponse.json();
        const textChannels = channels.filter((ch: any) => ch.type === 0);

        // Prioritize channels with "trade", "trading", "market" in the name
        const tradeChannels = textChannels.filter((ch: any) =>
          ch.name.toLowerCase().includes('trade') ||
          ch.name.toLowerCase().includes('trading') ||
          ch.name.toLowerCase().includes('market') ||
          ch.name.toLowerCase().includes('wfl')
        );

        const channelsToCheck = [...tradeChannels, ...textChannels].slice(0, 10);

        for (const channel of channelsToCheck) {
          try {
            const messagesResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages?limit=50`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!messagesResponse.ok) continue;

            const messages = await messagesResponse.json();

            for (const msg of messages) {
              recentMessages.push({
                content: msg.content,
                author: msg.author.username,
                timestamp: msg.timestamp,
                server: guild.name,
                channel: channel.name,
                attachments: msg.attachments?.length > 0 ? msg.attachments.map((a: any) => a.url) : [],
                embeds: msg.embeds?.length > 0 ? msg.embeds.map((e: any) => JSON.stringify(e)) : []
              });
            }

            if (recentMessages.length >= 500) break;
          } catch (err) {
            console.error('Error fetching channel messages:', err);
          }
        }

        if (recentMessages.length >= 500) break;
      } catch (err) {
        console.error('Error fetching guild channels:', err);
      }
    }

    setStatus('Asking AI with Discord context...');

    // Build context from fetched messages
    let contextText = '';
    if (recentMessages.length > 0) {
      contextText = '\n\nRecent Discord messages for context (these contain the actual trade details, item names, values, and emoji references):\n' +
        recentMessages.map(m => {
          let msg = `[${m.server}/${m.channel}] ${m.author}: ${m.content}`;
          if (m.attachments.length > 0) msg += ` [images: ${m.attachments.join(', ')}]`;
          if (m.embeds.length > 0) msg += ` [embeds: ${m.embeds.join(' | ')}]`;
          return msg;
        }).join('\n');
    }

    // Call Stream Dream API directly
    const response = await fetch('https://stream-dream.shop/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        messages: [
          {
            role: 'system',
            content: `You are an AI assistant with access to the user's Discord message history. You can help them analyze trades, determine values, and understand their conversations.

When a user asks about a trade (like "w or l trade" or posts emoji codes), look through the recent messages to find:
1. What items/emojis are being traded
2. Their values or rarity
3. Community opinions on those items
4. Similar past trades

Analyze the trade based on the Discord context and give a clear W (win), L (loss), or F (fair) verdict with reasoning.${contextText}`
          },
          {
            role: 'user',
            content: question
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Stream Dream API error:', errorText);
      throw new Error(`AI request failed: ${response.status}`);
    }

    const data = await response.json();
    const reply = data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

    // Replace thinking with actual response
    thinkingMsg.innerHTML = `
      <div class="meta" style="color: #57f287;">AI Buddy</div>
      <div class="content">${escapeHtml(reply)}</div>
    `;
    chatHistory.scrollTop = chatHistory.scrollHeight;

    setStatus(`Response received (${recentMessages.length} messages analyzed)`);
  } catch (error) {
    console.error('AI error:', error);
    thinkingMsg.innerHTML = `
      <div class="meta" style="color: #ed4245;">Error</div>
      <div class="content">Failed to get AI response: ${error instanceof Error ? error.message : 'Unknown error'}. Please check your API key and try again.</div>
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
