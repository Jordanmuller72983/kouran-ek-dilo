import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  dataDir: path.resolve(env.DATA_DIR ?? 'data'),
  publicUrl: (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  adminToken: env.ADMIN_TOKEN ?? '',
  trustProxy: env.TRUST_PROXY ?? '',
  jobsEnabled: env.JOBS_ENABLED !== 'false',
  ingestEveryMinutes: Number(env.INGEST_EVERY_MINUTES ?? 30),
  dispatchEverySeconds: Number(env.DISPATCH_EVERY_SECONDS ?? 60),
  sources: {
    cebUrl: env.CEB_URL ?? 'https://ceb.mu/customer-corner/power-outage-information',
    cwaPostsUrl: env.CWA_POSTS_URL ?? 'https://cwa.govmu.org/cwa/index.php?rest_route=/wp/v2/posts',
  },
  vapid: {
    publicKey: env.VAPID_PUBLIC_KEY ?? '',
    privateKey: env.VAPID_PRIVATE_KEY ?? '',
    subject: env.VAPID_SUBJECT ?? 'mailto:admin@example.mu',
  },
  twilio: {
    accountSid: env.TWILIO_ACCOUNT_SID ?? '',
    authToken: env.TWILIO_AUTH_TOKEN ?? '',
    smsFrom: env.TWILIO_SMS_FROM ?? '',
    whatsappFrom: env.TWILIO_WHATSAPP_FROM ?? '',
  },
  userAgent: 'KouranEkDilo/0.1 (Mauritius outage tracker)',
};
