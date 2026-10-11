import { db, transaction } from './db.ts';
import type { DistrictId } from './localities.ts';
import { getLocality } from './localities.ts';
import { DAY, HOUR } from './time.ts';

export type Utility = 'electricity' | 'water';

export type OutageInput = {
  utility: Utility;
  kind: 'planned' | 'interruption' | 'schedule' | 'advisory' | 'news' | 'community';
  source: 'ceb' | 'cwa' | 'community' | 'admin';
  sourceRef: string;
  title: string;
  details: string | null;
  areaLabel: string | null;
  district: DistrictId | null;
  scope: 'locality' | 'district' | 'national';
  localities: string[];
  startsAt: number;
  endsAt: number | null;
  /** How long to keep an open-ended notice on the feed. */
  visibleFor?: number;
  url?: string | null;
  attachmentUrl?: string | null;
  /** Picture to use when the attachment isn't a PDF poster. */
  imageSource?: string | null;
  notify?: boolean;
};

type OutageRow = {
  id: number;
  utility: Utility;
  kind: string;
  source: string;
  title: string;
  details: string | null;
  area_label: string | null;
  district: string | null;
  scope: string;
  starts_at: number;
  ends_at: number | null;
  visible_until: number;
  url: string | null;
  attachment_url: string | null;
  image_url: string | null;
  confirmations: number;
  notified_at: number | null;
  cancelled_at: number | null;
};

export type Outage = ReturnType<typeof toOutage>;

function toOutage(row: OutageRow, localities: string[], now = Date.now()) {
  const end = row.ends_at ?? row.visible_until;
  const status = row.cancelled_at
    ? 'cancelled'
    : now < row.starts_at
      ? 'upcoming'
      : now <= end
        ? 'ongoing'
        : 'ended';
  return {
    id: row.id,
    utility: row.utility,
    kind: row.kind,
    source: row.source,
    status,
    title: row.title,
    details: row.details,
    areaLabel: row.area_label,
    district: row.district,
    scope: row.scope,
    localities,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: row.ends_at ? new Date(row.ends_at).toISOString() : null,
    url: row.url,
    attachmentUrl: row.attachment_url,
    imageUrl: row.image_url,
    confirmations: row.confirmations,
  };
}

function localitiesFor(ids: number[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  if (!ids.length) return map;
  const rows = db
    .prepare(`SELECT outage_id, locality FROM outage_localities WHERE outage_id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as Array<{ outage_id: number; locality: string }>;
  for (const r of rows) map.set(r.outage_id, [...(map.get(r.outage_id) ?? []), r.locality]);
  return map;
}

export function upsertOutage(o: OutageInput, now = Date.now()): { id: number; created: boolean } {
  const visibleUntil = o.endsAt ?? o.startsAt + (o.visibleFor ?? DAY);
  return transaction(() => {
    const existing = db.prepare('SELECT id FROM outages WHERE source_ref = ?').get(o.sourceRef) as
      | { id: number }
      | undefined;
    let id: number;
    if (existing) {
      id = existing.id;
      db.prepare(
        `UPDATE outages SET title = ?, details = ?, area_label = ?, district = ?, scope = ?, starts_at = ?,
           ends_at = ?, visible_until = ?, url = ?, attachment_url = ?, image_source = ?, cancelled_at = NULL, updated_at = ?
         WHERE id = ?`,
      ).run(o.title, o.details, o.areaLabel, o.district, o.scope, o.startsAt, o.endsAt, visibleUntil,
        o.url ?? null, o.attachmentUrl ?? null, o.imageSource ?? null, now, id);
      db.prepare('DELETE FROM outage_localities WHERE outage_id = ?').run(id);
    } else {
      const res = db.prepare(
        `INSERT INTO outages (utility, kind, source, source_ref, title, details, area_label, district, scope,
           starts_at, ends_at, visible_until, url, attachment_url, image_source, notify, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(o.utility, o.kind, o.source, o.sourceRef, o.title, o.details, o.areaLabel, o.district, o.scope,
        o.startsAt, o.endsAt, visibleUntil, o.url ?? null, o.attachmentUrl ?? null, o.imageSource ?? null, o.notify === false ? 0 : 1,
        now, now);
      id = Number(res.lastInsertRowid);
    }
    const insertLocality = db.prepare('INSERT OR IGNORE INTO outage_localities (outage_id, locality) VALUES (?, ?)');
    for (const l of o.localities) insertLocality.run(id, l);
    return { id, created: !existing };
  });
}

/** CEB removes notices it has withdrawn. Mark future ones we no longer see as cancelled. */
export function cancelMissing(source: string, seenRefs: string[], now = Date.now()): number {
  const placeholders = seenRefs.map(() => '?').join(',') || "''";
  const res = db
    .prepare(
      `UPDATE outages SET cancelled_at = ?, updated_at = ?
       WHERE source = ? AND starts_at > ? AND cancelled_at IS NULL AND source_ref NOT IN (${placeholders})`,
    )
    .run(now, now, source, now, ...seenRefs);
  return Number(res.changes);
}

export type OutageQuery = {
  utility?: Utility;
  district?: string;
  locality?: string;
  window?: 'current' | 'past';
};

export function listOutages(q: OutageQuery, now = Date.now()): Outage[] {
  const loc = q.locality ? getLocality(q.locality) : undefined;
  const past = q.window === 'past';
  const rows = db
    .prepare(
      `SELECT o.* FROM outages o
       WHERE (:utility IS NULL OR o.utility = :utility)
         AND (:district IS NULL OR o.district = :district OR o.scope = 'national')
         AND (:locality IS NULL OR o.scope = 'national'
              OR EXISTS (SELECT 1 FROM outage_localities ol WHERE ol.outage_id = o.id AND ol.locality = :locality)
              OR (o.scope = 'district' AND o.district = :localityDistrict))
         AND ${past ? 'o.visible_until < :now AND o.visible_until > :now - :pastWindow' : 'o.visible_until >= :now AND o.cancelled_at IS NULL'}
       ORDER BY o.starts_at ${past ? 'DESC' : 'ASC'}
       LIMIT 200`,
    )
    .all({
      utility: q.utility ?? null,
      district: q.district ?? null,
      locality: loc?.id ?? null,
      localityDistrict: loc?.district ?? null,
      now,
      ...(past ? { pastWindow: 30 * DAY } : {}),
    }) as OutageRow[];
  const locs = localitiesFor(rows.map((r) => r.id));
  return rows.map((r) => toOutage(r, locs.get(r.id) ?? [], now));
}

/** Full archive of one source's notices, newest first, including ones no longer on the live feed. */
export function listArchive(source: string, limit: number, offset: number): { items: Outage[]; total: number } {
  const rows = db
    .prepare('SELECT * FROM outages WHERE source = ? ORDER BY starts_at DESC LIMIT ? OFFSET ?')
    .all(source, limit, offset) as OutageRow[];
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM outages WHERE source = ?').get(source) as { total: number };
  const locs = localitiesFor(rows.map((r) => r.id));
  return { items: rows.map((r) => toOutage(r, locs.get(r.id) ?? [])), total };
}

export function getOutage(id: number): Outage | null {
  const row = db.prepare('SELECT * FROM outages WHERE id = ?').get(id) as OutageRow | undefined;
  if (!row) return null;
  return toOutage(row, localitiesFor([id]).get(id) ?? []);
}

/** "Mo osi" — someone else confirms they're affected. One vote per person per outage. */
export function confirmOutage(id: number, reporter: string): number | null {
  return transaction(() => {
    const row = db.prepare('SELECT confirmations FROM outages WHERE id = ?').get(id) as
      | { confirmations: number }
      | undefined;
    if (!row) return null;
    const res = db.prepare('INSERT OR IGNORE INTO confirmations (outage_id, reporter) VALUES (?, ?)').run(id, reporter);
    if (res.changes) {
      db.prepare('UPDATE outages SET confirmations = confirmations + 1 WHERE id = ?').run(id);
      return row.confirmations + 1;
    }
    return row.confirmations;
  });
}

// ---------- Community reports ----------

export type ReportRow = {
  id: number;
  utility: Utility;
  locality: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: number;
  outage_id: number | null;
};

export function createReport(r: { utility: Utility; locality: string; description: string; reporter: string }) {
  const res = db
    .prepare('INSERT INTO reports (utility, locality, description, reporter, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(r.utility, r.locality, r.description, r.reporter, Date.now());
  return Number(res.lastInsertRowid);
}

export function countRecentReports(reporter: string, sinceMs: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter = ? AND created_at > ?')
    .get(reporter, Date.now() - sinceMs) as { n: number };
  return row.n;
}

/** Pending reports, with how many others came from the same place recently — clusters are more credible. */
export function listReports(status: ReportRow['status']) {
  return db
    .prepare(
      `SELECT r.id, r.utility, r.locality, r.description, r.status, r.created_at, r.outage_id,
         (SELECT COUNT(*) FROM reports r2 WHERE r2.locality = r.locality AND r2.utility = r.utility
            AND r2.status != 'rejected' AND ABS(r2.created_at - r.created_at) < :window) AS similar
       FROM reports r WHERE r.status = :status ORDER BY r.created_at DESC LIMIT 200`,
    )
    .all({ status, window: 2 * HOUR }) as Array<ReportRow & { similar: number }>;
}

export function moderateReport(id: number, action: 'approve' | 'reject', notify: boolean) {
  return transaction(() => {
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportRow | undefined;
    if (!report) return null;
    if (report.status !== 'pending') return report;
    let outageId: number | null = null;
    if (action === 'approve') {
      const loc = getLocality(report.locality)!;
      outageId = upsertOutage({
        utility: report.utility,
        kind: 'community',
        source: 'community',
        sourceRef: `report:${report.id}`,
        title: loc.name,
        details: report.description,
        areaLabel: loc.name,
        district: loc.district,
        scope: 'locality',
        localities: [loc.id],
        startsAt: report.created_at,
        endsAt: null,
        visibleFor: 12 * HOUR,
        notify,
      }).id;
    }
    db.prepare('UPDATE reports SET status = ?, moderated_at = ?, outage_id = ? WHERE id = ?').run(
      action === 'approve' ? 'approved' : 'rejected', Date.now(), outageId, id,
    );
    return { ...report, status: action === 'approve' ? 'approved' : 'rejected', outage_id: outageId };
  });
}
