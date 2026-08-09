export type Guild = {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
  approximate_member_count?: number;
  leaveable?: boolean;
};

export type MessageRecord = {
  messageId: string;
  authorId?: string;
  authorName?: string;
  content: string;
  timestamp: string;
  guildId?: string;
  guildName?: string;
  channelId?: string;
  channelName?: string;
  source: 'data-package' | 'bot-sync';
  attachments?: string[];
  jumpUrl?: string;
};

export type SearchFilters = {
  query?: string;
  guildId?: string;
  channelId?: string;
  from?: string;
  to?: string;
};

export type AiCitation = MessageRecord & { score?: number; reason?: string };
export type AiAnswer = { answer: string; citations: AiCitation[]; creditsRemaining: number; requestId: string };

export type Schedule = {
  id: string;
  guildId: string;
  channelId: string;
  content: string;
  runAt: string;
  recurrence?: { kind: 'interval' | 'daily' | 'weekly'; minutes?: number; days?: number[] };
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
};

export type AutoReplyRule = {
  id: string;
  guildId: string;
  channelId?: string;
  keyword: string;
  match: 'contains' | 'exact' | 'regex';
  response: string;
  cooldownSeconds: number;
  maxPerHour: number;
  enabled: boolean;
  createdAt: string;
};

export type DashboardState = {
  user?: { id: string; username: string; avatar?: string | null };
  guilds: Guild[];
  localMessageCount: number;
  cloudMessageCount?: number;
  aiCredits: number;
  schedules: Schedule[];
  autoReplies: AutoReplyRule[];
  config: { apiOrigin: string; donationUrl?: string; siteUrl?: string; botInviteUrl?: string };
};

