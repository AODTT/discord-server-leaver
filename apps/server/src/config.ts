import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  APP_ORIGIN: z.string().url().default('http://localhost:8787'),
  EXTENSION_ORIGINS: z.string().default(''),
  MONGODB_URI: z.string().default(''),
  MONGODB_DB: z.string().default('discord_memory'),
  AUTH_SECRET: z.string().min(16).default('development-only-change-me-please'),
  TOKEN_ENCRYPTION_KEY: z.string().default(''),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  MONGODB_VECTOR_INDEX: z.string().default('message_vector_index'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  CUSTOM_PURCHASE_MIN_USD: z.coerce.number().default(5),
  CUSTOM_PURCHASE_MAX_USD: z.coerce.number().default(500),
  PROMO_DISCOUNT_PERCENT: z.coerce.number().default(80),
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';
export const publicConfig = {
  apiOrigin: config.APP_ORIGIN,
  minDonation: config.CUSTOM_PURCHASE_MIN_USD,
  maxDonation: config.CUSTOM_PURCHASE_MAX_USD,
  promoDiscount: config.PROMO_DISCOUNT_PERCENT,
};

export function allowedOrigins(): string[] {
  return config.EXTENSION_ORIGINS.split(',').map((item) => item.trim()).filter(Boolean).concat(config.APP_ORIGIN);
}
