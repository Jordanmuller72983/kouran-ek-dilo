import { Router } from 'express';
import { DISTRICTS, LOCALITIES, districtCenter, getLocality } from '../localities.ts';
import { confirmOutage, countRecentReports, createReport, getOutage, listArchive, listOutages } from '../store.ts';
import { HOUR } from '../time.ts';
import { lastRuns } from '../ingest/index.ts';
import { HttpError, oneOf, optionalOneOf, rateLimit, reporterId } from './http.ts';

export const publicRouter = Router();

const UTILITIES = ['electricity', 'water'] as const;

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true, sources: lastRuns() });
});

publicRouter.get('/localities', (_req, res) => {
  // Revalidate every time (cheap 304 via ETag) so new localities or coordinates show up immediately.
  res.set('Cache-Control', 'no-cache');
  res.json({ districts: DISTRICTS.map((d) => ({ ...d, center: districtCenter(d.id) })), localities: LOCALITIES });
});

publicRouter.get('/outages', (req, res) => {
  const { utility, district, locality, window } = req.query;
  if (locality && !getLocality(String(locality))) throw new HttpError(400, 'Unknown locality');
  res.json({
    outages: listOutages({
      utility: optionalOneOf(utility, UTILITIES, 'utility'),
      district: optionalOneOf(district, DISTRICTS.map((d) => d.id), 'district'),
      locality: locality ? String(locality) : undefined,
      window: optionalOneOf(window, ['current', 'past'] as const, 'window'),
    }),
  });
});

// Every CWA communiqué ever ingested (supply notices, grants, rates, office notices…), newest first.
publicRouter.get('/communiques', (req, res) => {
  const offset = Math.max(0, Number(req.query.offset) || 0);
  res.json(listArchive('cwa', 20, offset));
});

publicRouter.get('/outages/:id', (req, res) => {
  const outage = getOutage(Number(req.params.id));
  if (!outage) throw new HttpError(404, 'Outage not found');
  res.json({ outage });
});

// "Mo osi!" — I'm affected too.
publicRouter.post('/outages/:id/confirm', rateLimit('confirm', 30, HOUR), (req, res) => {
  const count = confirmOutage(Number(req.params.id), reporterId(req));
  if (count === null) throw new HttpError(404, 'Outage not found');
  res.json({ confirmations: count });
});

publicRouter.post('/reports', rateLimit('report', 5, HOUR), (req, res) => {
  const utility = oneOf(req.body?.utility, UTILITIES, 'utility');
  const locality = String(req.body?.locality ?? '');
  if (!getLocality(locality)) throw new HttpError(400, 'Please choose a locality from the list');
  const description = String(req.body?.description ?? '').trim().slice(0, 500);
  if (description.length < 5) throw new HttpError(400, 'Please describe what is happening');

  const reporter = reporterId(req);
  if (countRecentReports(reporter, 24 * HOUR) >= 10) throw new HttpError(429, 'Daily report limit reached');
  const id = createReport({ utility, locality, description, reporter });
  res.status(201).json({ id, status: 'pending' });
});
