const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./database');

// Seed the first admin account (hashed) from env/config on first run.
db.ensureAdmin(config.ADMIN_USERNAME, config.ADMIN_PASSWORD);

// Fire-and-forget Telegram push to the owner (free; no per-message cost).
// Uses the salon's own bot token + chat id from settings; silent no-op if unset.
async function sendTelegram(text, opts) {
  const token = (opts && opts.token) || db.getSetting('telegram_bot_token');
  const chatId = (opts && opts.chatId) || db.getSetting('telegram_chat_id');
  if (!token || !chatId) return { ok: false, skipped: true };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    return await r.json();
  } catch (err) {
    console.error('Telegram send failed:', err.message);
    return { ok: false, error: err.message };
  }
}

const app = express();
app.set('trust proxy', 1);

// ──────────────────────────────────────────────
// Ensure uploads directory exists
// ──────────────────────────────────────────────

if (!fs.existsSync(config.UPLOAD_DIR)) {
  fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
}

// ──────────────────────────────────────────────
// Multer setup
// ──────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are allowed'));
    }
  },
});

// ──────────────────────────────────────────────
// Core middleware
// ──────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 h
      httpOnly: true,
      sameSite: 'lax',
      secure: config.NODE_ENV === 'production',
    },
  })
);

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(config.UPLOAD_DIR));

// ──────────────────────────────────────────────
// Auth middleware
// ──────────────────────────────────────────────

function isAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized – admin login required' });
}

// ──────────────────────────────────────────────
// Slot generation helpers
// ──────────────────────────────────────────────

/**
 * Build the list of hourly slot strings that span from SLOT_START_HOUR
 * to SLOT_END_HOUR (crossing midnight when end < start).
 * Returns e.g. ['12:00','13:00',…,'23:00','00:00','01:00','02:00']
 */
function generateSlotTimesFor(start, end) {
  const slots = [];
  const step = config.SLOT_DURATION; // 60 minutes
  if (start === end) return slots;

  let hour = start;
  // Walk forward in 1-hour increments. The "end" hour itself is NOT a bookable
  // start time (a slot beginning at 02:00 ends at 03:00, which is the boundary).
  while (true) {
    const hh = String(hour % 24).padStart(2, '0');
    slots.push(`${hh}:00`);
    hour += step / 60; // advance by 1 hour
    const current = hour % 24;
    if (current === end) break;
    if (slots.length >= 24) break; // safety: avoid infinite loop
  }
  return slots;
}

// Salon-wide default window.
function generateSlotTimes() {
  return generateSlotTimesFor(config.SLOT_START_HOUR, config.SLOT_END_HOUR);
}

// Salon-wide schedule, editable from settings (falls back to config/env).
function salonCfg() {
  const num = (v, fallback) => {
    const n = Number(v);
    return (v !== '' && v != null && Number.isFinite(n)) ? n : fallback;
  };
  const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    open: num(db.getSetting('open_hour'), config.SLOT_START_HOUR),
    close: num(db.getSetting('close_hour'), config.SLOT_END_HOUR),
    closedDays: list(db.getSetting('closed_days')),
    closedDates: list(db.getSetting('closed_dates')),
  };
}

// Is the salon open on this date (weekday not closed, not a holiday)?
function salonOpenOn(date, cfg) {
  if (cfg.closedDates.includes(date)) return false;
  if (cfg.closedDays.length) {
    const dow = new Date(date + 'T00:00:00').getDay();
    if (cfg.closedDays.includes(String(dow))) return false;
  }
  return true;
}

// A barber's own window (falls back to the salon window).
function barberWindow(barber, cfg) {
  const start = (barber && barber.work_start != null) ? barber.work_start : cfg.open;
  const end = (barber && barber.work_end != null) ? barber.work_end : cfg.close;
  return { start, end };
}

// Does a booking overlap the [slotStart, slotStart+DURATION) window and hold it?
function bookingBlocks(b, slotStart, openHour) {
  const bStart = slotToMinutes(b.time_slot, openHour);
  const bEnd = bStart + (b.duration || 60);
  const slotEnd = slotStart + config.SLOT_DURATION;
  return slotStart < bEnd && bStart < slotEnd && (b.status === 'accepted' || b.status === 'reserved');
}

/**
 * Convert a time-slot string "HH:MM" to a comparable minute-of-day value,
 * adjusted so that hours before the opening hour (i.e. after midnight for a
 * salon that crosses midnight) are treated as 24+hour to keep ordering linear.
 */
function slotToMinutes(timeStr, openHour = config.SLOT_START_HOUR) {
  const [h, m] = timeStr.split(':').map(Number);
  let minutes = h * 60 + m;
  if (h < openHour) {
    minutes += 24 * 60; // push post-midnight slots past 23:xx
  }
  return minutes;
}

/**
 * Format "HH:MM" → "h:MM AM/PM"
 */
function formatDisplay(time) {
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:${String(m).padStart(2, '0')} ${suffix}`;
}

// ──────────────────────────────────────────────
// PAGE ROUTES  (serve HTML files)
// ──────────────────────────────────────────────

const pagesDir = path.join(__dirname, 'public', 'pages');

app.get('/', (_req, res) => {
  res.sendFile(path.join(pagesDir, 'index.html'));
});

app.get('/book', (_req, res) => {
  res.sendFile(path.join(pagesDir, 'book.html'));
});

app.get('/services', (_req, res) => {
  res.sendFile(path.join(pagesDir, 'services.html'));
});

app.get('/gallery', (_req, res) => {
  res.sendFile(path.join(pagesDir, 'gallery.html'));
});

app.get('/login', (_req, res) => {
  res.sendFile(path.join(pagesDir, 'login.html'));
});

// First-run / re-branding setup wizard. Open before configuration is done;
// afterwards it requires an admin session.
app.get('/setup', (req, res) => {
  const configured = db.getSetting('configured') === '1';
  if (configured && !(req.session && req.session.isAdmin)) {
    return res.redirect('/login');
  }
  res.sendFile(path.join(pagesDir, 'setup.html'));
});

app.get('/admin', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(pagesDir, 'admin.html'));
});

app.get('/admin/gallery', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(pagesDir, 'admin-gallery.html'));
});

app.get('/admin/services', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(pagesDir, 'admin-services.html'));
});

app.get('/admin/barbers', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(pagesDir, 'admin-barbers.html'));
});

app.get('/admin/stats', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(pagesDir, 'admin-stats.html'));
});

app.get('/admin/reviews', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(pagesDir, 'admin-reviews.html'));
});

app.get('/admin/settings', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(pagesDir, 'admin-settings.html'));
});

app.get('/admin/qr', (req, res) => {
  if (!req.session || !req.session.isAdmin) return res.redirect('/login');
  res.sendFile(path.join(pagesDir, 'admin-qr.html'));
});

// ──────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────

// Health check (for Railway/Render probes)
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Active services
app.get('/api/services', (_req, res) => {
  try {
    const services = db.getActiveServices();
    res.json(services);
  } catch (err) {
    console.error('GET /api/services error:', err);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

// Active barbers (public). Empty array = salon doesn't use barbers.
app.get('/api/barbers', (_req, res) => {
  try {
    res.json(db.getActiveBarbers());
  } catch (err) {
    console.error('GET /api/barbers error:', err);
    res.status(500).json({ error: 'Failed to fetch barbers' });
  }
});

// Time-slot availability for a date.
//  ?barber=<id>  → that barber's own calendar (honours their schedule/hours)
//  ?barber=any   → available if ANY working barber is free at that time
//  (no param)    → salon-wide single calendar (legacy)
app.get('/api/slots/:date', (req, res) => {
  try {
    const { date } = req.params; // YYYY-MM-DD
    const barberId = req.query.barber;

    const cfg = salonCfg();
    const openH = cfg.open;
    // Salon closed that day (holiday / weekly closure) → no slots at all.
    if (!salonOpenOn(date, cfg)) return res.json([]);

    // ---- "Any available barber" ----
    if (barberId === 'any') {
      const barbers = db.getActiveBarbers().filter((b) => db.barberWorksOn(b, date));
      if (!barbers.length) return res.json([]); // no barber works this day

      const perBarber = barbers.map((b) => {
        const { start, end } = barberWindow(b, cfg);
        return {
          times: new Set(generateSlotTimesFor(start, end)),
          bookings: db.getSlotsByDate(date, b.id),
        };
      });

      // Union of every working barber's slot times, ordered.
      const allTimes = new Set();
      perBarber.forEach((pb) => pb.times.forEach((t) => allTimes.add(t)));
      const ordered = [...allTimes].sort((a, b) => slotToMinutes(a, openH) - slotToMinutes(b, openH));

      const result = ordered.map((time) => {
        const slotStart = slotToMinutes(time, openH);
        // Available if at least one barber works this time AND is free.
        const status = perBarber.some(
          (pb) => pb.times.has(time) && !pb.bookings.some((bk) => bookingBlocks(bk, slotStart, openH))
        ) ? 'available' : 'taken';
        return { time, display: formatDisplay(time), status };
      });
      return res.json(result);
    }

    // ---- A specific barber ----
    let slotTimes = generateSlotTimesFor(cfg.open, cfg.close);
    if (barberId) {
      const barber = db.getBarber(Number(barberId));
      if (!barber || !db.barberWorksOn(barber, date)) return res.json([]); // day off
      const { start, end } = barberWindow(barber, cfg);
      slotTimes = generateSlotTimesFor(start, end);
    }

    const bookings = db.getSlotsByDate(date, barberId);

    const result = slotTimes.map((time) => {
      const slotStart = slotToMinutes(time, openH);
      let status = 'available';
      for (const b of bookings) {
        const bStart = slotToMinutes(b.time_slot, openH);
        const bEnd = bStart + (b.duration || 60);
        const slotEnd = slotStart + config.SLOT_DURATION;
        if (slotStart < bEnd && bStart < slotEnd) {
          if (b.status === 'accepted' || b.status === 'reserved') { status = 'taken'; break; }
          if (b.status === 'pending') status = 'pending';
        }
      }
      return { time, display: formatDisplay(time), status };
    });

    res.json(result);
  } catch (err) {
    console.error('GET /api/slots error:', err);
    res.status(500).json({ error: 'Failed to fetch slots' });
  }
});

// Create a booking (public)
app.post('/api/book', (req, res) => {
  try {
    const { customer_name, customer_phone, service_id, barber_id, date, time_slot, customer_token } = req.body;

    // Validation
    if (!customer_name || !customer_phone || !date || !time_slot) {
      return res.status(400).json({ error: 'Missing required fields: customer_name, customer_phone, date, time_slot' });
    }
    if (service_id === undefined || service_id === null || service_id === '') {
      return res.status(400).json({ error: 'service_id is required' });
    }

    const cfg = salonCfg();
    if (!salonOpenOn(date, cfg)) {
      return res.status(409).json({ error: 'الصالون مغلق في هذا اليوم' });
    }

    const slotStart = slotToMinutes(time_slot, cfg.open);

    const hasClash = (barberId) =>
      db.getSlotsByDate(date, barberId).some((b) => bookingBlocks(b, slotStart, cfg.open));

    const baseBooking = {
      customer_name,
      customer_phone,
      service_id: Number(service_id),
      date,
      time_slot,
      duration: config.SLOT_DURATION,
      status: 'pending',
      customer_token: customer_token || null,
    };

    let result;
    let assignedBarber = null;

    if (barber_id === 'any') {
      // Assign the first working barber who is free for this slot (atomic).
      const candidates = db.getActiveBarbers().filter((b) => db.barberWorksOn(b, date));
      if (!candidates.length) {
        return res.status(409).json({ error: 'لا يوجد حلاق متاح في هذا الموعد' });
      }
      result = db.assignAndBook({
        candidates,
        hasClash,
        buildBooking: (barberId) => ({ ...baseBooking, barber_id: barberId }),
      });
      if (!result.conflict) assignedBarber = result.barber;
    } else {
      // Specific barber (or none). Validate the barber works that day.
      if (barber_id) {
        const barber = db.getBarber(Number(barber_id));
        if (!barber || !db.barberWorksOn(barber, date)) {
          return res.status(409).json({ error: 'الحلاق غير متاح في هذا اليوم' });
        }
        assignedBarber = barber;
      }
      result = db.bookAtomic({
        overlaps: () => hasClash(barber_id || null),
        booking: { ...baseBooking, barber_id: barber_id ? Number(barber_id) : null },
      });
    }

    if (result.conflict) {
      return res.status(409).json({ error: 'This time slot is already taken' });
    }

    // Notify the owner on Telegram (fire-and-forget; no-op if not configured).
    const svc = db.db.prepare('SELECT name FROM services WHERE id = ?').get(Number(service_id));
    const lines = [
      '🆕 حجز جديد',
      `👤 ${customer_name}`,
      `📞 ${customer_phone}`,
      svc ? `✂️ ${svc.name}` : null,
      assignedBarber ? `💈 ${assignedBarber.name}` : null,
      `📅 ${date}  ⏰ ${formatDisplay(time_slot)}`,
    ].filter(Boolean);
    sendTelegram(lines.join('\n'));

    res.status(201).json({
      success: true,
      booking: result.booking,
      barber_name: assignedBarber ? assignedBarber.name : null,
    });
  } catch (err) {
    console.error('POST /api/book error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// A customer's own bookings, looked up by their private device token.
// The token is a random id stored only in that customer's browser, so this
// never exposes anyone else's data (and no phone-number enumeration).
app.get('/api/my-bookings', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.json([]);
    res.json(db.getBookingsByToken(String(token)));
  } catch (err) {
    console.error('GET /api/my-bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// Gallery (public — approved items only)
app.get('/api/gallery', (_req, res) => {
  try {
    res.json(db.getPublicGallery());
  } catch (err) {
    console.error('GET /api/gallery error:', err);
    res.status(500).json({ error: 'Failed to fetch gallery' });
  }
});

// Customer photo submission → lands in the moderation queue (status 'pending').
// Images only, one per request; the admin approves before it shows publicly.
app.post('/api/gallery/submit', (req, res) => {
  upload.single('media')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      if (!req.file.mimetype.startsWith('image/')) {
        // remove the rejected upload from disk
        fs.existsSync(req.file.path) && fs.unlinkSync(req.file.path);
        return res.status(400).json({ error: 'Only images can be submitted' });
      }
      const item = db.addGalleryItem({
        filename: req.file.filename,
        original_name: req.file.originalname,
        type: 'image',
        description: (req.body.description || '').slice(0, 200),
        submitter_name: (req.body.submitter_name || '').slice(0, 60),
        status: 'pending',
      });
      res.status(201).json({ success: true, id: item.id });
    } catch (innerErr) {
      console.error('POST /api/gallery/submit error:', innerErr);
      res.status(500).json({ error: 'Failed to submit photo' });
    }
  });
});

// Reviews (public)
app.get('/api/reviews', (_req, res) => {
  try {
    const reviews = db.getAllReviews();
    res.json(reviews);
  } catch (err) {
    console.error('GET /api/reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

app.post('/api/reviews', (req, res) => {
  try {
    const { name, rating, review_text } = req.body;
    if (!name || !rating) {
      return res.status(400).json({ error: 'Name and rating are required' });
    }
    const review = db.addReview(name, Number(rating), review_text);
    res.status(201).json({ success: true, review });
  } catch (err) {
    console.error('POST /api/reviews error:', err);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

// Settings (public — excludes admin credentials)
app.get('/api/settings', (_req, res) => {
  try {
    res.json(db.getPublicSettings());
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Setup / re-branding: allowed on first run (before configured), or by an
// admin afterwards. Saves branding settings in bulk and (optionally) the
// admin credentials, then marks the salon configured.
const BRAND_KEYS = [
  'salon_name', 'salon_name_en', 'tagline', 'home_description', 'brand_color',
  'currency', 'logo_emoji', 'phone', 'whatsapp', 'address',
  'instagram', 'tiktok', 'facebook', 'hero_image',
];

app.post('/api/setup', (req, res) => {
  try {
    const configured = db.getSetting('configured') === '1';
    const isAdmin = req.session && req.session.isAdmin;
    if (configured && !isAdmin) {
      return res.status(401).json({ error: 'Setup already completed. Admin login required.' });
    }

    const { settings = {}, admin_username, admin_password } = req.body || {};
    for (const key of BRAND_KEYS) {
      if (settings[key] !== undefined) {
        db.updateSetting(key, String(settings[key]));
      }
    }
    // Keep tagline and home_description in sync when only one is supplied.
    if (settings.tagline !== undefined && settings.home_description === undefined) {
      db.updateSetting('home_description', String(settings.tagline));
    }

    if (admin_username || admin_password) {
      db.setAdminCredentials(admin_username, admin_password);
    }

    db.updateSetting('configured', '1');
    if (!isAdmin) req.session.isAdmin = true; // log the owner in after first setup
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/setup error:', err);
    res.status(500).json({ error: 'Setup failed' });
  }
});

// ──────────────────────────────────────────────
// AUTH API
// ──────────────────────────────────────────────

// Simple in-memory login rate limiter (per IP): 8 attempts / 15 min.
const loginAttempts = new Map();
const LOGIN_MAX = 8;
const LOGIN_WINDOW = 15 * 60 * 1000;

function loginRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (rec && now - rec.first < LOGIN_WINDOW && rec.count >= LOGIN_MAX) {
    const mins = Math.ceil((LOGIN_WINDOW - (now - rec.first)) / 60000);
    return res.status(429).json({ error: `محاولات كثيرة. حاول بعد ${mins} دقيقة.` });
  }
  next();
}

function recordFailedLogin(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW) {
    loginAttempts.set(ip, { count: 1, first: now });
  } else {
    rec.count += 1;
  }
}

app.post('/api/login', loginRateLimit, (req, res) => {
  try {
    const { username, password } = req.body;
    if (username && password && db.checkAdminCredentials(username, password)) {
      loginAttempts.delete(req.ip);
      req.session.isAdmin = true;
      return res.json({ success: true });
    }
    recordFailedLogin(req.ip);
    res.status(401).json({ error: 'Invalid credentials' });
  } catch (err) {
    console.error('POST /api/login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true });
  });
});

app.get('/api/auth/check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

// ──────────────────────────────────────────────
// ADMIN – BOOKINGS
// ──────────────────────────────────────────────

app.get('/api/admin/bookings/:date', isAdmin, (req, res) => {
  try {
    const { date } = req.params;
    const barberId = req.query.barber; // optional filter → one barber's day
    let sql =
      `SELECT b.*, s.name AS service_name, s.name_en AS service_name_en,
              s.price AS service_price, s.duration AS service_duration,
              br.name AS barber_name
       FROM bookings b
       LEFT JOIN services s ON b.service_id = s.id
       LEFT JOIN barbers br ON b.barber_id = br.id
       WHERE b.date = ?`;
    const params = [date];
    if (barberId) { sql += ' AND b.barber_id = ?'; params.push(Number(barberId)); }
    sql += ' ORDER BY b.time_slot';
    const rows = db.db.prepare(sql).all(...params);
    // Flag returning customers (booked before under the same phone).
    for (const b of rows) {
      b.is_returning = db.isReturningCustomer(b.customer_phone, b.id);
    }
    res.json(rows);
  } catch (err) {
    console.error('GET /api/admin/bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

app.put('/api/admin/bookings/:id', isAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use accepted or rejected.' });
    }
    db.updateBookingStatus(Number(id), status);
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/bookings/:id error:', err);
    res.status(500).json({ error: 'Failed to update booking status' });
  }
});

app.put('/api/admin/bookings/:id/time', isAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { date, time_slot, duration } = req.body;
    if (!date || !time_slot) {
      return res.status(400).json({ error: 'date and time_slot are required' });
    }
    db.updateBookingTime(Number(id), date, time_slot, duration || 60);
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/bookings/:id/time error:', err);
    res.status(500).json({ error: 'Failed to update booking time' });
  }
});

app.post('/api/admin/reserve', isAdmin, (req, res) => {
  try {
    const { date, time_slot, note, duration, barber_id } = req.body;
    if (!date || !time_slot) {
      return res.status(400).json({ error: 'date and time_slot are required' });
    }
    const booking = db.createBooking({
      customer_name: 'محجوز',
      customer_phone: '-',
      service_id: null,
      barber_id: barber_id ? Number(barber_id) : null,
      date,
      time_slot,
      duration: duration || config.SLOT_DURATION,
      status: 'reserved',
      note: note || null,
    });
    res.status(201).json({ success: true, booking });
  } catch (err) {
    console.error('POST /api/admin/reserve error:', err);
    res.status(500).json({ error: 'Failed to reserve slot' });
  }
});

app.delete('/api/admin/bookings/:id', isAdmin, (req, res) => {
  try {
    db.deleteBooking(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/bookings/:id error:', err);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// ──────────────────────────────────────────────
// ADMIN – GALLERY
// ──────────────────────────────────────────────

// All gallery items incl. pending customer submissions (pending first).
app.get('/api/admin/gallery', isAdmin, (_req, res) => {
  try {
    res.json(db.getAllGallery());
  } catch (err) {
    console.error('GET /api/admin/gallery error:', err);
    res.status(500).json({ error: 'Failed to fetch gallery' });
  }
});

app.post('/api/admin/gallery', isAdmin, (req, res) => {
  upload.single('media')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        return res.status(400).json({ error: err.message });
      }
      return res.status(400).json({ error: err.message || 'Upload failed' });
    }
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      const type = req.file.mimetype.startsWith('image/') ? 'image' : 'video';
      const item = db.addGalleryItem({
        filename: req.file.filename,
        original_name: req.file.originalname,
        type,
        description: req.body.description || '',
      });
      res.status(201).json({ success: true, item });
    } catch (innerErr) {
      console.error('POST /api/admin/gallery error:', innerErr);
      res.status(500).json({ error: 'Failed to save gallery item' });
    }
  });
});

app.put('/api/admin/gallery/:id', isAdmin, (req, res) => {
  try {
    const { description } = req.body;
    db.updateGalleryDescription(Number(req.params.id), description || '');
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/gallery/:id error:', err);
    res.status(500).json({ error: 'Failed to update gallery item' });
  }
});

// Approve a pending customer submission → becomes publicly visible.
app.put('/api/admin/gallery/:id/approve', isAdmin, (req, res) => {
  try {
    db.approveGalleryItem(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/gallery/:id/approve error:', err);
    res.status(500).json({ error: 'Failed to approve gallery item' });
  }
});

app.delete('/api/admin/gallery/:id', isAdmin, (req, res) => {
  try {
    const filename = db.deleteGalleryItem(Number(req.params.id));
    // Remove physical file
    if (filename) {
      const filePath = path.join(config.UPLOAD_DIR, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/gallery/:id error:', err);
    res.status(500).json({ error: 'Failed to delete gallery item' });
  }
});

// ──────────────────────────────────────────────
// ADMIN – SERVICES
// ──────────────────────────────────────────────

app.get('/api/admin/services', isAdmin, (_req, res) => {
  try {
    const services = db.getAllServices();
    res.json(services);
  } catch (err) {
    console.error('GET /api/admin/services error:', err);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

app.post('/api/admin/services', isAdmin, (req, res) => {
  try {
    const { name, name_en, price, duration, description, category, sort_order } = req.body;
    if (!name || price === undefined || price === null) {
      return res.status(400).json({ error: 'name and price are required' });
    }
    const service = db.createService({ name, name_en, price: Number(price), duration, description, category, sort_order });
    res.status(201).json({ success: true, service });
  } catch (err) {
    console.error('POST /api/admin/services error:', err);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

app.put('/api/admin/services/:id', isAdmin, (req, res) => {
  try {
    const { name, name_en, price, duration, description, category, sort_order } = req.body;
    if (!name || price === undefined || price === null) {
      return res.status(400).json({ error: 'name and price are required' });
    }
    db.updateService(Number(req.params.id), { name, name_en, price: Number(price), duration, description, category, sort_order });
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/services/:id error:', err);
    res.status(500).json({ error: 'Failed to update service' });
  }
});

app.put('/api/admin/services/:id/toggle', isAdmin, (req, res) => {
  try {
    db.toggleService(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/services/:id/toggle error:', err);
    res.status(500).json({ error: 'Failed to toggle service' });
  }
});

app.delete('/api/admin/services/:id', isAdmin, (req, res) => {
  try {
    db.deleteService(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/services/:id error:', err);
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

// ──────────────────────────────────────────────
// ADMIN – BARBERS
// ──────────────────────────────────────────────

app.get('/api/admin/barbers', isAdmin, (_req, res) => {
  try {
    res.json(db.getAllBarbers());
  } catch (err) {
    console.error('GET /api/admin/barbers error:', err);
    res.status(500).json({ error: 'Failed to fetch barbers' });
  }
});

app.post('/api/admin/barbers', isAdmin, (req, res) => {
  try {
    const { name, specialty, sort_order, work_days, off_dates, work_start, work_end } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const barber = db.createBarber({ name, specialty, sort_order, work_days, off_dates, work_start, work_end });
    res.status(201).json({ success: true, barber });
  } catch (err) {
    console.error('POST /api/admin/barbers error:', err);
    res.status(500).json({ error: 'Failed to create barber' });
  }
});

app.put('/api/admin/barbers/:id', isAdmin, (req, res) => {
  try {
    const { name, specialty, sort_order, work_days, off_dates, work_start, work_end } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    db.updateBarber(Number(req.params.id), { name, specialty, sort_order, work_days, off_dates, work_start, work_end });
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/barbers/:id error:', err);
    res.status(500).json({ error: 'Failed to update barber' });
  }
});

app.put('/api/admin/barbers/:id/toggle', isAdmin, (req, res) => {
  try {
    db.toggleBarber(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/barbers/:id/toggle error:', err);
    res.status(500).json({ error: 'Failed to toggle barber' });
  }
});

app.delete('/api/admin/barbers/:id', isAdmin, (req, res) => {
  try {
    db.deleteBarber(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/barbers/:id error:', err);
    res.status(500).json({ error: 'Failed to delete barber' });
  }
});

// ──────────────────────────────────────────────
// ADMIN – ANALYTICS
// ──────────────────────────────────────────────

app.get('/api/admin/stats', isAdmin, (_req, res) => {
  try {
    const raw = db.db;
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 7) + '-01';

    const byStatus = { pending: 0, accepted: 0, rejected: 0, reserved: 0 };
    raw.prepare('SELECT status, COUNT(*) c FROM bookings GROUP BY status').all()
      .forEach((r) => { byStatus[r.status] = r.c; });

    // Customers by phone (excluding the '-' used for manual reserves).
    const phones = raw
      .prepare("SELECT customer_phone, COUNT(*) c FROM bookings WHERE customer_phone != '-' AND status != 'rejected' GROUP BY customer_phone")
      .all();
    const returning = phones.filter((p) => p.c > 1).length;

    // Bookings over the last 14 days.
    const series = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - i);
      const ds = d.toISOString().slice(0, 10);
      series.push({
        date: ds,
        count: raw.prepare("SELECT COUNT(*) n FROM bookings WHERE date = ? AND status != 'rejected'").get(ds).n,
      });
    }

    res.json({
      total: raw.prepare("SELECT COUNT(*) n FROM bookings WHERE status != 'rejected'").get().n,
      today: raw.prepare("SELECT COUNT(*) n FROM bookings WHERE date = ? AND status != 'rejected'").get(today).n,
      month: raw.prepare("SELECT COUNT(*) n FROM bookings WHERE date >= ? AND status != 'rejected'").get(monthStart).n,
      byStatus,
      revenueTotal: raw.prepare("SELECT COALESCE(SUM(s.price),0) v FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.status = 'accepted'").get().v,
      revenueMonth: raw.prepare("SELECT COALESCE(SUM(s.price),0) v FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.status = 'accepted' AND b.date >= ?").get(monthStart).v,
      topServices: raw.prepare("SELECT s.name, COUNT(*) c FROM bookings b JOIN services s ON b.service_id = s.id WHERE b.status != 'rejected' GROUP BY s.id ORDER BY c DESC LIMIT 5").all(),
      barberLoad: raw.prepare("SELECT br.name, COUNT(*) c FROM bookings b JOIN barbers br ON b.barber_id = br.id WHERE b.status != 'rejected' GROUP BY br.id ORDER BY c DESC").all(),
      customers: { total: phones.length, returning, new: phones.length - returning },
      series,
    });
  } catch (err) {
    console.error('GET /api/admin/stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// New pending bookings since a given id — drives the dashboard's live
// in-app / browser notification (client polls this).
app.get('/api/admin/notifications', isAdmin, (req, res) => {
  try {
    const sinceId = Number(req.query.sinceId) || 0;
    const rows = db.db.prepare(
      `SELECT b.id, b.customer_name, b.customer_phone, b.date, b.time_slot, b.created_at,
              s.name AS service_name
       FROM bookings b LEFT JOIN services s ON b.service_id = s.id
       WHERE b.id > ? AND b.status = 'pending'
       ORDER BY b.id DESC LIMIT 20`
    ).all(sinceId);
    const maxId = db.db.prepare('SELECT COALESCE(MAX(id),0) m FROM bookings').get().m;
    res.json({ maxId, newBookings: rows });
  } catch (err) {
    console.error('GET /api/admin/notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Send a Telegram test message (verifies the owner's bot token + chat id).
app.post('/api/admin/telegram-test', isAdmin, async (req, res) => {
  const token = (req.body && req.body.token) || db.getSetting('telegram_bot_token');
  const chatId = (req.body && req.body.chat_id) || db.getSetting('telegram_chat_id');
  if (!token || !chatId) return res.status(400).json({ error: 'أدخل توكن البوت ومعرّف المحادثة أولاً' });
  const result = await sendTelegram('✅ تم ربط إشعارات الحجز بنجاح — سيصلك إشعار عند كل حجز جديد.', { token, chatId });
  if (result && result.ok) return res.json({ success: true });
  res.status(400).json({ error: (result && result.description) || 'فشل الإرسال — تحقق من التوكن والمعرّف' });
});

// ──────────────────────────────────────────────
// ADMIN – REVIEWS
// ──────────────────────────────────────────────

app.delete('/api/admin/reviews/:id', isAdmin, (req, res) => {
  try {
    db.deleteReview(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/reviews/:id error:', err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// ──────────────────────────────────────────────
// ADMIN – SETTINGS
// ──────────────────────────────────────────────

// All settings for the admin UI (includes private keys like the Telegram token,
// which the public /api/settings never returns). Password hash is stripped.
app.get('/api/admin/settings', isAdmin, (_req, res) => {
  try {
    const all = db.getSettings();
    delete all.admin_password_hash;
    res.json(all);
  } catch (err) {
    console.error('GET /api/admin/settings error:', err);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

app.put('/api/admin/settings', isAdmin, (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key) {
      return res.status(400).json({ error: 'Setting key is required' });
    }
    if (key.startsWith('admin_') || key === 'configured') {
      return res.status(400).json({ error: 'This setting cannot be changed here' });
    }
    db.updateSetting(key, value || '');
    res.json({ success: true });
  } catch (err) {
    console.error('PUT /api/admin/settings error:', err);
    res.status(500).json({ error: 'Failed to update setting' });
  }
});

// Change admin credentials (requires current password)
app.post('/api/admin/change-password', isAdmin, (req, res) => {
  try {
    const { current_password, new_username, new_password } = req.body || {};
    const username = db.getSetting('admin_username');
    if (!db.checkAdminCredentials(username, current_password)) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة' });
    }
    if (new_password && String(new_password).length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }
    db.setAdminCredentials(new_username || username, new_password || null);
    res.json({ success: true });
  } catch (err) {
    console.error('POST /api/admin/change-password error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ──────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────

app.listen(config.PORT, () => {
  const name = db.getSetting('salon_name') || 'Salon Platform';
  const configured = db.getSetting('configured') === '1';
  console.log(`\n  💈 ${name} — Salon Platform`);
  console.log(`  Server running on http://localhost:${config.PORT}`);
  if (!configured) {
    console.log(`  ⚙  First run — open http://localhost:${config.PORT}/setup to brand this salon\n`);
  } else {
    console.log('');
  }
});
