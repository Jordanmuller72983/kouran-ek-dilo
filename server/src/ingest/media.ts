import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { config } from '../config.ts';
import { db } from '../db.ts';

// Poster thumbnails for communiqués. CWA publishes most notices as designed PDF posters,
// so we render the first page to a small JPEG that the feed can show next to each item.

export const MEDIA_DIR = path.join(config.dataDir, 'media');
const WIDTH = 640;
const MAX_BYTES = 15 * 1024 * 1024;

const require = createRequire(import.meta.url);
const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: { 'User-Agent': config.userAgent }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('file too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('file too large');
  return buf;
}

export async function renderPdfFirstPage(pdf: Buffer): Promise<Buffer> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), isEvalSupported: false, standardFontDataUrl, verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: WIDTH / page.getViewport({ scale: 1 }).width });
    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js expects a DOM 2D context; @napi-rs/canvas implements the same API.
    await page.render({ canvasContext: ctx as never, viewport }).promise;
    return canvas.encode('jpeg', 80);
  } finally {
    await doc.destroy();
  }
}

async function resizeImage(img: Buffer): Promise<Buffer> {
  const image = await loadImage(img);
  const scale = Math.min(1, WIDTH / image.width);
  const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.encode('jpeg', 80);
}

/** Create thumbnails for communiqués that don't have one yet. Each item is attempted once. */
export async function generateThumbnails(limit = 40): Promise<{ created: number; failed: number }> {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const rows = db
    .prepare(
      `SELECT id, attachment_url, image_source FROM outages
       WHERE image_url IS NULL AND image_checked_at IS NULL AND (attachment_url IS NOT NULL OR image_source IS NOT NULL)
       ORDER BY starts_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; attachment_url: string | null; image_source: string | null }>;

  const stats = { created: 0, failed: 0 };
  for (const row of rows) {
    let thumb: Buffer | null = null;
    try {
      const att = row.attachment_url ?? '';
      if (/\.pdf(\?|$)/i.test(att)) thumb = await renderPdfFirstPage(await download(att));
      else if (/\.(jpe?g|png|webp)(\?|$)/i.test(att)) thumb = await resizeImage(await download(att));
      else if (row.image_source) thumb = await resizeImage(await download(row.image_source));
    } catch (err) {
      stats.failed++;
      console.error(`[media] outage ${row.id}:`, (err as Error).message);
    }
    if (thumb) {
      writeFileSync(path.join(MEDIA_DIR, `${row.id}.jpg`), thumb);
      stats.created++;
    }
    db.prepare('UPDATE outages SET image_url = ?, image_checked_at = ? WHERE id = ?').run(
      thumb ? `/media/${row.id}.jpg` : null, Date.now(), row.id,
    );
  }
  return stats;
}
