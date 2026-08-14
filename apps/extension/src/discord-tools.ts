// Discord API tools for AI function calling

export interface DiscordTool {
  name: string;
  description: string;
  parameters: any;
  execute: (params: any, token: string) => Promise<any>;
}

export const discordTools: DiscordTool[] = [
  {
    name: 'fetch_messages',
    description: 'Fetch messages from a specific Discord channel. Returns up to 100 messages.',
    parameters: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'The Discord channel ID to fetch messages from'
        },
        limit: {
          type: 'number',
          description: 'Number of messages to fetch (1-100)',
          default: 50
        },
        before: {
          type: 'string',
          description: 'Get messages before this message ID (for pagination)'
        }
      },
      required: ['channel_id']
    },
    execute: async (params, token) => {
      const url = `https://discord.com/api/v10/channels/${params.channel_id}/messages?limit=${params.limit || 50}${params.before ? `&before=${params.before}` : ''}`;
      const response = await fetch(url, {
        headers: { 'Authorization': token }
      });
      if (!response.ok) throw new Error(`Failed to fetch messages: ${response.status}`);
      return await response.json();
    }
  },
  {
    name: 'send_message',
    description: 'Send a message to a Discord channel',
    parameters: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'The Discord channel ID to send the message to'
        },
        content: {
          type: 'string',
          description: 'The message content to send'
        }
      },
      required: ['channel_id', 'content']
    },
    execute: async (params, token) => {
      // Try multiple methods to bypass captcha
      const methods = [
        // Method 1: Standard POST with additional headers to look more like a browser
        async () => {
          const response = await fetch(`https://discord.com/api/v10/channels/${params.channel_id}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': token,
              'Content-Type': 'application/json',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'X-Super-Properties': btoa(JSON.stringify({
                os: 'Windows',
                browser: 'Chrome',
                device: '',
                system_locale: 'en-US',
                browser_user_agent: navigator.userAgent,
                browser_version: '120.0.0.0',
                os_version: '10',
                referrer: '',
                referring_domain: '',
                referrer_current: '',
                referring_domain_current: '',
                release_channel: 'stable',
                client_build_number: 999999,
                client_event_source: null
              })),
              'X-Discord-Locale': 'en-US',
              'X-Debug-Options': 'bugReporterEnabled',
              'Origin': 'https://discord.com',
              'Referer': `https://discord.com/channels/@me/${params.channel_id}`
            },
            body: JSON.stringify({
              content: params.content,
              nonce: String(Date.now() * 4194304),
              tts: false,
              flags: 0
            })
          });
          return response;
        },

        // Method 2: Use typing indicator first to appear more human
        async () => {
          // Send typing indicator
          await fetch(`https://discord.com/api/v10/channels/${params.channel_id}/typing`, {
            method: 'POST',
            headers: { 'Authorization': token }
          });

          // Wait a bit
          await new Promise(resolve => setTimeout(resolve, 500));

          // Then send message
          const response = await fetch(`https://discord.com/api/v10/channels/${params.channel_id}/messages`, {
            method: 'POST',
            headers: {
              'Authorization': token,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              content: params.content,
              nonce: String(Date.now() * 4194304)
            })
          });
          return response;
        }
      ];

      let lastError = null;

      // Try each method
      for (const method of methods) {
        try {
          const response = await method();

          if (response.ok) {
            return await response.json();
          }

          const errorBody = await response.text();
          console.error(`Discord send_message error (${response.status}):`, errorBody);
          lastError = `${response.status} - ${errorBody}`;

          // If not captcha, try next method
          if (!errorBody.includes('captcha')) {
            continue;
          }
        } catch (err) {
          console.error('Send method failed:', err);
          lastError = err instanceof Error ? err.message : 'Unknown error';
        }
      }

      throw new Error(`Failed to send message after trying all methods: ${lastError}`);
    }
  },
  {
    name: 'get_guilds',
    description: 'Get list of all Discord servers (guilds) the user is in',
    parameters: {
      type: 'object',
      properties: {}
    },
    execute: async (params, token) => {
      const response = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { 'Authorization': token }
      });
      if (!response.ok) throw new Error(`Failed to fetch guilds: ${response.status}`);
      return await response.json();
    }
  },
  {
    name: 'get_channels',
    description: 'Get all channels in a Discord server',
    parameters: {
      type: 'object',
      properties: {
        guild_id: {
          type: 'string',
          description: 'The Discord server (guild) ID'
        }
      },
      required: ['guild_id']
    },
    execute: async (params, token) => {
      const response = await fetch(`https://discord.com/api/v10/guilds/${params.guild_id}/channels`, {
        headers: { 'Authorization': token }
      });
      if (!response.ok) throw new Error(`Failed to fetch channels: ${response.status}`);
      return await response.json();
    }
  },
  {
    name: 'search_messages',
    description: 'Search for messages in a guild or channel',
    parameters: {
      type: 'object',
      properties: {
        guild_id: {
          type: 'string',
          description: 'The Discord server (guild) ID to search in'
        },
        content: {
          type: 'string',
          description: 'The text to search for'
        },
        author_id: {
          type: 'string',
          description: 'Filter by author user ID'
        },
        channel_id: {
          type: 'string',
          description: 'Filter by specific channel ID'
        }
      },
      required: ['guild_id', 'content']
    },
    execute: async (params, token) => {
      const searchParams = new URLSearchParams({
        content: params.content
      });
      if (params.author_id) searchParams.set('author_id', params.author_id);
      if (params.channel_id) searchParams.set('channel_id', params.channel_id);

      const response = await fetch(`https://discord.com/api/v10/guilds/${params.guild_id}/messages/search?${searchParams}`, {
        headers: { 'Authorization': token }
      });
      if (!response.ok) throw new Error(`Failed to search messages: ${response.status}`);
      return await response.json();
    }
  },
  {
    name: 'get_user_by_username',
    description: 'Search for a Discord user by username or display name across all servers. Returns user ID which can be used with create_dm.',
    parameters: {
      type: 'object',
      properties: {
        username: {
          type: 'string',
          description: 'The username or display name to search for (without @ symbol)'
        }
      },
      required: ['username']
    },
    execute: async (params, token) => {
      // Get all guilds first
      const guildsResponse = await fetch('https://discord.com/api/v10/users/@me/guilds', {
        headers: { 'Authorization': token }
      });
      if (!guildsResponse.ok) throw new Error(`Failed to fetch guilds: ${guildsResponse.status}`);
      const guilds = await guildsResponse.json();

      const searchName = params.username.toLowerCase().replace('@', '');

      // Search through guilds for the user
      for (const guild of guilds) {
        try {
          // Method 1: Try member search endpoint
          const searchResponse = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/members/search?query=${encodeURIComponent(searchName)}&limit=10`, {
            headers: { 'Authorization': token }
          });

          if (searchResponse.ok) {
            const members = await searchResponse.json();
            const match = members.find((m: any) =>
              m.user.username.toLowerCase() === searchName ||
              m.user.global_name?.toLowerCase() === searchName ||
              m.nick?.toLowerCase() === searchName
            );

            if (match) {
              return {
                id: match.user.id,
                username: match.user.username,
                global_name: match.user.global_name,
                discriminator: match.user.discriminator,
                avatar: match.user.avatar,
                found_in_guild: guild.name,
                guild_id: guild.id
              };
            }
          }

          // Method 2: Try listing members (for smaller servers)
          const listResponse = await fetch(`https://discord.com/api/v10/guilds/${guild.id}/members?limit=1000`, {
            headers: { 'Authorization': token }
          });

          if (listResponse.ok) {
            const members = await listResponse.json();
            const match = members.find((m: any) =>
              m.user.username.toLowerCase() === searchName ||
              m.user.global_name?.toLowerCase() === searchName ||
              m.nick?.toLowerCase() === searchName
            );

            if (match) {
              return {
                id: match.user.id,
                username: match.user.username,
                global_name: match.user.global_name,
                discriminator: match.user.discriminator,
                avatar: match.user.avatar,
                found_in_guild: guild.name,
                guild_id: guild.id
              };
            }
          }
        } catch (err) {
          // Continue searching other guilds
          continue;
        }
      }

      throw new Error(`User "${params.username}" not found in any mutual servers. Try using their exact Discord username.`);
    }
  },
  {
    name: 'get_user',
    description: 'Get information about a Discord user by their user ID',
    parameters: {
      type: 'object',
      properties: {
        user_id: {
          type: 'string',
          description: 'The Discord user ID'
        }
      },
      required: ['user_id']
    },
    execute: async (params, token) => {
      const response = await fetch(`https://discord.com/api/v10/users/${params.user_id}`, {
        headers: { 'Authorization': token }
      });
      if (!response.ok) throw new Error(`Failed to fetch user: ${response.status}`);
      return await response.json();
    }
  },
  {
    name: 'add_reaction',
    description: 'Add a reaction emoji to a message',
    parameters: {
      type: 'object',
      properties: {
        channel_id: {
          type: 'string',
          description: 'The channel ID containing the message'
        },
        message_id: {
          type: 'string',
          description: 'The message ID to react to'
        },
        emoji: {
          type: 'string',
          description: 'The emoji to react with (e.g., "👍" or custom emoji "name:id")'
        }
      },
      required: ['channel_id', 'message_id', 'emoji']
    },
    execute: async (params, token) => {
      const emoji = encodeURIComponent(params.emoji);
      const response = await fetch(`https://discord.com/api/v10/channels/${params.channel_id}/messages/${params.message_id}/reactions/${emoji}/@me`, {
        method: 'PUT',
        headers: { 'Authorization': token }
      });
      if (!response.ok) throw new Error(`Failed to add reaction: ${response.status}`);
      return { success: true };
    }
  },
  {
    name: 'create_dm',
    description: 'Create or open a DM channel with a user',
    parameters: {
      type: 'object',
      properties: {
        recipient_id: {
          type: 'string',
          description: 'The user ID to DM'
        }
      },
      required: ['recipient_id']
    },
    execute: async (params, token) => {
      const response = await fetch('https://discord.com/api/v10/users/@me/channels', {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ recipient_id: params.recipient_id })
      });
      if (!response.ok) throw new Error(`Failed to create DM: ${response.status}`);
      return await response.json();
    }
  }
];

export function getToolDefinitions() {
  return discordTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}

export async function executeTool(toolName: string, params: any, token: string) {
  const tool = discordTools.find(t => t.name === toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  return await tool.execute(params, token);
}
