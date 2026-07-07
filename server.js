const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const db = require('./database');

// Seed the first admin account (hashed) from env/config on first run.
db.ensureAdmin(config.ADMIN_USERNAME, config.ADMIN_PASSWORD);

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
function generateSlotTimes() {
  const slots = [];
  const start = config.SLOT_START_HOUR; // 12
  const end = config.SLOT_END_HOUR;     // 3
  const step = config.SLOT_DURATION;     // 60 minutes

  let hour = start;
  // Walk forward in 1-hour increments. The "end" hour itself is NOT a bookable
  // start time (a slot beginning at 02:00 ends at 03:00, which is the boundary).
  while (true) {
    const hh = String(hour % 24).padStart(2, '0');
    slots.push(`${hh}:00`);
    hour += step / 60; // advance by 1 hour
    const current = hour % 24;
    // Stop once we've reached (but not passed) the end hour on the "other side"
    if (current === end) break;
    // Safety: if we've gone full circle, break to avoid infinite loop
    if (slots.length >= 24) break;
  }
  return slots;
}

/**
 * Convert a time-slot string "HH:MM" to a comparable minute-of-day value,
 * adjusted so that hours before SLOT_START_HOUR (i.e. after midnight) are
 * treated as 24+hour to keep ordering linear.
 */
function slotToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  let minutes = h * 60 + m;
  if (h < config.SLOT_START_HOUR) {
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

// Time-slot availability for a date
app.get('/api/slots/:date', (req, res) => {
  try {
    const { date } = req.params; // YYYY-MM-DD

    // Bookings may live on `date` itself, or on the *next* calendar day
    // for after-midnight slots (00:xx, 01:xx, 02:xx).
    const bookings = db.getSlotsByDate(date);

    const slotTimes = generateSlotTimes();

    const result = slotTimes.map((time) => {
      const slotStart = slotToMinutes(time);

      // Determine the status of this slot by checking all bookings
      let status = 'available';

      for (const b of bookings) {
        const bStart = slotToMinutes(b.time_slot);
        const bEnd = bStart + (b.duration || 60);

        const slotEnd = slotStart + (config.SLOT_DURATION);

        // Two ranges overlap when one starts before the other ends and vice-versa
        if (slotStart < bEnd && bStart < slotEnd) {
          if (b.status === 'accepted' || b.status === 'reserved') {
            status = 'taken';
            break; // taken takes precedence
          }
          if (b.status === 'pending') {
            status = 'pending'; // keep checking—taken would override
          }
        }
      }

      return {
        time,
        display: formatDisplay(time),
        status,
      };
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
    const { customer_name, customer_phone, service_id, date, time_slot } = req.body;

    // Validation
    if (!customer_name || !customer_phone || !date || !time_slot) {
      return res.status(400).json({ error: 'Missing required fields: customer_name, customer_phone, date, time_slot' });
    }
    if (service_id === undefined || service_id === null || service_id === '') {
      return res.status(400).json({ error: 'service_id is required' });
    }

    const slotStart = slotToMinutes(time_slot);
    const slotEnd = slotStart + config.SLOT_DURATION;

    // Availability check + insert run in one transaction so two
    // simultaneous requests can't both grab the same slot.
    const result = db.bookAtomic({
      overlaps: () => {
        const bookings = db.getSlotsByDate(date);
        return bookings.some((b) => {
          const bStart = slotToMinutes(b.time_slot);
          const bEnd = bStart + (b.duration || 60);
          const clash = slotStart < bEnd && bStart < slotEnd;
          return clash && (b.status === 'accepted' || b.status === 'reserved');
        });
      },
      booking: {
        customer_name,
        customer_phone,
        service_id: Number(service_id),
        date,
        time_slot,
        duration: config.SLOT_DURATION,
        status: 'pending',
      },
    });

    if (result.conflict) {
      return res.status(409).json({ error: 'This time slot is already taken' });
    }

    res.status(201).json({ success: true, booking: result.booking });
  } catch (err) {
    console.error('POST /api/book error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// Gallery (public)
app.get('/api/gallery', (_req, res) => {
  try {
    const items = db.getAllGallery();
    res.json(items);
  } catch (err) {
    console.error('GET /api/gallery error:', err);
    res.status(500).json({ error: 'Failed to fetch gallery' });
  }
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
    const rows = db.db
      .prepare(
        `SELECT b.*, s.name AS service_name, s.name_en AS service_name_en,
                s.price AS service_price, s.duration AS service_duration
         FROM bookings b
         LEFT JOIN services s ON b.service_id = s.id
         WHERE b.date = ?
         ORDER BY b.time_slot`
      )
      .all(date);
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
    const { date, time_slot, note, duration } = req.body;
    if (!date || !time_slot) {
      return res.status(400).json({ error: 'date and time_slot are required' });
    }
    const booking = db.createBooking({
      customer_name: 'محجوز',
      customer_phone: '-',
      service_id: null,
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
