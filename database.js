const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const DB_FILE = process.env.DB_PATH || path.join(__dirname, 'salon.db');

// Ensure the database directory exists (e.g. a freshly-mounted /data volume
// on Railway/Render) so better-sqlite3 can create the file.
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ──────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS services (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    name_en     TEXT    DEFAULT '',
    price       REAL    NOT NULL,
    duration    INTEGER DEFAULT 60,
    description TEXT    DEFAULT '',
    category    TEXT    DEFAULT 'other',
    is_active   INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS branches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    address     TEXT    DEFAULT '',
    phone       TEXT    DEFAULT '',
    map_url     TEXT    DEFAULT '',
    work_days   TEXT    DEFAULT '',   -- '' = every day; else CSV of 0..6
    off_dates   TEXT    DEFAULT '',   -- CSV of YYYY-MM-DD
    work_start  INTEGER,              -- null = inherit salon hours
    work_end    INTEGER,
    is_active   INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS barbers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    specialty   TEXT    DEFAULT '',
    is_active   INTEGER DEFAULT 1,
    sort_order  INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_name  TEXT    NOT NULL,
    customer_phone TEXT    NOT NULL,
    service_id     INTEGER,
    barber_id      INTEGER,
    date           TEXT    NOT NULL,
    time_slot      TEXT    NOT NULL,
    duration       INTEGER DEFAULT 60,
    status         TEXT    DEFAULT 'pending',
    note           TEXT,
    created_at     TEXT    DEFAULT (datetime('now')),
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS gallery (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    filename      TEXT    NOT NULL,
    original_name TEXT,
    type          TEXT    NOT NULL,
    description   TEXT    DEFAULT '',
    created_at    TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,
    rating      INTEGER NOT NULL,
    review_text TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    sub        TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- Manual income entries (walk-ins, tips, retail). Booking revenue is computed
  -- live from accepted bookings, so it is NOT duplicated here.
  CREATE TABLE IF NOT EXISTS income (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    amount     REAL    NOT NULL,
    date       TEXT    NOT NULL,
    category   TEXT    DEFAULT 'other',
    note       TEXT    DEFAULT '',
    branch_id  INTEGER,
    barber_id  INTEGER,
    created_at TEXT    DEFAULT (datetime('now'))
  );

  -- Expenses: rent, supplies, and per-staff costs (gov fees like iqama/insurance).
  -- Staff salary/commission are computed from their config, NOT stored here.
  CREATE TABLE IF NOT EXISTS expenses (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    amount     REAL    NOT NULL,
    date       TEXT    NOT NULL,
    category   TEXT    DEFAULT 'other',
    note       TEXT    DEFAULT '',
    branch_id  INTEGER,
    barber_id  INTEGER,
    created_at TEXT    DEFAULT (datetime('now'))
  );
`);

// ──────────────────────────────────────────────
// Lightweight migrations — add columns to existing
// databases without dropping data.
// ──────────────────────────────────────────────

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Per-device customer token → lets a returning customer be recognised and see
// their own bookings, without accounts or exposing phone numbers publicly.
ensureColumn('bookings', 'customer_token', 'TEXT');
// Which barber the booking is for (null = salon doesn't use barbers).
ensureColumn('bookings', 'barber_id', 'INTEGER');
// Which branch the booking / staff member belongs to (null = single-branch salon).
ensureColumn('bookings', 'branch_id', 'INTEGER');
ensureColumn('barbers', 'branch_id', 'INTEGER');
// Per-barber schedule. work_days = comma list of weekday numbers (0=Sun..6=Sat),
// empty = every day. off_dates = comma list of YYYY-MM-DD the barber is off.
// work_start/work_end = optional per-barber hours that override the salon window.
ensureColumn('barbers', 'work_days', "TEXT DEFAULT ''");
ensureColumn('barbers', 'off_dates', "TEXT DEFAULT ''");
ensureColumn('barbers', 'work_start', 'INTEGER');
ensureColumn('barbers', 'work_end', 'INTEGER');
// Barber compensation (for profitability): commission (optional %) and/or a
// salary paid hourly/daily/monthly. Gov/other per-barber costs live in expenses.
ensureColumn('barbers', 'commission_enabled', 'INTEGER DEFAULT 0');
ensureColumn('barbers', 'commission_pct', 'REAL DEFAULT 0');
ensureColumn('barbers', 'salary_type', "TEXT DEFAULT 'none'");   // none|hourly|daily|monthly
ensureColumn('barbers', 'salary_amount', 'REAL DEFAULT 0');
// Staff portal access — a random token shared as a magic link (/staff?t=…).
ensureColumn('barbers', 'portal_token', 'TEXT');
// Gallery moderation: admin uploads are 'approved'; customer submissions land
// as 'pending' until the owner approves them.
ensureColumn('gallery', 'status', "TEXT DEFAULT 'approved'");
ensureColumn('gallery', 'submitter_name', 'TEXT');
// Staff portal: gallery items and reviews can be attributed to a specific staff member.
ensureColumn('gallery', 'barber_id', 'INTEGER');
ensureColumn('reviews', 'barber_id', 'INTEGER');

// ──────────────────────────────────────────────
// Default (white-label) settings — seeded once.
// Every one of these is editable from the admin
// panel / setup wizard, so a new salon is branded
// without touching a single line of code.
// ──────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  salon_name:       'صالونك',
  salon_name_en:    'YOUR SALON',
  tagline:          'أناقتك تبدأ من عندنا — خبرة، دقة، وأسلوب يليق بك',
  home_description: 'أناقتك تبدأ من عندنا — خبرة، دقة، وأسلوب يليق بك',
  brand_color:      '#c9a84c',
  currency:         'ج.م',
  logo_emoji:       '✂️',
  phone:            '',
  whatsapp:         '',        // digits only, incl. country code e.g. 201001234567
  address:          '',
  instagram:        '',
  tiktok:           '',
  facebook:         '',
  hero_image:       '',        // URL/path; empty → gradient fallback
  // Vertical / terminology. Labels are stored BARE (no "ال"); the UI adds it.
  business_type:      'barbershop', // barbershop | beauty | spa | custom
  staff_label:        'حلاق',       // singular: حلاق / مصفف / معالج
  staff_label_plural: 'حلاقين',     // plural:   حلاقين / مصففين / معالجين
  staff_icon:         '✂️',
  instagram_posts:  '',        // newline/comma list of IG post URLs → official embeds
  instagram_embed:  '',        // raw widget embed code (Behold/LightWidget/…) → auto feed
  telegram_bot_token: '',      // owner's Telegram bot token (kept out of public settings)
  telegram_chat_id: '',        // owner's Telegram chat id
  // Loyalty punch card
  loyalty_enabled: '0',        // '1' turns it on
  loyalty_target:  '10',       // visits needed for a reward
  loyalty_reward:  'خدمة مجانية 🎁',
  // Salon-wide opening schedule (24h clock; close may cross midnight).
  open_hour:        '',        // '' → fall back to config/env SLOT_START_HOUR
  close_hour:       '',        // '' → fall back to config/env SLOT_END_HOUR
  closed_days:      '',        // comma weekday numbers 0=Sun..6=Sat the salon is closed
  closed_dates:     '',        // comma YYYY-MM-DD holidays
  configured:       '0',       // '1' once the setup wizard is completed
};

const seedSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
  seedSetting.run(key, value);
}

// ──────────────────────────────────────────────
// Booking helpers
// ──────────────────────────────────────────────

/**
 * Non-rejected bookings for a date, scoped to the narrowest calendar:
 *  - barberId  → just that barber's bookings (a barber belongs to one branch,
 *                so this is already branch-specific).
 *  - branchId  → that branch's bookings (branch without per-staff calendars).
 *  - neither   → every booking that day (legacy single-calendar salon).
 * This is what keeps branches/barbers from blocking each other's slots.
 */
const isSet = (v) => v !== undefined && v !== null && v !== '';

function getSlotsByDate(date, barberId, branchId) {
  if (isSet(barberId)) {
    return db
      .prepare(
        `SELECT * FROM bookings
         WHERE date = ? AND status != 'rejected' AND barber_id = ?
         ORDER BY time_slot`
      )
      .all(date, Number(barberId));
  }
  if (isSet(branchId)) {
    return db
      .prepare(
        `SELECT * FROM bookings
         WHERE date = ? AND status != 'rejected' AND branch_id = ?
         ORDER BY time_slot`
      )
      .all(date, Number(branchId));
  }
  return db
    .prepare(
      `SELECT * FROM bookings
       WHERE date = ? AND status != 'rejected'
       ORDER BY time_slot`
    )
    .all(date);
}

/**
 * Insert a new booking and return the created row.
 */
function createBooking({ customer_name, customer_phone, service_id, barber_id, branch_id, date, time_slot, duration, status, note, customer_token }) {
  const stmt = db.prepare(
    `INSERT INTO bookings (customer_name, customer_phone, service_id, barber_id, branch_id, date, time_slot, duration, status, note, customer_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    customer_name,
    customer_phone,
    service_id || null,
    barber_id || null,
    branch_id || null,
    date,
    time_slot,
    duration || 60,
    status || 'pending',
    note || null,
    customer_token || null,
    new Date().toISOString()
  );
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * All bookings tied to a device token (a customer's "my bookings"),
 * newest appointment first, with the service name joined in.
 */
function getBookingsByToken(token) {
  return db
    .prepare(
      `SELECT b.id, b.customer_name, b.date, b.time_slot, b.duration, b.status, b.created_at,
              s.name AS service_name, s.price AS service_price
       FROM bookings b
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.customer_token = ?
       ORDER BY b.date DESC, b.time_slot DESC`
    )
    .all(token);
}

// Completed (accepted) visits — used for the loyalty punch card.
function countAcceptedByToken(token) {
  if (!token) return 0;
  return db.prepare("SELECT COUNT(*) n FROM bookings WHERE customer_token = ? AND status = 'accepted'").get(token).n;
}
function countAcceptedByPhone(phone) {
  if (!phone || phone === '-') return 0;
  return db.prepare("SELECT COUNT(*) n FROM bookings WHERE customer_phone = ? AND status = 'accepted'").get(phone).n;
}

/**
 * Has this phone booked before the given booking id? Used to flag
 * returning customers for the admin. Ignores rejected bookings.
 */
function isReturningCustomer(phone, excludeId) {
  if (!phone || phone === '-') return false;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM bookings
       WHERE customer_phone = ? AND id < ? AND status != 'rejected'`
    )
    .get(phone, excludeId || Number.MAX_SAFE_INTEGER);
  return row.n > 0;
}

/**
 * Update booking status (pending / accepted / rejected / reserved).
 */
function updateBookingStatus(id, status) {
  return db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, id);
}

/**
 * Edit a booking's scheduled time and duration.
 */
function updateBookingTime(id, date, time_slot, duration) {
  return db
    .prepare('UPDATE bookings SET date = ?, time_slot = ?, duration = ? WHERE id = ?')
    .run(date, time_slot, duration, id);
}

/**
 * Delete a booking by id.
 */
function deleteBooking(id) {
  return db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
}

// ──────────────────────────────────────────────
// Gallery helpers
// ──────────────────────────────────────────────

// Admin view — every item, pending first so submissions are easy to moderate.
function getAllGallery() {
  return db
    .prepare("SELECT * FROM gallery ORDER BY (status = 'pending') DESC, created_at DESC")
    .all();
}

// Public view — only approved items.
function getPublicGallery() {
  return db
    .prepare("SELECT * FROM gallery WHERE status = 'approved' ORDER BY created_at DESC")
    .all();
}

function countPendingGallery() {
  return db.prepare("SELECT COUNT(*) AS n FROM gallery WHERE status = 'pending'").get().n;
}

function addGalleryItem({ filename, original_name, type, description, status, submitter_name, barber_id }) {
  const stmt = db.prepare(
    `INSERT INTO gallery (filename, original_name, type, description, status, submitter_name, barber_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    filename,
    original_name || '',
    type,
    description || '',
    status || 'approved',
    submitter_name || null,
    barber_id || null,
    new Date().toISOString()
  );
  return db.prepare('SELECT * FROM gallery WHERE id = ?').get(info.lastInsertRowid);
}

// Gallery items belonging to one staff member (their own portfolio).
function getGalleryByBarber(barberId) {
  return db
    .prepare("SELECT * FROM gallery WHERE barber_id = ? ORDER BY (status = 'pending') DESC, created_at DESC")
    .all(Number(barberId));
}

// Delete a gallery item only if it belongs to this staff member; returns the
// filename (for disk cleanup) or null when not owned / not found.
function deleteGalleryItemOwned(id, barberId) {
  const row = db.prepare('SELECT filename FROM gallery WHERE id = ? AND barber_id = ?').get(Number(id), Number(barberId));
  if (!row) return null;
  db.prepare('DELETE FROM gallery WHERE id = ? AND barber_id = ?').run(Number(id), Number(barberId));
  return row.filename;
}

function approveGalleryItem(id) {
  return db.prepare("UPDATE gallery SET status = 'approved' WHERE id = ?").run(id);
}

function updateGalleryDescription(id, description) {
  return db.prepare('UPDATE gallery SET description = ? WHERE id = ?').run(description, id);
}

/**
 * Delete a gallery item and return the filename so the caller can remove the
 * physical file from disk.
 */
function deleteGalleryItem(id) {
  const row = db.prepare('SELECT filename FROM gallery WHERE id = ?').get(id);
  db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
  return row ? row.filename : null;
}

// ──────────────────────────────────────────────
// Shared schedule logic (branches and barbers both use
// work_days / off_dates / work_start / work_end)
// ──────────────────────────────────────────────

/**
 * Is this entity (branch or barber) open/working on a date? Considers its
 * days-off list and its working weekdays (empty work_days = every day).
 */
function entityWorksOn(entity, dateStr) {
  if (!entity) return false;
  const off = String(entity.off_dates || '').split(',').map(s => s.trim()).filter(Boolean);
  if (off.includes(dateStr)) return false;
  const days = String(entity.work_days || '').split(',').map(s => s.trim()).filter(Boolean);
  if (days.length) {
    const dow = new Date(dateStr + 'T00:00:00').getDay(); // 0=Sun..6=Sat
    if (!days.includes(String(dow))) return false;
  }
  return true;
}

function normHour(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ──────────────────────────────────────────────
// Branch helpers
// ──────────────────────────────────────────────

function getActiveBranches() {
  return db.prepare('SELECT * FROM branches WHERE is_active = 1 ORDER BY sort_order, id').all();
}

function getAllBranches() {
  return db.prepare('SELECT * FROM branches ORDER BY sort_order, id').all();
}

function getBranch(id) {
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(id);
}

const branchWorksOn = entityWorksOn;

function createBranch({ name, address, phone, map_url, sort_order, work_days, off_dates, work_start, work_end }) {
  const info = db
    .prepare(`INSERT INTO branches (name, address, phone, map_url, sort_order, work_days, off_dates, work_start, work_end, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, address || '', phone || '', map_url || '', sort_order || 0,
         work_days || '', off_dates || '', normHour(work_start), normHour(work_end), new Date().toISOString());
  return db.prepare('SELECT * FROM branches WHERE id = ?').get(info.lastInsertRowid);
}

function updateBranch(id, { name, address, phone, map_url, sort_order, work_days, off_dates, work_start, work_end }) {
  return db
    .prepare(`UPDATE branches SET name = ?, address = ?, phone = ?, map_url = ?, sort_order = ?,
              work_days = ?, off_dates = ?, work_start = ?, work_end = ? WHERE id = ?`)
    .run(name, address || '', phone || '', map_url || '', sort_order || 0,
         work_days || '', off_dates || '', normHour(work_start), normHour(work_end), id);
}

function toggleBranch(id) {
  return db
    .prepare('UPDATE branches SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?')
    .run(id);
}

// Deleting a branch detaches its staff/bookings rather than orphaning them.
function deleteBranch(id) {
  db.prepare('UPDATE barbers SET branch_id = NULL WHERE branch_id = ?').run(id);
  return db.prepare('DELETE FROM branches WHERE id = ?').run(id);
}

// ──────────────────────────────────────────────
// Barber helpers
// ──────────────────────────────────────────────

// Active barbers, optionally only those at one branch.
function getActiveBarbers(branchId) {
  if (isSet(branchId)) {
    return db
      .prepare('SELECT * FROM barbers WHERE is_active = 1 AND branch_id = ? ORDER BY sort_order, id')
      .all(Number(branchId));
  }
  return db.prepare('SELECT * FROM barbers WHERE is_active = 1 ORDER BY sort_order, id').all();
}

function getAllBarbers() {
  return db.prepare(
    `SELECT b.*, br.name AS branch_name FROM barbers b
     LEFT JOIN branches br ON b.branch_id = br.id
     ORDER BY b.sort_order, b.id`
  ).all();
}

function getBarber(id) {
  return db.prepare('SELECT * FROM barbers WHERE id = ?').get(id);
}

function getBarberByToken(token) {
  if (!token) return null;
  return db.prepare('SELECT * FROM barbers WHERE portal_token = ?').get(token);
}

// Generate (once) and return a barber's staff-portal magic-link token.
function ensureBarberToken(id) {
  const b = getBarber(id);
  if (!b) return null;
  if (b.portal_token) return b.portal_token;
  const token = 's_' + crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE barbers SET portal_token = ? WHERE id = ?').run(token, id);
  return token;
}

const barberWorksOn = entityWorksOn;

const compFields = (b) => [
  b.commission_enabled ? 1 : 0,
  Number(b.commission_pct) || 0,
  ['none', 'hourly', 'daily', 'monthly'].includes(b.salary_type) ? b.salary_type : 'none',
  Number(b.salary_amount) || 0,
];

function createBarber(b) {
  const info = db
    .prepare(`INSERT INTO barbers (name, specialty, sort_order, work_days, off_dates, work_start, work_end, branch_id,
              commission_enabled, commission_pct, salary_type, salary_amount, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(b.name, b.specialty || '', b.sort_order || 0, b.work_days || '', b.off_dates || '',
         normHour(b.work_start), normHour(b.work_end), b.branch_id || null,
         ...compFields(b), new Date().toISOString());
  return db.prepare('SELECT * FROM barbers WHERE id = ?').get(info.lastInsertRowid);
}

function updateBarber(id, b) {
  return db
    .prepare(`UPDATE barbers SET name = ?, specialty = ?, sort_order = ?,
              work_days = ?, off_dates = ?, work_start = ?, work_end = ?, branch_id = ?,
              commission_enabled = ?, commission_pct = ?, salary_type = ?, salary_amount = ? WHERE id = ?`)
    .run(b.name, b.specialty || '', b.sort_order || 0, b.work_days || '', b.off_dates || '',
         normHour(b.work_start), normHour(b.work_end), b.branch_id || null,
         ...compFields(b), id);
}

// Staff self-service: update ONLY the fields a staff member may change about
// themselves (specialty + schedule). Name, branch, comp, and active status stay
// admin-controlled and are never touched here.
function updateBarberProfile(id, p) {
  return db
    .prepare(`UPDATE barbers SET specialty = ?, work_days = ?, work_start = ?, work_end = ? WHERE id = ?`)
    .run(p.specialty || '', p.work_days || '', normHour(p.work_start), normHour(p.work_end), Number(id));
}

function toggleBarber(id) {
  return db
    .prepare('UPDATE barbers SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?')
    .run(id);
}

function deleteBarber(id) {
  return db.prepare('DELETE FROM barbers WHERE id = ?').run(id);
}

// ──────────────────────────────────────────────
// Finance helpers (income / expenses / revenue)
// ──────────────────────────────────────────────

function rangeClause(from, to, prefix = '') {
  const parts = [];
  const params = [];
  if (from) { parts.push(`${prefix}date >= ?`); params.push(String(from)); }
  if (to) { parts.push(`${prefix}date <= ?`); params.push(String(to)); }
  return { where: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
}

function addIncome({ amount, date, category, note, branch_id, barber_id }) {
  const info = db
    .prepare('INSERT INTO income (amount, date, category, note, branch_id, barber_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(Number(amount) || 0, date, category || 'other', note || '', branch_id || null, barber_id || null, new Date().toISOString());
  return db.prepare('SELECT * FROM income WHERE id = ?').get(info.lastInsertRowid);
}
function listIncome(from, to, branchId) {
  const r = rangeClause(from, to);
  let sql = 'SELECT i.*, br.name AS branch_name, ba.name AS barber_name FROM income i LEFT JOIN branches br ON i.branch_id=br.id LEFT JOIN barbers ba ON i.barber_id=ba.id WHERE 1=1' + r.where;
  const params = [...r.params];
  if (isSet(branchId)) { sql += ' AND i.branch_id = ?'; params.push(Number(branchId)); }
  return db.prepare(sql + ' ORDER BY i.date DESC, i.id DESC').all(...params);
}
function deleteIncome(id) { return db.prepare('DELETE FROM income WHERE id = ?').run(id); }

function addExpense({ amount, date, category, note, branch_id, barber_id }) {
  const info = db
    .prepare('INSERT INTO expenses (amount, date, category, note, branch_id, barber_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(Number(amount) || 0, date, category || 'other', note || '', branch_id || null, barber_id || null, new Date().toISOString());
  return db.prepare('SELECT * FROM expenses WHERE id = ?').get(info.lastInsertRowid);
}
function listExpenses(from, to, branchId) {
  const r = rangeClause(from, to);
  let sql = 'SELECT e.*, br.name AS branch_name, ba.name AS barber_name FROM expenses e LEFT JOIN branches br ON e.branch_id=br.id LEFT JOIN barbers ba ON e.barber_id=ba.id WHERE 1=1' + r.where;
  const params = [...r.params];
  if (isSet(branchId)) { sql += ' AND e.branch_id = ?'; params.push(Number(branchId)); }
  return db.prepare(sql + ' ORDER BY e.date DESC, e.id DESC').all(...params);
}
function deleteExpense(id) { return db.prepare('DELETE FROM expenses WHERE id = ?').run(id); }

const num = (v) => Number(v) || 0;

// Sum of manual income in range (optional branch).
function sumIncome(from, to, branchId) {
  const r = rangeClause(from, to);
  let sql = 'SELECT COALESCE(SUM(amount),0) v FROM income WHERE 1=1' + r.where;
  const params = [...r.params];
  if (isSet(branchId)) { sql += ' AND branch_id = ?'; params.push(Number(branchId)); }
  return num(db.prepare(sql).get(...params).v);
}
function sumExpenses(from, to, branchId) {
  const r = rangeClause(from, to);
  let sql = 'SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE 1=1' + r.where;
  const params = [...r.params];
  if (isSet(branchId)) { sql += ' AND branch_id = ?'; params.push(Number(branchId)); }
  return num(db.prepare(sql).get(...params).v);
}
function sumExpensesByBarber(barberId, from, to) {
  const r = rangeClause(from, to);
  return num(db.prepare('SELECT COALESCE(SUM(amount),0) v FROM expenses WHERE barber_id = ?' + r.where).get(barberId, ...r.params).v);
}
function expensesByCategory(from, to, branchId) {
  const r = rangeClause(from, to);
  let sql = 'SELECT category, COALESCE(SUM(amount),0) v FROM expenses WHERE 1=1' + r.where;
  const params = [...r.params];
  if (isSet(branchId)) { sql += ' AND branch_id = ?'; params.push(Number(branchId)); }
  return db.prepare(sql + ' GROUP BY category ORDER BY v DESC').all(...params);
}

// Booking revenue = accepted bookings' service prices in range (optional branch/barber).
function bookingRevenue(from, to, branchId, barberId) {
  const r = rangeClause(from, to, 'b.');
  let sql = "SELECT COALESCE(SUM(s.price),0) v FROM bookings b JOIN services s ON b.service_id=s.id WHERE b.status='accepted'" + r.where;
  const params = [...r.params];
  if (isSet(branchId)) { sql += ' AND b.branch_id = ?'; params.push(Number(branchId)); }
  if (isSet(barberId)) { sql += ' AND b.barber_id = ?'; params.push(Number(barberId)); }
  return num(db.prepare(sql).get(...params).v);
}
// Service hours delivered by a barber (accepted bookings' durations) — for hourly pay.
function barberServiceHours(barberId, from, to) {
  const r = rangeClause(from, to, 'b.');
  const v = db.prepare("SELECT COALESCE(SUM(b.duration),0) mins FROM bookings b WHERE b.status='accepted' AND b.barber_id = ?" + r.where).get(barberId, ...r.params).mins;
  return num(v) / 60;
}
function acceptedBookingCount(barberId, from, to) {
  const r = rangeClause(from, to, 'b.');
  return num(db.prepare("SELECT COUNT(*) n FROM bookings b WHERE b.status='accepted' AND b.barber_id = ?" + r.where).get(barberId, ...r.params).n);
}

// ──────────────────────────────────────────────
// Services helpers
// ──────────────────────────────────────────────

function getActiveServices() {
  return db.prepare("SELECT * FROM services WHERE is_active = 1 ORDER BY sort_order, id").all();
}

function getAllServices() {
  return db.prepare('SELECT * FROM services ORDER BY sort_order, id').all();
}

function createService({ name, name_en, price, duration, description, category, sort_order }) {
  const stmt = db.prepare(
    `INSERT INTO services (name, name_en, price, duration, description, category, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    name,
    name_en || '',
    price,
    duration || 60,
    description || '',
    category || 'other',
    sort_order || 0,
    new Date().toISOString()
  );
  return db.prepare('SELECT * FROM services WHERE id = ?').get(info.lastInsertRowid);
}

function updateService(id, { name, name_en, price, duration, description, category, sort_order }) {
  return db
    .prepare(
      `UPDATE services
       SET name = ?, name_en = ?, price = ?, duration = ?, description = ?, category = ?, sort_order = ?
       WHERE id = ?`
    )
    .run(name, name_en || '', price, duration || 60, description || '', category || 'other', sort_order || 0, id);
}

function toggleService(id) {
  return db.prepare('UPDATE services SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
}

function deleteService(id) {
  return db.prepare('DELETE FROM services WHERE id = ?').run(id);
}

// ──────────────────────────────────────────────
// Reviews helpers
// ──────────────────────────────────────────────

function getAllReviews() {
  return db.prepare(
    `SELECT r.*, ba.name AS barber_name FROM reviews r
     LEFT JOIN barbers ba ON r.barber_id = ba.id
     ORDER BY r.created_at DESC`
  ).all();
}

function addReview(name, rating, review_text, barber_id) {
  const stmt = db.prepare(
    `INSERT INTO reviews (name, rating, review_text, barber_id) VALUES (?, ?, ?, ?)`
  );
  const info = stmt.run(name, rating, review_text || null, barber_id || null);
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid);
}

// Reviews attributed to one staff member (their own, read-only view).
function getReviewsByBarber(barberId) {
  return db
    .prepare('SELECT * FROM reviews WHERE barber_id = ? ORDER BY created_at DESC')
    .all(Number(barberId));
}
function barberRatingSummary(barberId) {
  const r = db
    .prepare('SELECT COUNT(*) n, COALESCE(AVG(rating),0) avg FROM reviews WHERE barber_id = ?')
    .get(Number(barberId));
  return { count: r.n, avg: Math.round((Number(r.avg) || 0) * 10) / 10 };
}

// All bookings for one staff member, newest first (their schedule + history).
function getBookingsByBarber(barberId) {
  return db
    .prepare(
      `SELECT b.id, b.customer_name, b.date, b.time_slot, b.duration, b.status, b.note, b.created_at,
              s.name AS service_name, s.price AS service_price, br.name AS branch_name
       FROM bookings b
       LEFT JOIN services s ON b.service_id = s.id
       LEFT JOIN branches br ON b.branch_id = br.id
       WHERE b.barber_id = ?
       ORDER BY b.date DESC, b.time_slot DESC`
    )
    .all(Number(barberId));
}

function deleteReview(id) {
  return db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
}

// ──────────────────────────────────────────────
// Settings helpers
// ──────────────────────────────────────────────

function getSettings() {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  return settings;
}

function updateSetting(key, value) {
  return db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ──────────────────────────────────────────────
// Web-Push subscriptions (installed-PWA background notifications)
// ──────────────────────────────────────────────

function addPushSub(sub) {
  return db
    .prepare('INSERT OR REPLACE INTO push_subscriptions (endpoint, sub, created_at) VALUES (?, ?, ?)')
    .run(sub.endpoint, JSON.stringify(sub), new Date().toISOString());
}

function getPushSubs() {
  return db.prepare('SELECT sub FROM push_subscriptions').all().map((r) => JSON.parse(r.sub));
}

function removePushSub(endpoint) {
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

/**
 * Public settings only — never leak admin credentials or internal keys
 * through the public /api/settings endpoint.
 */
function getPublicSettings() {
  const all = getSettings();
  const out = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('admin_')) continue;     // credentials
    if (k.startsWith('telegram_')) continue;  // owner's private bot token / chat id
    if (k.startsWith('vapid_')) continue;     // web-push server keys
    out[k] = v;
  }
  return out;
}

// ──────────────────────────────────────────────
// Admin credentials (hashed, stored in settings)
// ──────────────────────────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(derived, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Ensure an admin account exists. On first run we seed it from the
 * provided defaults (env/config) so the salon can log in immediately;
 * afterwards credentials are managed via the settings table only.
 */
function ensureAdmin(defaultUsername, defaultPassword) {
  if (!getSetting('admin_username')) {
    updateSetting('admin_username', defaultUsername);
  }
  if (!getSetting('admin_password_hash')) {
    updateSetting('admin_password_hash', hashPassword(defaultPassword));
  }
}

function checkAdminCredentials(username, password) {
  const storedUser = getSetting('admin_username');
  const storedHash = getSetting('admin_password_hash');
  return username === storedUser && verifyPassword(password, storedHash);
}

function setAdminCredentials(username, password) {
  if (username) updateSetting('admin_username', username);
  if (password) updateSetting('admin_password_hash', hashPassword(password));
}

// ──────────────────────────────────────────────
// Atomic booking — availability check + insert in
// a single transaction to close the double-booking
// race window.
// ──────────────────────────────────────────────

const bookAtomic = db.transaction(({ overlaps, booking }) => {
  const clash = overlaps();          // caller supplies the overlap test
  if (clash) return { conflict: true };
  const created = createBooking(booking);
  return { conflict: false, booking: created };
});

/**
 * "Any barber" booking: try each candidate barber in order and book the first
 * one that's free for the slot — all inside a single transaction so two
 * requests can't grab the same barber. `hasClash(barberId)` is supplied by the
 * caller (uses the same overlap maths as a normal booking).
 */
const assignAndBook = db.transaction(({ candidates, hasClash, buildBooking }) => {
  for (const b of candidates) {
    if (!hasClash(b.id)) {
      return { conflict: false, booking: createBooking(buildBooking(b.id)), barber: b };
    }
  }
  return { conflict: true };
});

// ──────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────

module.exports = {
  db,
  // Bookings
  getSlotsByDate,
  createBooking,
  getBookingsByToken,
  isReturningCustomer,
  countAcceptedByToken,
  countAcceptedByPhone,
  updateBookingStatus,
  updateBookingTime,
  deleteBooking,
  // Gallery
  getAllGallery,
  getPublicGallery,
  countPendingGallery,
  addGalleryItem,
  approveGalleryItem,
  updateGalleryDescription,
  deleteGalleryItem,
  getGalleryByBarber,
  deleteGalleryItemOwned,
  // Branches
  getActiveBranches,
  getAllBranches,
  getBranch,
  branchWorksOn,
  createBranch,
  updateBranch,
  toggleBranch,
  deleteBranch,
  // Barbers
  getActiveBarbers,
  getAllBarbers,
  getBarber,
  getBarberByToken,
  ensureBarberToken,
  barberWorksOn,
  createBarber,
  updateBarber,
  updateBarberProfile,
  toggleBarber,
  deleteBarber,
  // Finance
  addIncome, listIncome, deleteIncome, sumIncome,
  addExpense, listExpenses, deleteExpense, sumExpenses,
  sumExpensesByBarber, expensesByCategory,
  bookingRevenue, barberServiceHours, acceptedBookingCount,
  // Services
  getActiveServices,
  getAllServices,
  createService,
  updateService,
  toggleService,
  deleteService,
  // Reviews
  getAllReviews,
  addReview,
  deleteReview,
  getReviewsByBarber,
  barberRatingSummary,
  // Staff portal
  getBookingsByBarber,
  // Settings
  getSettings,
  getPublicSettings,
  getSetting,
  updateSetting,
  // Push subscriptions
  addPushSub,
  getPushSubs,
  removePushSub,
  // Auth
  ensureAdmin,
  checkAdminCredentials,
  setAdminCredentials,
  hashPassword,
  verifyPassword,
  // Atomic booking
  bookAtomic,
  assignAndBook,
};
