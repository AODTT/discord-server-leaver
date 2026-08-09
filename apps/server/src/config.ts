import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  APP_ORIGIN: z.string().url().default('http://localhost:8787'),
  EXTENSION_ORIGINS: z.string().default(''),
  MONGODB_URI: z.string().default(''),
  MONGODB_DB: z.string().default('discord_memory'),
  DISCORD_CLIENT_ID: z.string().default(''),
  DISCORD_CLIENT_SECRET: z.string().default(''),
  DISCORD_REDIRECT_URI: z.string().url().default('http://localhost:8787/auth/discord/callback'),
  DISCORD_BOT_TOKEN: z.string().default(''),
  DISCORD_BOT_INVITE_URL: z.string().url().optional().or(z.literal('')),
  AUTH_SECRET: z.string().min(16).default('development-only-change-me-please'),
  TOKEN_ENCRYPTION_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_CHAT_MODEL: z.string().default('gpt-5-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  MONGODB_VECTOR_INDEX: z.string().default('message_vector_index'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_50: z.string().default(''),
  STRIPE_PRICE_120: z.string().default(''),
  STRIPE_PRICE_300: z.string().default(''),
  DONATION_URL: z.string().url().optional().or(z.literal('')),
  DEVELOPER_SITE_URL: z.string().url().optional().or(z.literal('')),
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';
export const publicConfig = {
  apiOrigin: config.APP_ORIGIN,
  donationUrl: config.DONATION_URL || undefined,
  siteUrl: config.DEVELOPER_SITE_URL || undefined,
  botInviteUrl: config.DISCORD_BOT_INVITE_URL || undefined,
};

export function allowedOrigins(): string[] {
  return config.EXTENSION_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean).concat(config.APP_ORIGIN);
}

