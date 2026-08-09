// Background service worker for Discord Server Leaver

let isFetching = false;
let fetchProgress = { progress: 0, total: 0, running: false };

chrome.runtime.onInstalled.addListener(() => {
  console.log('Discord Server Leaver installed');
});

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getToken') {
    // Token extraction happens in content script, not here
    sendResponse({ success: true });
  } else if (message.type === 'START_HISTORY_FETCH') {
    startHistoryFetch(message.token, message.guilds);
    sendResponse({ success: true });
  }
  return true;
});

async function startHistoryFetch(token: string, guilds: any[]) {
  if (isFetching) {
    console.log('History fetch already in progress');
    return;
  }

  isFetching = true;
  fetchProgress = { progress: 0, total: 0, running: true };
  await chrome.storage.local.set({ historyFetchStatus: fetchProgress });

  console.log('Starting Discord history fetch for', guilds.length, 'servers');

  try {
    const allMessages: any[] = [];

    for (const guild of guilds) {
      console.log(`Fetching channels for ${guild.name}...`);

      // Get channels for this guild
      const channelsResponse = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/channels`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!channelsResponse.ok) {
        console.error(`Failed to fetch channels for ${guild.name}`);
        continue;
      }

      const channels = await channelsResponse.json();
      const textChannels = channels.filter((ch: any) => ch.type === 0); // Text channels only

      fetchProgress.total += textChannels.length;
      await chrome.storage.local.set({ historyFetchStatus: fetchProgress });

      for (const channel of textChannels) {
        console.log(`Fetching messages from ${guild.name}/#${channel.name}...`);

        try {
          let lastMessageId: string | undefined;
          let messageCount = 0;
          const maxMessagesPerChannel = 500; // Limit per channel to avoid rate limits

          while (messageCount < maxMessagesPerChannel) {
            const messagesUrl = `https://discord.com/api/v10/channels/${channel.id}/messages?limit=100${lastMessageId ? `&before=${lastMessageId}` : ''}`;

            const messagesResponse = await fetch(messagesUrl, {
              headers: { 'Authorization': `Bearer ${token}` }
            });

            if (!messagesResponse.ok) {
              console.error(`Failed to fetch messages from ${channel.name}`);
              break;
            }

            const messages = await messagesResponse.json();

            if (messages.length === 0) break;

            // Store messages with metadata
            for (const msg of messages) {
              allMessages.push({
                id: msg.id,
                content: msg.content,
                author: msg.author.username,
                authorId: msg.author.id,
                timestamp: msg.timestamp,
                server: guild.name,
                serverId: guild.id,
                channel: channel.name,
                channelId: channel.id
              });
            }

            messageCount += messages.length;
            lastMessageId = messages[messages.length - 1].id;

            // Rate limit: wait 500ms between requests
            await new Promise(resolve => setTimeout(resolve, 500));

            if (messages.length < 100) break; // No more messages
          }

          console.log(`Fetched ${messageCount} messages from ${channel.name}`);
        } catch (error) {
          console.error(`Error fetching messages from ${channel.name}:`, error);
        }

        fetchProgress.progress++;
        await chrome.storage.local.set({ historyFetchStatus: fetchProgress });
      }

      // Save messages periodically
      const existingData = await chrome.storage.local.get('discordHistory');
      const existingMessages = existingData.discordHistory || [];
      const combinedMessages = [...existingMessages, ...allMessages];

      // Deduplicate by message ID
      const uniqueMessages = Array.from(
        new Map(combinedMessages.map(m => [m.id, m])).values()
      );

      await chrome.storage.local.set({ discordHistory: uniqueMessages });
      allMessages.length = 0; // Clear temp array

      // Wait 2 seconds between guilds to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('History fetch complete!');
    fetchProgress.running = false;
    await chrome.storage.local.set({ historyFetchStatus: fetchProgress });

  } catch (error) {
    console.error('Error during history fetch:', error);
    fetchProgress.running = false;
    await chrome.storage.local.set({ historyFetchStatus: fetchProgress });
  } finally {
    isFetching = false;
  }
}

// Check for ongoing fetches on startup
chrome.runtime.onStartup.addListener(async () => {
  const status = await chrome.storage.local.get('historyFetchStatus');
  if (status.historyFetchStatus?.running) {
    console.log('History fetch was running, but we need token and guilds to resume');
    // Reset the status since we can't resume without token
    await chrome.storage.local.set({ historyFetchStatus: { running: false, progress: 0, total: 0 } });
  }
});
