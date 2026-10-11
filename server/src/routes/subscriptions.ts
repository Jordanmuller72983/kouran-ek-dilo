import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { db, transaction } from '../db.ts';
import { getLocality } from '../localities.ts';
import { sendSms, sendWhatsApp } from '../notify/channels.ts';
import type { Lang } from '../notify/messages.ts';
import { LANGS, otpMessage } from '../notify/messages.ts';
import { normaliseMuMobile } from '../notify/phone.ts';
import { secrets } from '../secrets.ts';
import { HOUR } from '../time.ts';
import { HttpError, oneOf, rateLimit } from './http.ts';

export const subscriptionsRouter = Router();

const OTP_TTL = 10 * 60_000;
const hashOtp = (code: string) => createHash('sha256').update(`${secrets.hashSalt}:${code}`).digest('hex');

type Prefs = { localities: string[]; utilities: string; lang: Lang };

function readPrefs(body: Record<string, unknown>): Prefs {
  const localities = Array.isArray(body.localities) ? [...new Set(body.localities.map(String))] : [];
  if (localities.length === 0 || localities.length > 10) throw new HttpError(400, 'Choose between 1 and 10 localities');
  for (const id of localities) if (!getLocality(id)) throw new HttpError(400, `Unknown locality: ${id}`);
  const wanted = Array.isArray(body.utilities) ? body.utilities.map(String) : ['electricity', 'water'];
  const utilities = ['electricity', 'water'].filter((u) => wanted.includes(u));
  if (utilities.length === 0) throw new HttpError(400, 'Choose electricity, water, or both');
  return { localities, utilities: utilities.join(','), lang: oneOf(body.lang ?? 'en', LANGS, 'lang') };
}

/** Create or update a subscriber and replace their locality list. Returns the subscriber id. */
function saveSubscriber(channel: string, address: string, prefs: Prefs, extra: { pushKeys?: string; verified?: boolean }) {
  return transaction(() => {
    db.prepare(
      `INSERT INTO subscribers (channel, address, push_keys, lang, utilities, verified, unsubscribe_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (channel, address) DO UPDATE SET
         push_keys = COALESCE(excluded.push_keys, push_keys), lang = excluded.lang, utilities = excluded.utilities`,
    ).run(channel, address, extra.pushKeys ?? null, prefs.lang, prefs.utilities, extra.verified ? 1 : 0,
      randomBytes(16).toString('base64url'), Date.now());
    const { id, unsubscribe_token } = db
      .prepare('SELECT id, unsubscribe_token FROM subscribers WHERE channel = ? AND address = ?')
      .get(channel, address) as { id: number; unsubscribe_token: string };
    db.prepare('DELETE FROM subscriber_localities WHERE subscriber_id = ?').run(id);
    const insert = db.prepare('INSERT INTO subscriber_localities (subscriber_id, locality, district) VALUES (?, ?, ?)');
    for (const l of prefs.localities) insert.run(id, l, getLocality(l)!.district);
    return { id, unsubscribeToken: unsubscribe_token };
  });
}

// Browser push: the push subscription itself proves the device, so no OTP needed.
subscriptionsRouter.post('/subscriptions/webpush', rateLimit('sub', 20, HOUR), (req, res) => {
  const sub = req.body?.subscription;
  if (typeof sub?.endpoint !== 'string' || !sub.endpoint.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth) {
    throw new HttpError(400, 'Invalid push subscription');
  }
  const prefs = readPrefs(req.body);
  const { unsubscribeToken } = saveSubscriber('webpush', sub.endpoint, prefs, {
    pushKeys: JSON.stringify({ p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }),
    verified: true,
  });
  res.status(201).json({ ok: true, unsubscribeToken });
});

// WhatsApp / SMS step 1: send a 6-digit code.
subscriptionsRouter.post('/subscriptions/phone', rateLimit('otp', 5, HOUR), async (req, res) => {
  const channel = oneOf(req.body?.channel, ['whatsapp', 'sms'] as const, 'channel');
  const phone = normaliseMuMobile(String(req.body?.phone ?? ''));
  if (!phone) throw new HttpError(400, 'Enter a Mauritian mobile number, e.g. 5712 3456');
  const prefs = readPrefs(req.body);

  const { id } = saveSubscriber(channel, phone, prefs, {});
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  db.prepare('UPDATE subscribers SET otp_hash = ?, otp_expires = ?, otp_attempts = 0 WHERE id = ?').run(
    hashOtp(code), Date.now() + OTP_TTL, id,
  );
  const text = otpMessage(prefs.lang, code);
  const result = channel === 'sms' ? await sendSms(phone, text) : await sendWhatsApp(phone, text);
  if (result.status === 'failed') throw new HttpError(502, 'Could not send the code, please try again');
  res.json({ ok: true, phone });
});

// Step 2: confirm the code.
subscriptionsRouter.post('/subscriptions/phone/verify', rateLimit('verify', 20, HOUR), (req, res) => {
  const channel = oneOf(req.body?.channel, ['whatsapp', 'sms'] as const, 'channel');
  const phone = normaliseMuMobile(String(req.body?.phone ?? ''));
  const code = String(req.body?.code ?? '').trim();
  const row = phone
    ? (db.prepare('SELECT id, otp_hash, otp_expires, otp_attempts, unsubscribe_token FROM subscribers WHERE channel = ? AND address = ?')
        .get(channel, phone) as
        | { id: number; otp_hash: string | null; otp_expires: number; otp_attempts: number; unsubscribe_token: string }
        | undefined)
    : undefined;
  if (!row?.otp_hash || row.otp_expires < Date.now() || row.otp_attempts >= 5) {
    throw new HttpError(400, 'Code expired. Please request a new one.');
  }
  db.prepare('UPDATE subscribers SET otp_attempts = otp_attempts + 1 WHERE id = ?').run(row.id);
  const ok = timingSafeEqual(Buffer.from(hashOtp(code)), Buffer.from(row.otp_hash));
  if (!ok) throw new HttpError(400, 'Incorrect code');
  db.prepare('UPDATE subscribers SET verified = 1, otp_hash = NULL WHERE id = ?').run(row.id);
  res.json({ ok: true, unsubscribeToken: row.unsubscribe_token });
});

subscriptionsRouter.post('/unsubscribe', (req, res) => {
  const token = String(req.body?.token ?? '');
  const result = db.prepare('DELETE FROM subscribers WHERE unsubscribe_token = ?').run(token);
  if (!result.changes) throw new HttpError(404, 'Subscription not found');
  res.json({ ok: true });
});

subscriptionsRouter.get('/push/public-key', (_req, res) => {
  res.json({ publicKey: secrets.vapidPublicKey });
});
