import crypto from 'node:crypto';
import { config } from './config.js';

function keyBytes(): Buffer {
  if (config.TOKEN_ENCRYPTION_KEY) {
    const decoded = Buffer.from(config.TOKEN_ENCRYPTION_KEY, 'base64');
    if (decoded.length === 32) return decoded;
  }
  return crypto.createHash('sha256').update(config.AUTH_SECRET).digest();
}

export function encryptSecret(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptSecret(value: string): string {
  const [ivText, tagText, dataText] = value.split('.');
  if (!ivText || !tagText || !dataText) throw new Error('Invalid encrypted secret');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

export function randomId(bytes = 24): string { return crypto.randomBytes(bytes).toString('base64url'); }

