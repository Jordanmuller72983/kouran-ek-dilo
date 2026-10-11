import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.ts';
import { runIngest } from './ingest/index.ts';
import { MEDIA_DIR } from './ingest/media.ts';
import { dispatchPending } from './notify/dispatcher.ts';
import { adminRouter } from './routes/admin.ts';
import { HttpError } from './routes/http.ts';
import { publicRouter } from './routes/public.ts';
import { subscriptionsRouter } from './routes/subscriptions.ts';
import { secrets } from './secrets.ts';

export const app = express();
if (config.trustProxy) app.set('trust proxy', Number(config.trustProxy) || config.trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));

// Poster thumbnails; file names are outage ids and never change, so cache hard.
app.use('/media', express.static(MEDIA_DIR, { maxAge: '30d', immutable: true, fallthrough: false }));
app.use('/api', publicRouter);
app.use('/api', subscriptionsRouter);
app.use('/api/admin', adminRouter);
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

// In production the API also serves the built React app.
const webDist = path.resolve(import.meta.dirname, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist, { maxAge: '1h', index: false }));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if ((err as { type?: string }).type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

function every(ms: number, name: string, job: () => Promise<unknown>) {
  const run = () => job().catch((err) => console.error(`[${name}]`, err));
  setTimeout(run, 2_000);
  setInterval(run, ms);
}

if (import.meta.main) {
  app.listen(config.port, () => {
    console.log(`Kouran ek Dilo API on http://localhost:${config.port}`);
    if (!config.adminToken) console.log(`Admin token (generated, stored in ${config.dataDir}): ${secrets.adminToken}`);
  });

  if (config.jobsEnabled) {
    every(config.ingestEveryMinutes * 60_000, 'ingest', async () => {
      const results = await runIngest();
      console.log('[ingest]', results.map((r) => `${r.source}: ${r.found} found, ${r.created} new${r.error ? ` (error: ${r.error})` : ''}`).join(' · '));
    });
    every(config.dispatchEverySeconds * 1000, 'dispatch', async () => {
      const s = await dispatchPending();
      if (s.sent || s.failed) console.log(`[dispatch] ${s.outages} outages → ${s.sent} sent, ${s.failed} failed`);
    });
  }
}
