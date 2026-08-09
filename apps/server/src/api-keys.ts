import { randomBytes } from 'crypto';
import { collections } from './db.js';

export type ApiKey = {
  _id: string;
  key: string;
  userId: string;
  name: string;
  credits: number;
  usageCount: number;
  lastUsedAt?: Date;
  createdAt: Date;
  expiresAt?: Date;
  active: boolean;
};

export function generateApiKey(): string {
  return 'sk-' + randomBytes(32).toString('hex');
}

export async function createApiKey(userId: string, name: string, credits: number): Promise<ApiKey> {
  const key = generateApiKey();
  const apiKey: ApiKey = {
    _id: key,
    key,
    userId,
    name,
    credits,
    usageCount: 0,
    createdAt: new Date(),
    active: true,
  };

  const c = await collections();
  if (c) {
    await c.apiKeys.insertOne(apiKey);
  }

  return apiKey;
}

export async function validateApiKey(key: string): Promise<ApiKey | null> {
  const c = await collections();
  if (!c) return null;

  const apiKey = await c.apiKeys.findOne({ key, active: true }) as unknown as ApiKey;
  if (!apiKey) return null;

  // Check expiration
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return null;
  }

  return apiKey;
}

export async function consumeCredit(key: string, cost: number = 1): Promise<boolean> {
  const c = await collections();
  if (!c) return false;

  const result = await c.apiKeys.updateOne(
    { key, active: true, credits: { $gte: cost } },
    {
      $inc: { credits: -cost, usageCount: 1 },
      $set: { lastUsedAt: new Date() },
    }
  );

  return result.modifiedCount === 1;
}

export async function getUserApiKeys(userId: string): Promise<ApiKey[]> {
  const c = await collections();
  if (!c) return [];

  return c.apiKeys.find({ userId }).sort({ createdAt: -1 }).toArray() as unknown as ApiKey[];
}

export async function deactivateApiKey(key: string, userId: string): Promise<boolean> {
  const c = await collections();
  if (!c) return false;

  const result = await c.apiKeys.updateOne(
    { key, userId },
    { $set: { active: false } }
  );

  return result.modifiedCount === 1;
}
