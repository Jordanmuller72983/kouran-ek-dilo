import { createHash } from 'node:crypto';
import { Router } from 'express';
import { DISTRICTS, getLocality } from '../localities.ts';
import { runIngest } from '../ingest/index.ts';
import { dispatchPending } from '../notify/dispatcher.ts';
import { parseWindow } from '../parsers/dates.ts';
import { getOutage, listReports, moderateReport, upsertOutage } from '../store.ts';
import { db } from '../db.ts';
import { HttpError, oneOf, requireAdmin } from './http.ts';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/reports', (req, res) => {
  const status = oneOf(req.query.status ?? 'pending', ['pending', 'approved', 'rejected'] as const, 'status');
  res.json({ reports: listReports(status) });
});

adminRouter.post('/reports/:id/:action', (req, res) => {
  const action = oneOf(req.params.action, ['approve', 'reject'] as const, 'action');
  const report = moderateReport(Number(req.params.id), action, req.body?.notify === true);
  if (!report) throw new HttpError(404, 'Report not found');
  res.json({ report });
});

// Many notices only appear on Facebook or the radio. Moderators can enter them by hand.
adminRouter.post('/outages', (req, res) => {
  const b = req.body ?? {};
  const utility = oneOf(b.utility, ['electricity', 'water'] as const, 'utility');
  const localities: string[] = Array.isArray(b.localities) ? b.localities.map(String) : [];
  for (const id of localities) if (!getLocality(id)) throw new HttpError(400, `Unknown locality: ${id}`);
  const district = b.district ? oneOf(b.district, DISTRICTS.map((d) => d.id), 'district') : null;
  const window = parseWindow(String(b.when ?? ''));
  if (!window) throw new HttpError(400, 'Could not read the date/time, e.g. "12 October 08:30 to 15:30"');
  const title = String(b.title ?? '').trim();
  if (!title) throw new HttpError(400, 'Title required');

  const { id } = upsertOutage({
    utility,
    kind: utility === 'electricity' ? 'planned' : 'interruption',
    source: 'admin',
    sourceRef: 'admin:' + createHash('sha1').update(JSON.stringify([utility, title, b.when, localities])).digest('hex'),
    title,
    details: b.details ? String(b.details) : null,
    areaLabel: title,
    district: district ?? (localities[0] ? getLocality(localities[0])!.district : null),
    scope: localities.length ? 'locality' : district ? 'district' : 'national',
    localities,
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    url: b.url ? String(b.url) : null,
  });
  res.status(201).json({ outage: getOutage(id) });
});

adminRouter.post('/outages/:id/hide', (req, res) => {
  db.prepare('UPDATE outages SET cancelled_at = ?, updated_at = ? WHERE id = ?').run(Date.now(), Date.now(), Number(req.params.id));
  res.json({ ok: true });
});

adminRouter.post('/ingest', async (_req, res) => {
  res.json({ results: await runIngest(), dispatch: await dispatchPending() });
});

adminRouter.get('/stats', (_req, res) => {
  res.json({
    subscribers: db.prepare('SELECT channel, COUNT(*) AS n FROM subscribers WHERE verified = 1 GROUP BY channel').all(),
    deliveries: db.prepare('SELECT status, COUNT(*) AS n FROM deliveries GROUP BY status').all(),
  });
});
