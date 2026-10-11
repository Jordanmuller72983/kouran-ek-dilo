import { config } from '../config.ts';
import { db } from '../db.ts';
import { getOutage } from '../store.ts';
import type { SendResult } from './channels.ts';
import { sendSms, sendWebPush, sendWhatsApp } from './channels.ts';
import type { Lang } from './messages.ts';
import { outagePush, outageText } from './messages.ts';

type Subscriber = {
  id: number;
  channel: 'webpush' | 'whatsapp' | 'sms';
  address: string;
  push_keys: string | null;
  lang: Lang;
  unsubscribe_token: string;
};

/** Verified subscribers who follow a place this outage touches and haven't been told yet. */
function recipients(outageId: number): Subscriber[] {
  return db
    .prepare(
      `SELECT DISTINCT s.id, s.channel, s.address, s.push_keys, s.lang, s.unsubscribe_token
       FROM outages o
       JOIN subscribers s ON s.verified = 1 AND instr(s.utilities, o.utility) > 0
       JOIN subscriber_localities sl ON sl.subscriber_id = s.id
       WHERE o.id = :id
         AND (o.scope = 'national'
              OR (o.scope = 'district' AND sl.district = o.district)
              OR sl.locality IN (SELECT locality FROM outage_localities WHERE outage_id = o.id))
         AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.outage_id = o.id AND d.subscriber_id = s.id)`,
    )
    .all({ id: outageId }) as Subscriber[];
}

async function deliver(sub: Subscriber, outageId: number): Promise<SendResult> {
  const outage = getOutage(outageId)!;
  const link = `${config.publicUrl}/#/outage/${outageId}`;
  if (sub.channel === 'webpush') {
    const { title, body } = outagePush(outage, sub.lang);
    return sendWebPush(sub.address, JSON.parse(sub.push_keys!), { title, body, url: link, tag: `outage-${outageId}` });
  }
  const text = outageText(outage, sub.lang, link, sub.channel);
  return sub.channel === 'sms' ? sendSms(sub.address, text) : sendWhatsApp(sub.address, text);
}

let running = false;

/**
 * Alert every matching subscriber about every current outage they haven't been told about yet.
 * Runs over all current outages (not just new ones) so people who subscribe while a cut is
 * already announced still hear about it. The deliveries table guarantees one alert per person.
 */
export async function dispatchPending(now = Date.now()): Promise<{ outages: number; sent: number; failed: number }> {
  if (running) return { outages: 0, sent: 0, failed: 0 };
  running = true;
  const stats = { outages: 0, sent: 0, failed: 0 };
  try {
    const pending = db
      .prepare(
        `SELECT id FROM outages
         WHERE notify = 1 AND cancelled_at IS NULL AND visible_until >= ?
         ORDER BY starts_at`,
      )
      .all(now) as Array<{ id: number }>;

    const record = db.prepare(
      'INSERT OR IGNORE INTO deliveries (outage_id, subscriber_id, status, error, sent_at) VALUES (?, ?, ?, ?, ?)',
    );
    for (const { id } of pending) {
      const subs = recipients(id);
      if (subs.length) stats.outages++;
      for (const sub of subs) {
        const result = await deliver(sub, id);
        if (result.status === 'failed') {
          stats.failed++;
          if (result.gone) {
            db.prepare('DELETE FROM subscribers WHERE id = ?').run(sub.id);
            continue;
          }
        } else stats.sent++;
        record.run(id, sub.id, result.status, result.status === 'failed' ? result.error : null, Date.now());
      }
      // First time this outage was dispatched (kept for stats).
      if (subs.length) db.prepare('UPDATE outages SET notified_at = COALESCE(notified_at, ?) WHERE id = ?').run(Date.now(), id);
    }
  } finally {
    running = false;
  }
  return stats;
}
