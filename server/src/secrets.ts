import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import webpush from 'web-push';
import { config } from './config.ts';

type Secrets = {
  adminToken: string;
  hashSalt: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
};

// Values not supplied via env are generated once and persisted, so dev "just works".
function load(): Secrets {
  mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, 'secrets.json');
  const stored: Partial<Secrets> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

  if (!stored.hashSalt) stored.hashSalt = randomBytes(16).toString('hex');
  if (!stored.adminToken) stored.adminToken = randomBytes(18).toString('base64url');
  if (!stored.vapidPublicKey || !stored.vapidPrivateKey) {
    const keys = webpush.generateVAPIDKeys();
    stored.vapidPublicKey = keys.publicKey;
    stored.vapidPrivateKey = keys.privateKey;
  }
  writeFileSync(file, JSON.stringify(stored, null, 2));

  return {
    hashSalt: stored.hashSalt,
    adminToken: config.adminToken || stored.adminToken,
    vapidPublicKey: config.vapid.publicKey || stored.vapidPublicKey,
    vapidPrivateKey: config.vapid.privateKey || stored.vapidPrivateKey,
  };
}

export const secrets = load();
