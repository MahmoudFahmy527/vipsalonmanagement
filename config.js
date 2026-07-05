const path = require('path');
const fs = require('fs');

// ── Minimal .env loader (no dependency) ──
// Loads KEY=VALUE lines from a .env file in the project root into
// process.env without overriding vars already set by the host.
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (_) { /* non-fatal */ }
})();

// All secrets/config come from the environment when available, with
// safe local-dev fallbacks. In production set these via .env / host vars.
// ADMIN_USERNAME / ADMIN_PASSWORD are only used to *seed* the first admin
// account; after that, credentials live (hashed) in the settings table and
// are changed from the admin panel.
module.exports = {
  ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin',
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'salon123',
  SESSION_SECRET: process.env.SESSION_SECRET || 'change-me-in-production-' + require('os').hostname(),
  PORT: Number(process.env.PORT) || 3000,
  SLOT_START_HOUR: Number(process.env.SLOT_START_HOUR) || 12, // 12 PM
  SLOT_END_HOUR: Number(process.env.SLOT_END_HOUR) || 3,      // 3 AM next day
  SLOT_DURATION: Number(process.env.SLOT_DURATION) || 60,     // minutes
  MAX_FILE_SIZE: (Number(process.env.MAX_FILE_MB) || 50) * 1024 * 1024,
  UPLOAD_DIR: process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'),
  NODE_ENV: process.env.NODE_ENV || 'development',
};
