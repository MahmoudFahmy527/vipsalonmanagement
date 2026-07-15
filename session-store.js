/**
 * SQLite-backed session store for express-session.
 *
 * Sessions are kept in the same salon.db that already lives on the persistent
 * volume, so the owner stays logged in across redeploys/restarts — and we avoid
 * MemoryStore's leak warning without adding a dependency (reuses better-sqlite3).
 */
const session = require('express-session');

const DAY_MS = 24 * 60 * 60 * 1000;

class SqliteSessionStore extends session.Store {
  constructor(dbConn) {
    super();
    this.db = dbConn;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid     TEXT PRIMARY KEY,
        expires INTEGER NOT NULL,
        data    TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires);
    `);
    this.clearExpired();
    // Sweep expired rows hourly; unref so it never holds the process open.
    const timer = setInterval(() => this.clearExpired(), 60 * 60 * 1000);
    if (timer.unref) timer.unref();
  }

  expiryOf(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires;
    const t = exp ? new Date(exp).getTime() : NaN;
    return Number.isFinite(t) ? t : Date.now() + DAY_MS;
  }

  clearExpired() {
    try { this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now()); } catch (_) {}
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT data, expires FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires <= Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sess, cb) {
    try {
      this.db
        .prepare('INSERT OR REPLACE INTO sessions (sid, expires, data) VALUES (?, ?, ?)')
        .run(sid, this.expiryOf(sess), JSON.stringify(sess));
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sess, cb) {
    try {
      this.db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?').run(this.expiryOf(sess), sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  length(cb) {
    try { cb(null, this.db.prepare('SELECT COUNT(*) n FROM sessions').get().n); }
    catch (err) { cb(err); }
  }

  clear(cb) {
    try { this.db.prepare('DELETE FROM sessions').run(); cb(null); }
    catch (err) { cb(err); }
  }
}

module.exports = SqliteSessionStore;
