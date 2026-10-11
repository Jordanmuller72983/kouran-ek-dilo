import { config } from '../config.ts';
import { db, getMeta, setMeta } from '../db.ts';
import { parseCebPage } from '../parsers/ceb.ts';
import type { WpPost } from '../parsers/cwa.ts';
import { parseCwaPosts } from '../parsers/cwa.ts';
import type { OutageInput } from '../store.ts';
import { cancelMissing, upsertOutage } from '../store.ts';
import { generateThumbnails } from './media.ts';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': config.userAgent, Accept: 'text/html,application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

type Source = {
  name: 'ceb' | 'cwa';
  fetchAndParse: () => Promise<OutageInput[]>;
  /** Source publishes a complete list each time, so anything missing was withdrawn. */
  authoritative: boolean;
};

export const SOURCES: Source[] = [
  {
    name: 'ceb',
    authoritative: true,
    fetchAndParse: async () => parseCebPage(await fetchText(config.sources.cebUrl), config.sources.cebUrl),
  },
  {
    name: 'cwa',
    authoritative: false,
    fetchAndParse: async () => {
      // Once per database: backfill CWA's whole archive. Afterwards only the latest page.
      const backfill = !getMeta('cwa_backfilled');
      const posts: WpPost[] = [];
      for (let page = 1; page <= (backfill ? 20 : 1); page++) {
        const url = `${config.sources.cwaPostsUrl}&per_page=${backfill ? 100 : 30}&page=${page}&_embed=wp:featuredmedia&_fields=id,date,link,title,content,_links,_embedded`;
        let batch: WpPost[];
        try {
          batch = JSON.parse(await fetchText(url));
        } catch (err) {
          if (page > 1 && /HTTP 400/.test(String(err))) break; // WordPress answers 400 past the last page
          throw err;
        }
        posts.push(...batch);
        if (batch.length < 100) break;
      }
      if (backfill) setMeta('cwa_backfilled', new Date().toISOString());
      return parseCwaPosts(posts);
    },
  },
];

export type IngestResult = { source: string; found: number; created: number; cancelled: number; error?: string };

export async function runIngest(only?: string[]): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const source of SOURCES.filter((s) => !only || only.includes(s.name))) {
    const startedAt = Date.now();
    const run = db.prepare('INSERT INTO ingest_runs (source, started_at) VALUES (?, ?)').run(source.name, startedAt);
    const result: IngestResult = { source: source.name, found: 0, created: 0, cancelled: 0 };
    try {
      const outages = await source.fetchAndParse();
      result.found = outages.length;
      for (const o of outages) if (upsertOutage(o).created) result.created++;
      if (source.authoritative) result.cancelled = cancelMissing(source.name, outages.map((o) => o.sourceRef));
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      console.error(`[ingest] ${source.name} failed:`, result.error);
    }
    db.prepare('UPDATE ingest_runs SET finished_at = ?, found = ?, created = ?, error = ? WHERE id = ?').run(
      Date.now(), result.found, result.created, result.error ?? null, run.lastInsertRowid,
    );
    results.push(result);
  }
  // Poster thumbnails are best-effort and never fail the ingest.
  const media = await generateThumbnails().catch((err) => ({ created: 0, failed: 0, error: String(err) }));
  if (media.created || media.failed) console.log(`[media] ${media.created} thumbnails, ${media.failed} failed`);
  return results;
}

export function lastRuns() {
  return db
    .prepare(
      `SELECT source, started_at, finished_at, found, created, error FROM ingest_runs
       WHERE id IN (SELECT MAX(id) FROM ingest_runs GROUP BY source)`,
    )
    .all();
}
