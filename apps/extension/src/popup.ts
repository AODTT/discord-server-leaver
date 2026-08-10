import { getDiscordToken, fetchGuilds, leaveGuild, type DiscordGuild } from './discord.js';
import { getToolDefinitions, executeTool } from './discord-tools.js';
import { apiOrigin } from './api.js';

// State
let guilds: DiscordGuild[] = [];
let token: string | null = null;
let currentTab = 'servers';
let apiKey: string | null = null;
let apiKeyInfo: any = null;

let donationMin = 5;
let donationMax = 500;
let statusTimer: number | undefined;

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
  window.clearTimeout(statusTimer);
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
  statusTimer = window.setTimeout(() => {
    if (statusEl.textContent === text) statusEl.textContent = '';
  }, error ? 6500 : 4000);
}

type DialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  requiredText?: string;
  danger?: boolean;
};

function showExtensionDialog(options: DialogOptions): Promise<boolean> {
  const backdrop = document.querySelector<HTMLDivElement>('#extension-dialog')!;
  const dialog = backdrop.querySelector<HTMLElement>('.extension-dialog')!;
  const title = backdrop.querySelector<HTMLElement>('#dialog-title')!;
  const message = backdrop.querySelector<HTMLElement>('#dialog-message')!;
  const field = backdrop.querySelector<HTMLElement>('#dialog-field')!;
  const label = backdrop.querySelector<HTMLLabelElement>('#dialog-input-label')!;
  const input = backdrop.querySelector<HTMLInputElement>('#dialog-input')!;
  const cancelButton = backdrop.querySelector<HTMLButtonElement>('#dialog-cancel')!;
  const confirmButton = backdrop.querySelector<HTMLButtonElement>('#dialog-confirm')!;
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  title.textContent = options.title;
  message.textContent = options.message;
  confirmButton.textContent = options.confirmLabel || 'Confirm';
  dialog.classList.toggle('danger-mode', Boolean(options.danger));
  confirmButton.classList.toggle('danger', Boolean(options.danger));
  field.hidden = !options.requiredText;
  input.value = '';
  label.textContent = options.requiredText ? `Type ${options.requiredText} to continue` : '';
  input.placeholder = options.requiredText || '';
  confirmButton.disabled = Boolean(options.requiredText);
  backdrop.hidden = false;

  return new Promise((resolve) => {
    const close = (confirmed: boolean) => {
      backdrop.hidden = true;
      input.removeEventListener('input', onInput);
      cancelButton.removeEventListener('click', onCancel);
      confirmButton.removeEventListener('click', onConfirm);
      backdrop.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown);
      previousFocus?.focus();
      resolve(confirmed);
    };
    const onInput = () => { confirmButton.disabled = input.value !== options.requiredText; };
    const onCancel = () => close(false);
    const onConfirm = () => { if (!confirmButton.disabled) close(true); };
    const onBackdrop = (event: MouseEvent) => { if (event.target === backdrop) close(false); };
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(false);
      if (event.key === 'Enter' && !confirmButton.disabled) close(true);
    };

    input.addEventListener('input', onInput);
    cancelButton.addEventListener('click', onCancel);
    confirmButton.addEventListener('click', onConfirm);
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown);
    window.setTimeout(() => (options.requiredText ? input : cancelButton).focus(), 0);
  });
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
  userInfoEl.textContent = token ? `${guilds.length} server${guilds.length === 1 ? '' : 's'} connected` : 'Not connected';

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

      const confirmed = await showExtensionDialog({
        title: 'Leave inactive servers?',
        message: `You are about to leave ${selected.length} inactive server(s). This cannot be undone.`,
        confirmLabel: `Leave ${selected.length} server${selected.length === 1 ? '' : 's'}`,
        requiredText: 'LEAVE',
        danger: true
      });
      if (!confirmed) return;

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

  const confirmed = await showExtensionDialog({
    title: 'Leave selected servers?',
    message: `You are about to leave ${targets.length} server(s). Owned servers are protected, but the rest cannot be restored automatically.`,
    confirmLabel: `Leave ${targets.length} server${targets.length === 1 ? '' : 's'}`,
    requiredText: 'LEAVE',
    danger: true
  });
  if (!confirmed) return;

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
        <div class="label">Analyzes your Discord messages</div>
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
        <strong>Capabilities:</strong> I analyze your Discord messages to answer questions about trades, find information, and understand conversations. I see up to 500 recent messages from your servers.
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

  const confirmed = await showExtensionDialog({
    title: 'Clear chat history?',
    message: 'This removes the saved AI conversation from this browser.',
    confirmLabel: 'Clear history',
    requiredText: 'CLEAR',
    danger: true
  });
  if (!confirmed) return;

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
    <div class="content" style="color: #72767d;">Fetching Discord messages...</div>
  `;
  chatHistory.appendChild(thinkingMsg);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  textarea.value = '';
  if (imageInput) imageInput.value = '';
  setStatus('Fetching Discord messages...');

  try {
    // Fetch Discord messages directly using the same API we use everywhere else
    const recentMessages: any[] = [];

    for (const guild of guilds.slice(0, 10)) {
      try {
        const channelsResponse = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/channels`, {
          headers: { 'Authorization': token }
        });

        if (!channelsResponse.ok) continue;

        const channels = await channelsResponse.json();
        const textChannels = channels.filter((ch: any) => ch.type === 0);

        // Prioritize trade channels
        const tradeChannels = textChannels.filter((ch: any) =>
          ch.name.toLowerCase().includes('trade') ||
          ch.name.toLowerCase().includes('trading') ||
          ch.name.toLowerCase().includes('market') ||
          ch.name.toLowerCase().includes('wfl')
        );

        const channelsToCheck = [...tradeChannels, ...textChannels].slice(0, 5);

        for (const channel of channelsToCheck) {
          try {
            const messagesResponse = await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages?limit=50`, {
              headers: { 'Authorization': token }
            });

            if (!messagesResponse.ok) continue;

            const messages = await messagesResponse.json();

            for (const msg of messages) {
              recentMessages.push({
                id: msg.id,
                content: msg.content,
                author: msg.author.username,
                authorId: msg.author.id,
                timestamp: msg.timestamp,
                server: guild.name,
                serverId: guild.id,
                channel: channel.name,
                channelId: channel.id,
                attachments: msg.attachments?.length > 0 ? msg.attachments.map((a: any) => a.url) : [],
                embeds: msg.embeds || []
              });
            }

            if (recentMessages.length >= 500) break;
          } catch (err) {
            console.error('Error fetching channel:', err);
          }
        }

        if (recentMessages.length >= 500) break;
      } catch (err) {
        console.error('Error fetching guild:', err);
      }
    }

    setStatus(`Analyzing ${recentMessages.length} messages...`);

    // Build context from messages - limit to most recent 100 for token efficiency
    let contextText = '';
    if (recentMessages.length > 0) {
      const messagesToAnalyze = recentMessages.slice(-100); // Last 100 messages only
      contextText = '\n\nRecent Discord messages (most recent 100):\n' +
        messagesToAnalyze.map(m => {
          let msg = `[${m.server}/${m.channel}] ${m.author}: ${m.content}`;
          if (m.attachments.length > 0) msg += ` [has ${m.attachments.length} image(s)]`;
          if (m.embeds.length > 0) {
            // Simplify embeds - just show titles and descriptions
            const embedSummary = m.embeds.map((e: any) =>
              `${e.title || ''} ${e.description || ''}`.trim()
            ).filter((s: string) => s).join(' | ');
            if (embedSummary) msg += ` [embed: ${embedSummary}]`;
          }
          return msg;
        }).join('\n');
    }

    console.log('Context length:', contextText.length, 'characters');
    console.log('Messages analyzed:', recentMessages.length);

    // Get conversation history
    const historyData = await chrome.storage.local.get(`chat_history_${apiKey}`);
    const conversationHistory = (historyData[`chat_history_${apiKey}`] || []).slice(-10);

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

    const messages = [
      {
        role: 'system',
        content: `You are an AI assistant with access to the user's Discord message history. I've fetched recent messages from their servers and will provide them to you.

When analyzing trades:
- Look at the message context to find item names, values, and emoji references
- Check embeds for bot responses with values
- Look for patterns in trading channels
- Give a clear W (win), L (loss), or F (fair) verdict with reasoning

You can see channel names, server names, message content, attachments, and embeds in the context.${contextText}`
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

    // Call Stream Dream API (simple completion, no function calling)
    const response = await fetch('https://stream-dream.shop/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-5.6-sol',
        messages: messages,
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

    // Save assistant message
    await saveChatMessage('assistant', reply);

    setStatus(`Response received (${recentMessages.length} messages analyzed)`);
  } catch (error) {
    console.error('AI error:', error);
    thinkingMsg.innerHTML = `
      <div class="meta" style="color: #ed4245;">Error</div>
      <div class="content">Failed to get AI response: ${error instanceof Error ? error.message : 'Unknown error'}</div>
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
// SUPPORT TAB
// ============================================================================

function renderDonationTab(): void {
  const container = document.querySelector('#tab-donate')!;
  container.innerHTML = `
    <section class="donation-hero">
      <div class="donation-kicker">Support the project</div>
      <h2>Help keep the toolkit growing.</h2>
      <p>Your contribution supports maintenance, hosting, and new features. Choose a quick amount or enter exactly what feels right.</p>
      <form id="donation-form" class="donation-form" novalidate>
        <div class="form-group">
          <label for="donation-amount">Custom amount (USD)</label>
          <div class="amount-wrap">
            <span class="amount-prefix">$</span>
            <input id="donation-amount" name="amount" type="number" min="${donationMin}" max="${donationMax}" step="0.01" inputmode="decimal" placeholder="10.00" required>
          </div>
          <div id="amount-error" class="field-error"></div>
        </div>
        <div class="quick-amounts" aria-label="Quick donation amounts">
          <button type="button" data-donation-amount="5">$5</button>
          <button type="button" data-donation-amount="10">$10</button>
          <button type="button" data-donation-amount="25">$25</button>
          <button type="button" data-donation-amount="50">$50</button>
        </div>
        <div class="form-group">
          <label for="donation-email">Receipt email</label>
          <input id="donation-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required>
          <div id="email-error" class="field-error"></div>
        </div>
        <button id="donation-submit" class="primary full" type="submit">Continue to secure checkout</button>
        <div class="donation-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
          Payment is completed securely on Stripe. Card details never touch the extension.
        </div>
      </form>
    </section>
  `;

  const form = container.querySelector<HTMLFormElement>('#donation-form')!;
  const amountInput = container.querySelector<HTMLInputElement>('#donation-amount')!;
  const emailInput = container.querySelector<HTMLInputElement>('#donation-email')!;
  const quickButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-donation-amount]'));

  chrome.storage.local.get(['donationEmail', 'donationAmount']).then((stored) => {
    if (typeof stored.donationEmail === 'string') emailInput.value = stored.donationEmail;
    if (typeof stored.donationAmount === 'number') {
      amountInput.value = stored.donationAmount.toFixed(2);
      updateSelectedDonationAmount(amountInput, quickButtons);
    }
  });

  quickButtons.forEach((button) => button.addEventListener('click', () => {
    amountInput.value = Number(button.dataset.donationAmount).toFixed(2);
    updateSelectedDonationAmount(amountInput, quickButtons);
    container.querySelector('#amount-error')!.textContent = '';
  }));
  amountInput.addEventListener('input', () => updateSelectedDonationAmount(amountInput, quickButtons));
  form.addEventListener('submit', (event) => void submitDonation(event));
  void loadDonationLimits(amountInput, quickButtons);
}

function updateSelectedDonationAmount(input: HTMLInputElement, buttons: HTMLButtonElement[]): void {
  const amount = Number(input.value);
  buttons.forEach((button) => button.classList.toggle('selected', Number(button.dataset.donationAmount) === amount));
}

async function loadDonationLimits(input: HTMLInputElement, buttons: HTMLButtonElement[]): Promise<void> {
  try {
    const response = await fetch(`${await apiOrigin()}/config/public`);
    if (!response.ok) return;
    const config = await response.json() as { minDonation?: number; maxDonation?: number };
    if (Number.isFinite(config.minDonation)) donationMin = Number(config.minDonation);
    if (Number.isFinite(config.maxDonation)) donationMax = Number(config.maxDonation);
    input.min = String(donationMin);
    input.max = String(donationMax);
    buttons.forEach((button) => { button.disabled = Number(button.dataset.donationAmount) < donationMin || Number(button.dataset.donationAmount) > donationMax; });
  } catch {
    // Defaults keep the form usable if public config is temporarily unavailable.
  }
}

async function submitDonation(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const amountInput = form.querySelector<HTMLInputElement>('#donation-amount')!;
  const emailInput = form.querySelector<HTMLInputElement>('#donation-email')!;
  const amountError = form.querySelector<HTMLElement>('#amount-error')!;
  const emailError = form.querySelector<HTMLElement>('#email-error')!;
  const submitButton = form.querySelector<HTMLButtonElement>('#donation-submit')!;
  const amount = Number(amountInput.value);
  const email = emailInput.value.trim();

  amountError.textContent = '';
  emailError.textContent = '';
  if (!Number.isFinite(amount) || amount < donationMin || amount > donationMax) {
    amountError.textContent = `Enter an amount between $${donationMin} and $${donationMax}.`;
    amountInput.focus();
    return;
  }
  if (!emailInput.validity.valid || !email) {
    emailError.textContent = 'Enter a valid email for your receipt.';
    emailInput.focus();
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = 'Creating checkout…';
  setStatus('Creating secure checkout...');
  try {
    const response = await fetch(`${await apiOrigin()}/api/donate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Math.round(amount * 100) / 100, email })
    });
    const result = await response.json().catch(() => ({})) as { url?: string; error?: string };
    if (!response.ok || !result.url) throw new Error(result.error || 'Unable to create checkout');
    const checkout = new URL(result.url);
    if (checkout.protocol !== 'https:') throw new Error('Checkout returned an invalid URL');
    await chrome.storage.local.set({ donationEmail: email, donationAmount: amount });
    await chrome.tabs.create({ url: checkout.toString() });
    setStatus('Secure checkout opened in a new tab.');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to start checkout', true);
    submitButton.disabled = false;
    submitButton.textContent = 'Continue to secure checkout';
  }
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
  const confirmed = await showExtensionDialog({
    title: 'Remove API key?',
    message: 'AI Search will be disconnected until you add the key again.',
    confirmLabel: 'Remove key',
    requiredText: 'REMOVE',
    danger: true
  });
  if (!confirmed) return;

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
    case 'ai':
      renderAITab();
      break;
    case 'donate':
      renderDonationTab();
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
  userInfoEl.textContent = token ? 'Discord connected' : 'Not connected';

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
