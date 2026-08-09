import OpenAI from 'openai';
import { config } from './config.js';
import { collections } from './db.js';

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY,
});

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type DiscordContext = {
  messages: Array<{
    content: string;
    author: string;
    timestamp: Date;
    channel: string;
    server: string;
  }>;
  servers: string[];
  channels: string[];
};

export async function chatWithHistory(
  userId: string,
  userMessage: string,
  discordContext?: DiscordContext
): Promise<string> {
  const c = await collections();

  // Build context from user's Discord history
  let contextMessages = '';
  if (discordContext && discordContext.messages.length > 0) {
    contextMessages = '\n\nRecent Discord context:\n' +
      discordContext.messages.map(m =>
        `[${m.server}/#${m.channel}] ${m.author}: ${m.content}`
      ).join('\n');
  }

  // Get conversation history from MongoDB
  const conversationHistory: ChatMessage[] = [];
  if (c) {
    const history = await c.aiConversations
      .find({ userId })
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    conversationHistory.push(...history.map((h: any) => ({
      role: h.role,
      content: h.content,
    })));
  }

  const systemPrompt = `You are an AI assistant with access to the user's Discord history.
You can help them search messages, analyze conversations, do calculations, find information, and more.
When referencing Discord data, be specific about servers, channels, and users.
${contextMessages}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.reverse(),
    { role: 'user', content: userMessage },
  ];

  const response = await openai.chat.completions.create({
    model: config.OPENAI_CHAT_MODEL,
    messages,
    temperature: 0.7,
    max_tokens: 1000,
  });

  const assistantMessage = response.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

  // Save conversation to MongoDB
  if (c) {
    await c.aiConversations.insertMany([
      {
        userId,
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      },
      {
        userId,
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date(),
      },
    ]);
  }

  return assistantMessage;
}

export async function searchDiscordMessages(
  userId: string,
  query: string,
  filters?: {
    serverId?: string;
    channelId?: string;
    authorId?: string;
    fromDate?: Date;
    toDate?: Date;
  }
): Promise<any[]> {
  const c = await collections();
  if (!c) return [];

  const searchQuery: any = {
    ownerUserId: userId,
    $text: { $search: query },
  };

  if (filters?.serverId) searchQuery.guildId = filters.serverId;
  if (filters?.channelId) searchQuery.channelId = filters.channelId;
  if (filters?.authorId) searchQuery.authorId = filters.authorId;
  if (filters?.fromDate || filters?.toDate) {
    searchQuery.timestamp = {};
    if (filters.fromDate) searchQuery.timestamp.$gte = filters.fromDate;
    if (filters.toDate) searchQuery.timestamp.$lte = filters.toDate;
  }

  return c.messages
    .find(searchQuery)
    .sort({ timestamp: -1 })
    .limit(50)
    .toArray();
}

export async function analyzeChannel(
  userId: string,
  channelId: string,
  analysisType: 'summary' | 'value' | 'math'
): Promise<string> {
  const c = await collections();
  if (!c) return 'Unable to access database';

  const messages = await c.messages
    .find({ ownerUserId: userId, channelId })
    .sort({ timestamp: -1 })
    .limit(100)
    .toArray();

  if (messages.length === 0) {
    return 'No messages found in this channel';
  }

  const messageContext = messages.map((m: any) =>
    `${m.authorName}: ${m.content}`
  ).join('\n');

  let prompt = '';
  switch (analysisType) {
    case 'summary':
      prompt = `Summarize the following Discord channel conversation:\n\n${messageContext}`;
      break;
    case 'value':
      prompt = `Analyze the following Discord messages and find relative values, prices, or worth mentioned:\n\n${messageContext}`;
      break;
    case 'math':
      prompt = `Extract and calculate any mathematical expressions or numbers from these messages:\n\n${messageContext}`;
      break;
  }

  const response = await openai.chat.completions.create({
    model: config.OPENAI_CHAT_MODEL,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content || 'Unable to analyze';
}
