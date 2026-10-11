import webpush from 'web-push';
import { config } from '../config.ts';
import { secrets } from '../secrets.ts';

webpush.setVapidDetails(config.vapid.subject, secrets.vapidPublicKey, secrets.vapidPrivateKey);

export type SendResult = { status: 'sent' | 'logged' } | { status: 'failed'; error: string; gone?: boolean };

export async function sendWebPush(
  endpoint: string,
  keys: { p256dh: string; auth: string },
  payload: object,
): Promise<SendResult> {
  try {
    await webpush.sendNotification({ endpoint, keys }, JSON.stringify(payload), { TTL: 12 * 3600 });
    return { status: 'sent' };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    // 404/410: the browser dropped this subscription; caller should delete it.
    return { status: 'failed', error: String((err as Error).message), gone: statusCode === 404 || statusCode === 410 };
  }
}

const twilioReady = () => Boolean(config.twilio.accountSid && config.twilio.authToken);

async function twilioSend(from: string, to: string, body: string): Promise<SendResult> {
  const { accountSid, authToken } = config.twilio;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.ok) return { status: 'sent' };
  return { status: 'failed', error: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` };
}

// Without credentials, messages are printed so the whole flow can be tested locally.
export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!twilioReady() || !config.twilio.smsFrom) {
    console.log(`[sms → ${to}]\n${body}\n`);
    return { status: 'logged' };
  }
  return twilioSend(config.twilio.smsFrom, to, body);
}

export async function sendWhatsApp(to: string, body: string): Promise<SendResult> {
  if (!twilioReady() || !config.twilio.whatsappFrom) {
    console.log(`[whatsapp → ${to}]\n${body}\n`);
    return { status: 'logged' };
  }
  return twilioSend(config.twilio.whatsappFrom, `whatsapp:${to}`, body);
}
