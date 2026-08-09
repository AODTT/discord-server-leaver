export type User = {
  _id?: unknown;
  discordId: string;
  username: string;
  avatar?: string | null;
  createdAt: Date;
  updatedAt: Date;
  aiCredits: number;
  freeQuestionsUsed: number;
  cloudEnabled: boolean;
};

export type MessageRecord = {
  messageId: string;
  ownerUserId: string;
  authorId?: string;
  authorName?: string;
  content: string;
  timestamp: Date;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  source: 'data-package' | 'bot-sync';
  attachments?: string[];
  jumpUrl?: string;
  embedding?: number[];
  indexedAt?: Date;
};

export type Citation = Omit<MessageRecord, 'embedding'> & { score?: number; reason?: string };
