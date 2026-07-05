# 💈 Salon Platform

A white-label salon booking platform. Customers browse services, pick a date &
time slot, and book in a few taps. Salon owners get an admin cockpit for
bookings, services, gallery, reviews, and a QR code — plus WhatsApp booking
notifications. Arabic-first (RTL), fully themeable per client.

Built to be **sold and deployed per salon in minutes**: every piece of branding
(name, colour, logo, socials, contact, currency) is set from a setup wizard —
**no code changes per client.**

---

## Quick start (local)

```bash
npm install
npm start
# → http://localhost:3000
```

On first run the server prints a link to **`/setup`**. Open it, fill in the
salon's name / colour / WhatsApp / socials, choose an admin password, and hit
**save** — the platform is now branded and live.

## Selling to a new salon (the 5-minute playbook)

1. Deploy the app (see below) — fresh copy = fresh database.
2. Open `https://<their-domain>/setup`.
3. Enter salon name, pick their brand colour, add WhatsApp + Instagram/TikTok/Facebook.
4. Set the admin username & password → **Save**. You're dropped into the admin panel.
5. Add their services (name, price, duration) and upload a few gallery photos.

Done. To re-brand later, log in and go to **Settings → تعديل الهوية** (reopens `/setup`).

---

## Deployment

### Environment

Copy `.env.example` → `.env` and set at minimum:

```
NODE_ENV=production
SESSION_SECRET=<long random string>
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<strong password>   # only seeds the first account
```

`SESSION_SECRET` and the admin password **must** be changed for any public
deployment. The admin password is hashed (scrypt) and stored in the DB — it is
never persisted in plain text there.

### Node host (Render / Railway / VPS / Odoo.sh-style)

```bash
npm ci --omit=dev
node server.js
```

Point a persistent disk at `DB_PATH` (SQLite file) and `UPLOAD_DIR` (media) so
data survives restarts.

### Docker

```bash
docker build -t salon-platform .
docker run -p 3000:3000 \
  -e SESSION_SECRET=$(openssl rand -hex 32) \
  -e ADMIN_PASSWORD=change-me \
  -v salon-data:/data \
  salon-platform
```

The image stores the DB and uploads under the `/data` volume.

---

## Architecture

| Layer     | Tech |
|-----------|------|
| Server    | Node + Express |
| Database  | SQLite (`better-sqlite3`, WAL) — single file, zero-config |
| Auth      | Session cookie, scrypt-hashed admin password, login rate-limiting |
| Frontend  | Vanilla HTML/CSS/JS, themeable design system (`public/css/style.css`) |
| Branding  | `public/js/brand.js` injects settings (colour, name, socials) at runtime |

### Key files

- `server.js` — routes & API
- `database.js` — schema, seeds, auth & settings helpers, atomic booking
- `config.js` — env-driven config (loads `.env` with no extra dependency)
- `public/js/brand.js` — runtime white-label injector (included on every page)
- `public/pages/setup.html` — the branding / setup wizard

### Notable behaviours

- **Themeable:** the primary colour is the `--brand` CSS variable; `brand.js`
  overrides it from the salon's `brand_color` setting, cascading through the
  whole UI.
- **WhatsApp:** the booking-confirmation screen offers a one-tap “send booking
  to WhatsApp” link to the salon's number; in the admin panel each customer's
  phone is a click-to-chat link. Zero API keys, zero cost.
- **Atomic bookings:** availability check + insert run in one SQLite
  transaction, so two simultaneous requests can't grab the same slot.
- **Booking window:** configurable via `SLOT_START_HOUR` / `SLOT_END_HOUR`
  (supports windows that cross midnight, e.g. 12 PM → 3 AM).

## Default credentials

`admin` / `salon123` (dev only). **Change these via `.env` or the setup wizard
before going live.**
