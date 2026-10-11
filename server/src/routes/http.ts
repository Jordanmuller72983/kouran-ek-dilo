import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { secrets } from '../secrets.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Stable, anonymous id for a visitor — we never store raw IPs. */
export function reporterId(req: Request): string {
  return createHash('sha256').update(`${secrets.hashSalt}:${req.ip}`).digest('hex').slice(0, 32);
}

const hits = new Map<string, number[]>();

/** Small in-memory sliding-window limiter; enough for a single instance. */
export function rateLimit(name: string, max: number, windowMs: number) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${name}:${reporterId(req)}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
    if (recent.length >= max) return next(new HttpError(429, 'Too many requests, please try again later'));
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  const given = Buffer.from(req.get('authorization')?.replace(/^Bearer /, '') ?? '');
  const expected = Buffer.from(secrets.adminToken);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return next(new HttpError(401, 'Admin token required'));
  }
  next();
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, `${field} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

export function optionalOneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
  return value === undefined || value === '' ? undefined : oneOf(value, allowed, field);
}
