import { collections, memoryStore } from './db.js';
import { userSendMessage } from './discord.js';

type ScheduleDoc = {
  _id: string; ownerUserId: string; guildId: string; channelId: string; content: string; enabled: boolean;
  nextRunAt: Date; recurrence?: { kind: 'interval' | 'daily' | 'weekly'; minutes?: number; days?: number[] }; lockedUntil?: Date;
};

export function startBotWorker(): { stop(): void } | undefined {
  console.info('Worker started for scheduled messages using user OAuth tokens');
  const scheduleTimer = setInterval(() => void runDueSchedules(), 15_000);
  void runDueSchedules();
  return { stop() { if (scheduleTimer) clearInterval(scheduleTimer); } };
}

async function runDueSchedules(): Promise<void> {
  const now = new Date(); const lockUntil = new Date(Date.now() + 60_000); const c = await collections();
  const due = c ? await c.schedules.find({ enabled: true, nextRunAt: { $lte: now }, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lt: now } }] }).limit(20).toArray() as unknown as ScheduleDoc[] : [...memoryStore().schedules.values()].filter((doc) => doc.enabled === true && doc.nextRunAt instanceof Date && doc.nextRunAt <= now && (!(doc.lockedUntil instanceof Date) || doc.lockedUntil < now)).slice(0, 20) as unknown as ScheduleDoc[];
  for (const schedule of due) {
    const claimed = await claimSchedule(schedule, lockUntil); if (!claimed) continue;
    try {
      await userSendMessage(schedule.ownerUserId, schedule.channelId, schedule.content);
      const nextRunAt = nextOccurrence(schedule, now);
      await finishSchedule(schedule, { enabled: Boolean(nextRunAt), nextRunAt, lastRunAt: new Date(), lastStatus: 'sent', lockedUntil: null });
      await recordDelivery(schedule, 'sent');
    } catch (error) {
      await finishSchedule(schedule, { lastStatus: 'failed', lastError: error instanceof Error ? error.message.slice(0, 300) : 'unknown error', lockedUntil: null });
      await recordDelivery(schedule, 'failed', error instanceof Error ? error.message : 'unknown error');
    }
  }
}

async function claimSchedule(schedule: ScheduleDoc, lockedUntil: Date): Promise<boolean> {
  const c = await collections();
  if (c) return (await c.schedules.updateOne({ _id: schedule._id, enabled: true, nextRunAt: schedule.nextRunAt, $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lt: new Date() } }] }, { $set: { lockedUntil } })).modifiedCount === 1;
  const doc = memoryStore().schedules.get(String(schedule._id)); if (!doc || doc.enabled !== true || (doc.lockedUntil instanceof Date && doc.lockedUntil >= new Date())) return false; doc.lockedUntil = lockedUntil; return true;
}

async function finishSchedule(schedule: ScheduleDoc, patch: Record<string, unknown>): Promise<void> { const c = await collections(); if (c) await c.schedules.updateOne({ _id: schedule._id }, { $set: patch }); else Object.assign(memoryStore().schedules.get(String(schedule._id)) ?? {}, patch); }
async function recordDelivery(schedule: ScheduleDoc, status: string, error?: string): Promise<void> { const event = { _id: `${schedule._id}:${Date.now()}`, scheduleId: String(schedule._id), ownerUserId: schedule.ownerUserId, channelId: schedule.channelId, status, error, createdAt: new Date() }; const c = await collections(); if (c) await c.deliveryEvents.insertOne(event); else memoryStore().deliveryEvents.set(event._id, event); }

export function nextOccurrence(schedule: Pick<ScheduleDoc, 'recurrence' | 'nextRunAt'>, now = new Date()): Date | undefined {
  const recurrence = schedule.recurrence; if (!recurrence) return undefined;
  if (recurrence.kind === 'interval') return new Date(Math.max(schedule.nextRunAt.getTime(), now.getTime()) + Math.max(recurrence.minutes ?? 15, 15) * 60_000);
  if (recurrence.kind === 'daily') { const next = new Date(schedule.nextRunAt); do next.setUTCDate(next.getUTCDate() + 1); while (next <= now); return next; }
  const allowed = new Set(recurrence.days?.length ? recurrence.days : [schedule.nextRunAt.getUTCDay()]); const next = new Date(schedule.nextRunAt); do next.setUTCDate(next.getUTCDate() + 1); while (next <= now || !allowed.has(next.getUTCDay())); return next;
}
