// Direct Discord API interactions using the user's browser session

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

export interface DiscordMessage {
  id: string;
  content: string;
  timestamp: string;
  channel_id: string;
  guild_id?: string;
}

const DISCORD_API = 'https://discord.com/api/v10';

// Get Discord token from browser cookies/localStorage
export async function getDiscordToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: '*://discord.com/*' }, (tabs) => {
      if (!tabs.length) {
        resolve(null);
        return;
      }

      const tab = tabs[0];
      if (!tab || !tab.id) {
        resolve(null);
        return;
      }

      const tabId = tab.id;

      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: () => {
            // Extract token from localStorage or webpack
            try {
              // Try webpack method
              const win = window as any;
              if (win.webpackChunkdiscord_app) {
                const token = win.webpackChunkdiscord_app.push([
                  [''],
                  {},
                  (e: any) => {
                    for (const m in e.c) {
                      if (e.c.hasOwnProperty(m)) {
                        const mod = e.c[m]?.exports;
                        if (mod?.default?.getToken) {
                          return mod.default.getToken();
                        }
                      }
                    }
                  }
                ]);
                if (token) return token.replace(/"/g, '');
              }

              // Fallback to localStorage
              const stored = localStorage.getItem('token');
              return stored ? stored.replace(/"/g, '') : null;
            } catch {
              return null;
            }
          },
        },
        (results) => {
          resolve(results?.[0]?.result || null);
        }
      );
    });
  });
}

// Fetch user's guilds
export async function fetchGuilds(token: string): Promise<DiscordGuild[]> {
  const response = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: {
      Authorization: token,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch guilds: ${response.status}`);
  }

  return response.json();
}

// Leave a guild
export async function leaveGuild(token: string, guildId: string): Promise<void> {
  const response = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}`, {
    method: 'DELETE',
    headers: {
      Authorization: token,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to leave guild: ${response.status}`);
  }
}

// Fetch channels in a guild
export async function fetchGuildChannels(token: string, guildId: string): Promise<DiscordChannel[]> {
  const response = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: {
      Authorization: token,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch channels: ${response.status}`);
  }

  return response.json();
}

// Search messages (requires proper permissions and is rate-limited)
export async function searchMessages(
  token: string,
  guildId: string,
  query: string,
  limit = 25
): Promise<DiscordMessage[]> {
  const params = new URLSearchParams({
    content: query,
    limit: String(limit),
  });

  const response = await fetch(
    `${DISCORD_API}/guilds/${guildId}/messages/search?${params}`,
    {
      headers: {
        Authorization: token,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to search messages: ${response.status}`);
  }

  const data = await response.json();
  return data.messages?.flat() || [];
}
