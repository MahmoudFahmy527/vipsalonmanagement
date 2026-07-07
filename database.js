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
// Gallery moderation: admin uploads are 'approved'; customer submissions land
// as 'pending' until the owner approves them.
ensureColumn('gallery', 'status', "TEXT DEFAULT 'approved'");
ensureColumn('gallery', 'submitter_name', 'TEXT');

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
 * Non-rejected bookings for a date. When a barberId is given, only that
 * barber's bookings count — so each barber has an independent calendar.
 * With no barberId (salon not using barbers), all bookings for the date
 * are returned (legacy single-calendar behaviour).
 */
function getSlotsByDate(date, barberId) {
  if (barberId === undefined || barberId === null || barberId === '') {
    return db
      .prepare(
        `SELECT * FROM bookings
         WHERE date = ? AND status != 'rejected'
         ORDER BY time_slot`
      )
      .all(date);
  }
  return db
    .prepare(
      `SELECT * FROM bookings
       WHERE date = ? AND status != 'rejected' AND barber_id = ?
       ORDER BY time_slot`
    )
    .all(date, Number(barberId));
}

/**
 * Insert a new booking and return the created row.
 */
function createBooking({ customer_name, customer_phone, service_id, barber_id, date, time_slot, duration, status, note, customer_token }) {
  const stmt = db.prepare(
    `INSERT INTO bookings (customer_name, customer_phone, service_id, barber_id, date, time_slot, duration, status, note, customer_token, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    customer_name,
    customer_phone,
    service_id || null,
    barber_id || null,
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

function addGalleryItem({ filename, original_name, type, description, status, submitter_name }) {
  const stmt = db.prepare(
    `INSERT INTO gallery (filename, original_name, type, description, status, submitter_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    filename,
    original_name || '',
    type,
    description || '',
    status || 'approved',
    submitter_name || null,
    new Date().toISOString()
  );
  return db.prepare('SELECT * FROM gallery WHERE id = ?').get(info.lastInsertRowid);
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
// Barber helpers
// ──────────────────────────────────────────────

function getActiveBarbers() {
  return db.prepare('SELECT * FROM barbers WHERE is_active = 1 ORDER BY sort_order, id').all();
}

function getAllBarbers() {
  return db.prepare('SELECT * FROM barbers ORDER BY sort_order, id').all();
}

function createBarber({ name, specialty, sort_order }) {
  const info = db
    .prepare('INSERT INTO barbers (name, specialty, sort_order, created_at) VALUES (?, ?, ?, ?)')
    .run(name, specialty || '', sort_order || 0, new Date().toISOString());
  return db.prepare('SELECT * FROM barbers WHERE id = ?').get(info.lastInsertRowid);
}

function updateBarber(id, { name, specialty, sort_order }) {
  return db
    .prepare('UPDATE barbers SET name = ?, specialty = ?, sort_order = ? WHERE id = ?')
    .run(name, specialty || '', sort_order || 0, id);
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
  return db.prepare('SELECT * FROM reviews ORDER BY created_at DESC').all();
}

function addReview(name, rating, review_text) {
  const stmt = db.prepare(
    `INSERT INTO reviews (name, rating, review_text) VALUES (?, ?, ?)`
  );
  const info = stmt.run(name, rating, review_text || null);
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(info.lastInsertRowid);
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
    if (k.startsWith('admin_')) continue;
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
  // Barbers
  getActiveBarbers,
  getAllBarbers,
  createBarber,
  updateBarber,
  toggleBarber,
  deleteBarber,
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
  // Settings
  getSettings,
  getPublicSettings,
  getSetting,
  updateSetting,
  // Auth
  ensureAdmin,
  checkAdminCredentials,
  setAdminCredentials,
  hashPassword,
  verifyPassword,
  // Atomic booking
  bookAtomic,
};
