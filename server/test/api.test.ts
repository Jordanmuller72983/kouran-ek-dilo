import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

// Isolated data dir per run; must be set before the app modules load.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'ked-'));
process.env.ADMIN_TOKEN = 'test-admin';

const { app } = await import('../src/index.ts');
const { upsertOutage } = await import('../src/store.ts');
const { dispatchPending } = await import('../src/notify/dispatcher.ts');

let base = '';
let server: ReturnType<typeof app.listen>;
before(() => new Promise<void>((resolve) => {
  server = app.listen(0, () => {
    base = `http://localhost:${(server.address() as AddressInfo).port}/api`;
    resolve();
  });
}));
after(() => server.close());

async function call(method: string, url: string, body?: unknown, admin = false) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(admin ? { Authorization: 'Bearer test-admin' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: (await res.json()) as any };
}

const HOUR = 3_600_000;

describe('API', () => {
  it('lists localities by district', async () => {
    const { body } = await call('GET', '/localities');
    assert.equal(body.districts.length, 10);
    assert.ok(body.localities.find((l: any) => l.id === 'quatre-bornes' && l.district === 'plaines-wilhems'));
  });

  it('filters outages by locality, including national notices', async () => {
    const now = Date.now();
    upsertOutage({ utility: 'electricity', kind: 'planned', source: 'ceb', sourceRef: 't1', title: 'Quatre Bornes',
      details: 'Avenue Victoria', areaLabel: 'Quatre Bornes', district: 'plaines-wilhems', scope: 'locality',
      localities: ['quatre-bornes'], startsAt: now + HOUR, endsAt: now + 5 * HOUR });
    upsertOutage({ utility: 'electricity', kind: 'planned', source: 'ceb', sourceRef: 't2', title: 'Mahébourg',
      details: null, areaLabel: 'Mahébourg', district: 'grand-port', scope: 'locality',
      localities: ['mahebourg'], startsAt: now + HOUR, endsAt: now + 5 * HOUR });
    upsertOutage({ utility: 'water', kind: 'advisory', source: 'cwa', sourceRef: 't3', title: 'Island-wide reduction',
      details: null, areaLabel: null, district: null, scope: 'national', localities: [], startsAt: now - HOUR, endsAt: null,
      visibleFor: 7 * 24 * HOUR });

    const { body } = await call('GET', '/outages?locality=quatre-bornes');
    assert.deepEqual(body.outages.map((o: any) => o.title).sort(), ['Island-wide reduction', 'Quatre Bornes']);
    assert.equal(body.outages.find((o: any) => o.title === 'Quatre Bornes').status, 'upcoming');

    const water = await call('GET', '/outages?utility=water');
    assert.equal(water.body.outages.length, 1);
    assert.equal((await call('GET', '/outages?locality=atlantis')).status, 400);
  });

  it('runs the community report → moderation → feed flow', async () => {
    const bad = await call('POST', '/reports', { utility: 'water', locality: 'nowhere', description: 'No water' });
    assert.equal(bad.status, 400);

    const created = await call('POST', '/reports', { utility: 'water', locality: 'triolet', description: 'Pa ena dilo depi gramatin' });
    assert.equal(created.status, 201);

    assert.equal((await call('GET', '/admin/reports')).status, 401);
    const queue = await call('GET', '/admin/reports', undefined, true);
    assert.equal(queue.body.reports.length, 1);

    const approved = await call('POST', `/admin/reports/${created.body.id}/approve`, { notify: false }, true);
    assert.equal(approved.body.report.status, 'approved');

    const feed = await call('GET', '/outages?locality=triolet');
    const community = feed.body.outages.find((o: any) => o.source === 'community');
    assert.ok(community);
    assert.equal(community.status, 'ongoing');

    const first = await call('POST', `/outages/${community.id}/confirm`);
    const second = await call('POST', `/outages/${community.id}/confirm`);
    assert.equal(first.body.confirmations, 1);
    assert.equal(second.body.confirmations, 1, 'one confirmation per person');
  });

  it('verifies a WhatsApp subscriber by OTP and alerts them once', async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    try {
      const start = await call('POST', '/subscriptions/phone', {
        channel: 'whatsapp', phone: '5712 3456', localities: ['quatre-bornes'], lang: 'mfe',
      });
      assert.equal(start.status, 200);
      const code = logs.join('\n').match(/kod verifikasyon se (\d{6})/)![1];

      assert.equal((await call('POST', '/subscriptions/phone/verify', { channel: 'whatsapp', phone: '+23057123456', code: '000000' === code ? '111111' : '000000' })).status, 400);
      const ok = await call('POST', '/subscriptions/phone/verify', { channel: 'whatsapp', phone: '+23057123456', code });
      assert.equal(ok.status, 200);

      logs.length = 0;
      const stats = await dispatchPending();
      const sent = logs.filter((l) => l.startsWith('[whatsapp → +23057123456]'));
      // Quatre Bornes outage + national water advisory; not Mahébourg, not the Triolet report.
      assert.equal(sent.length, 2, logs.join('\n---\n'));
      assert.match(sent.join('\n'), /Koupir kouran – Quatre Bornes/);
      assert.ok(stats.sent >= 2);

      logs.length = 0;
      await dispatchPending();
      assert.equal(logs.filter((l) => l.startsWith('[whatsapp')).length, 0, 'no duplicate alerts');
    } finally {
      console.log = orig;
    }
  });

  it('alerts people who subscribe after a cut was already announced', async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(' ')); };
    try {
      await call('POST', '/subscriptions/phone', { channel: 'sms', phone: '5799 0000', localities: ['quatre-bornes'], lang: 'en' });
      const code = logs.join('\n').match(/verification code is (\d{6})/)![1];
      assert.equal((await call('POST', '/subscriptions/phone/verify', { channel: 'sms', phone: '57990000', code })).status, 200);
      logs.length = 0;
      await dispatchPending();
      const sent = logs.filter((l) => l.startsWith('[sms → +23057990000]'));
      // The Quatre Bornes cut and the island-wide advisory were dispatched earlier, before this person joined.
      assert.equal(sent.length, 2, logs.join('\n---\n'));
      assert.match(sent.join('\n'), /Power cut – Quatre Bornes/);
    } finally {
      console.log = orig;
    }
  });

  it('lets admins add notices seen on Facebook or radio', async () => {
    const res = await call('POST', '/admin/outages', {
      utility: 'water', title: 'Goodlands', localities: ['goodlands'], when: '20 October 2026 from 09:00 to 16:00',
    }, true);
    assert.equal(res.status, 201);
    assert.equal(res.body.outage.endsAt, '2026-10-20T12:00:00.000Z');
  });
});
