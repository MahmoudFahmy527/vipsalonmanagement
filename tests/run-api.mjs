#!/usr/bin/env node
/**
 * Tier 1 API suite (browserless), following UNIFIED_TESTING_GUIDELINE adapted to
 * this Node/Express/SQLite stack:
 *  - Seed as ADMIN; assert public flows as an ANONYMOUS actor (no admin cookie).
 *  - "Green ×2": the whole suite runs twice on the same server/DB; both must pass.
 *  - Per-run unique tokens/phones so re-runs don't collide.
 * Spawns its own server on a throwaway DB + ephemeral port. Exit non-zero on any fail.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 4070 + Math.floor(Math.random() * 400);
const BASE = `http://localhost:${PORT}`;
const ADMIN_PASS = 'test-admin-pass';
const dbDir = mkdtempSync(join(tmpdir(), 'salon-test-'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) { pass++; }
  else { fail++; fails.push(`${name}${detail ? ' — ' + detail : ''}`); console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

async function api(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers['Cookie'] = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

async function adminCookie() {
  const res = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: ADMIN_PASS }),
  });
  const sc = res.headers.get('set-cookie') || '';
  return sc.split(';')[0];
}

async function waitReady(tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(BASE + '/healthz'); if (r.ok) return true; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('server did not become ready');
}

// One full pass of the suite (called twice for green ×2).
async function runSuite(run) {
  const tag = `${Date.now()}_${run}`;                // unique per run
  const admin = await adminCookie();

  // ── Identities: public flows must be blocked without the admin cookie ──
  ok('anon blocked from admin bookings', (await api('/api/admin/bookings/2026-12-01')).status === 401);
  ok('anon blocked from CSV export', (await api('/api/admin/bookings.csv')).status === 401);
  ok('wrong password rejected', (await api('/api/login', { method: 'POST', body: { username: 'admin', password: 'nope' } })).status === 401);
  ok('admin cookie obtained', !!admin);

  // ── Seed: branch + staff + service (as admin) ──
  const br = (await api('/api/admin/branches', { method: 'POST', cookie: admin, body: { name: 'فرع_' + tag } })).json;
  ok('branch created', br && br.success, JSON.stringify(br));
  const branchId = br.branch.id;
  const ba = (await api('/api/admin/barbers', { method: 'POST', cookie: admin, body: { name: 'حلاق_' + tag, branch_id: branchId } })).json;
  ok('barber created at branch', ba && ba.success);
  const barberId = ba.barber.id;
  const sv = (await api('/api/admin/services', { method: 'POST', cookie: admin, body: { name: 'خدمة_' + tag, price: 100, duration: 60 } })).json;
  ok('service created', sv && sv.success);
  const serviceId = sv.service.id;

  // ── QR deep-link relies on: barber carries its branch, publicly ──
  const pubBarbers = (await api(`/api/barbers?branch=${branchId}`)).json;
  const found = pubBarbers.find((b) => b.id === barberId);
  ok('public barber lists under its branch (QR target)', !!found);
  ok('barber exposes branch_id for the deep-link', found && found.branch_id === branchId);

  // ── Booking as ANON with branch+barber (walk-in QR path) ──
  const token = 'tok_' + tag;
  const bookDate = '2026-12-15';
  const bk = await api('/api/book', { method: 'POST', body: {
    customer_name: 'زبون_' + tag, customer_phone: '0100' + run + '0000',
    service_id: serviceId, barber_id: barberId, branch_id: branchId,
    date: bookDate, time_slot: '14:00', customer_token: token,
  }});
  ok('anon booking with locked barber+branch → 201', bk.status === 201, `got ${bk.status}`);
  ok('booking echoes the branch', bk.json && bk.json.booking && bk.json.booking.branch_id === branchId);

  // ── CSV export (admin) ──
  const csv = await api('/api/admin/bookings.csv', { cookie: admin });
  ok('CSV export 200', csv.status === 200);
  ok('CSV content-type', /text\/csv/.test(csv.headers.get('content-type') || ''));
  // .text() strips the BOM, so verify the raw bytes are EF BB BF.
  const csvBytes = new Uint8Array(await (await fetch(BASE + '/api/admin/bookings.csv', { headers: { Cookie: admin } })).arrayBuffer());
  ok('CSV starts with UTF-8 BOM (Excel Arabic)', csvBytes[0] === 0xEF && csvBytes[1] === 0xBB && csvBytes[2] === 0xBF);
  ok('CSV has header row', csv.text.includes('التاريخ') && csv.text.includes('الهاتف'));
  ok('CSV includes the seeded booking', csv.text.includes('زبون_' + tag));

  // ── Service presets ──
  const imp1 = await api('/api/admin/services/import-presets', { method: 'POST', cookie: admin, body: { type: 'spa' } });
  ok('import presets 200', imp1.status === 200);
  // Run-stable: assert the preset menu is present (not the per-run "added" count,
  // which is 0 on the second green ×2 pass because presets are idempotent by name).
  const svcNames = (await api('/api/services')).json.map((s) => s.name);
  ok('spa preset menu present publicly', svcNames.some((n) => n.includes('مساج استرخائي')) && svcNames.some((n) => n.includes('ريفلكسولوجي')));
  const imp2 = await api('/api/admin/services/import-presets', { method: 'POST', cookie: admin, body: { type: 'spa' } });
  ok('re-import is idempotent (added 0)', imp2.json && imp2.json.added === 0);
  ok('anon blocked from importing presets', (await api('/api/admin/services/import-presets', { method: 'POST', body: { type: 'spa' } })).status === 401);

  // ── Loyalty ──
  // enable with a small target
  await api('/api/admin/settings', { method: 'PUT', cookie: admin, body: { key: 'loyalty_enabled', value: '1' } });
  await api('/api/admin/settings', { method: 'PUT', cookie: admin, body: { key: 'loyalty_target', value: '3' } });
  const ltok = 'loy_' + tag;
  // three bookings for this token, all accepted
  for (let i = 0; i < 3; i++) {
    const b = await api('/api/book', { method: 'POST', body: {
      customer_name: 'وفيّ_' + tag, customer_phone: '0111' + run + i + '000',
      service_id: serviceId, barber_id: barberId, branch_id: branchId,
      date: '2026-12-2' + i, time_slot: '1' + (5 + i) + ':00', customer_token: ltok,
    }});
    await api(`/api/admin/bookings/${b.json.booking.id}`, { method: 'PUT', cookie: admin, body: { status: 'accepted' } });
  }
  const loy = (await api(`/api/loyalty?token=${ltok}`)).json;
  ok('loyalty enabled + reports visits', loy.enabled && loy.visits === 3, JSON.stringify(loy));
  ok('loyalty reward due at target', loy.rewardDue === true && loy.progress === 3);
  ok('loyalty endpoint is public (anon)', loy.enabled === true);

  // ── Finance: comp model, income/expenses, P&L, per-staff profitability ──
  // Give the seeded barber a commission + monthly salary.
  const upd = await api(`/api/admin/barbers/${barberId}`, { method: 'PUT', cookie: admin, body: {
    name: 'حلاق_' + tag, branch_id: branchId,
    commission_enabled: 1, commission_pct: 40, salary_type: 'monthly', salary_amount: 3000,
  }});
  ok('barber comp saved', upd.status === 200);
  const decFrom = '2026-12-01', decTo = '2026-12-31';
  // Manual income + a gov expense attributed to the barber.
  const inc = await api('/api/admin/income', { method: 'POST', cookie: admin, body: { amount: 500, date: '2026-12-10', category: 'retail', note: 'بيع_' + tag } });
  ok('add income 201', inc.status === 201);
  const exp = await api('/api/admin/expenses', { method: 'POST', cookie: admin, body: { amount: 200, date: '2026-12-10', category: 'gov', note: 'إقامة_' + tag, barber_id: barberId } });
  ok('add gov expense 201', exp.status === 201);

  const fin = (await api(`/api/admin/finance?from=${decFrom}&to=${decTo}`, { cookie: admin })).json;
  ok('finance summary shape', fin && fin.revenue && fin.expenses && typeof fin.netProfit === 'number', JSON.stringify(fin && fin.revenue));
  // The 3 loyalty bookings (accepted, price 100) → ≥300 booking revenue per run.
  ok('booking revenue counts accepted bookings', fin.revenue.bookings >= 300, `got ${fin.revenue.bookings}`);
  ok('manual income reflected', fin.revenue.manual >= 500, `got ${fin.revenue.manual}`);
  ok('revenue total = bookings + manual', Math.abs(fin.revenue.total - (fin.revenue.bookings + fin.revenue.manual)) < 0.01);
  ok('gov expense in "other" bucket', fin.expenses.other >= 200, `got ${fin.expenses.other}`);
  ok('labor (salary+commission) computed', fin.expenses.labor > 0, `got ${fin.expenses.labor}`);
  const row = (fin.byBarber || []).find((b) => b.id === barberId);
  ok('per-barber profitability row present', !!row, JSON.stringify(fin.byBarber));
  ok('commission = 40% of that barber revenue', row && Math.abs(row.commission - row.revenue * 0.4) < 0.01, row && `${row.commission} vs ${row.revenue * 0.4}`);
  ok('monthly salary prorated (>0)', row && row.salary > 0, row && `salary ${row.salary}`);
  ok('barber gov expense attributed', row && row.govExpenses >= 200, row && `gov ${row.govExpenses}`);
  ok('net profit = revenue - labor - other', Math.abs(fin.netProfit - (fin.revenue.total - fin.expenses.labor - fin.expenses.other)) < 0.01);
  // Range filter excludes out-of-range data.
  const finEmpty = (await api('/api/admin/finance?from=2099-01-01&to=2099-12-31', { cookie: admin })).json;
  ok('empty range → zero revenue', finEmpty.revenue.bookings === 0 && finEmpty.revenue.manual === 0);
  // Anon lockout on every finance surface.
  ok('anon blocked from finance summary', (await api(`/api/admin/finance?from=${decFrom}&to=${decTo}`)).status === 401);
  ok('anon blocked from add income', (await api('/api/admin/income', { method: 'POST', body: { amount: 1, date: decFrom } })).status === 401);
  ok('anon blocked from add expense', (await api('/api/admin/expenses', { method: 'POST', body: { amount: 1, date: decFrom } })).status === 401);
  // Staff portal magic link is generated and stable.
  const pl1 = (await api(`/api/admin/barbers/${barberId}/portal-link`, { cookie: admin })).json;
  ok('portal link issued', pl1 && typeof pl1.token === 'string' && pl1.path.includes(pl1.token));
  const pl2 = (await api(`/api/admin/barbers/${barberId}/portal-link`, { cookie: admin })).json;
  ok('portal link stable across calls', pl2 && pl2.token === pl1.token);
  ok('anon blocked from portal link', (await api(`/api/admin/barbers/${barberId}/portal-link`)).status === 401);

  // ── Staff portal: magic-link auth + own-data scoping ──
  const staffToken = pl1.token;
  // Consume the magic link; capture the session cookie from the redirect.
  const magic = await fetch(BASE + `/staff?t=${staffToken}`, { redirect: 'manual' });
  const staffCookie = (magic.headers.get('set-cookie') || '').split(';')[0];
  ok('magic link establishes a staff session', [301, 302, 303].includes(magic.status) && !!staffCookie, `status ${magic.status}`);
  const me = await api('/api/staff/me', { cookie: staffCookie });
  ok('staff/me returns own identity', me.status === 200 && me.json.barber.id === barberId, JSON.stringify(me.json));
  const sbk = await api('/api/staff/bookings', { cookie: staffCookie });
  ok('staff sees own bookings', sbk.status === 200 && Array.isArray(sbk.json));
  ok('staff bookings include accepted sessions', sbk.json.filter((b) => b.status === 'accepted').length >= 3);
  const sinc = (await api(`/api/staff/income?from=${decFrom}&to=${decTo}`, { cookie: staffCookie })).json;
  ok('staff income breakdown scoped to self', sinc && sinc.id === barberId && sinc.revenue >= 300 && sinc.earnings > 0, JSON.stringify(sinc));
  ok('staff earnings = commission + salary', sinc && Math.abs(sinc.earnings - (sinc.commission + sinc.salary)) < 0.01);
  // Attributed review shows up in the staff's own review list.
  await api('/api/reviews', { method: 'POST', body: { name: 'مقيّم_' + tag, rating: 5, review_text: 'ممتاز', barber_id: barberId } });
  const srev = (await api('/api/staff/reviews', { cookie: staffCookie })).json;
  ok('staff sees own attributed reviews', Array.isArray(srev) && srev.some((r) => r.rating === 5));
  // Gallery: own list + ownership-guarded delete.
  ok('staff gallery lists (own only)', Array.isArray((await api('/api/staff/gallery', { cookie: staffCookie })).json));
  ok('staff cannot delete a non-owned gallery item', (await api('/api/staff/gallery/999999', { method: 'DELETE', cookie: staffCookie })).status === 404);
  // Anon lockout on every staff surface.
  ok('anon blocked from staff/me', (await api('/api/staff/me')).status === 401);
  ok('anon blocked from staff bookings', (await api('/api/staff/bookings')).status === 401);
  ok('anon blocked from staff income', (await api('/api/staff/income')).status === 401);
  ok('anon blocked from staff gallery', (await api('/api/staff/gallery')).status === 401);
  // An invalid magic token grants nothing.
  const badMagic = await fetch(BASE + '/staff?t=not_a_real_token', { redirect: 'manual' });
  const badCookie = (badMagic.headers.get('set-cookie') || '').split(';')[0];
  ok('invalid magic token → no staff access', (await api('/api/staff/me', { cookie: badCookie })).status === 401);
  // Logout ends the staff session.
  await api('/api/staff/logout', { method: 'POST', cookie: staffCookie });
  ok('staff logout revokes access', (await api('/api/staff/me', { cookie: staffCookie })).status === 401);

  // ── Privacy parity: public settings must not leak private keys ──
  const pub = (await api('/api/settings')).json;
  ok('public settings hide telegram token', !('telegram_bot_token' in pub));
  ok('public settings hide vapid private', !('vapid_private' in pub));
  ok('public settings expose loyalty (storefront needs it)', pub.loyalty_target === '3');
  ok('public settings expose staff_label (vertical wording)', typeof pub.staff_label === 'string');
}

// ── Boot server, run suite twice, report ──
const srv = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(PORT), DB_PATH: join(dbDir, 'salon.db'), UPLOAD_DIR: join(dbDir, 'up'), NODE_ENV: 'development', ADMIN_PASSWORD: ADMIN_PASS, SESSION_SECRET: 'test-secret' },
  stdio: ['ignore', 'ignore', 'inherit'],
});

let exitCode = 0;
try {
  await waitReady();
  for (const run of [1, 2]) {                        // green ×2
    console.log(`\n═══ API suite — run ${run}/2 ═══`);
    const before = fail;
    await runSuite(run);
    console.log(`  run ${run}: ${fail === before ? 'green' : 'RED'}`);
  }
  console.log(`\nAPI RESULT: PASS=${pass} FAIL=${fail}`);
  if (fail) { console.log('FAILURES:\n - ' + fails.join('\n - ')); exitCode = 1; }
} catch (e) {
  console.error('harness error:', e.message);
  exitCode = 1;
} finally {
  srv.kill();
  try { rmSync(dbDir, { recursive: true, force: true }); } catch {}
}
process.exit(exitCode);
