# Test coverage

Adapts `UNIFIED_TESTING_GUIDELINE.md` to this Node/Express/SQLite/vanilla-JS stack.
Run `npm test` (Tier 0 + Tier 1, green ×2). Tier 1.5/2 are browser checks run
interactively via the preview.

| Area | Tier | Actor | What's asserted | Status |
|---|---|---|---|---|
| All JS syntax | 0 | — | `node --check` every `.js`/`.mjs` | ✅ auto |
| Auth boundary | 1 | anon | admin endpoints 401 without cookie; wrong password 401 | ✅ |
| Branch/staff/service seed | 1 | admin | create returns success + ids | ✅ |
| **QR deep-link target** | 1 | anon | `/api/barbers?branch=` lists the barber with its `branch_id` | ✅ |
| **QR walk-in booking** | 1 | anon | `/api/book` with branch+barber → 201, echoes branch | ✅ |
| Per-branch calendars | 1 | anon | (regression) branch A booking doesn't block branch B | ✅ |
| **CSV export** | 1 | admin / anon | 200 + `text/csv` + UTF-8 BOM + header + row; anon 401 | ✅ |
| **Service presets** | 1 | admin / anon | menu present publicly; re-import idempotent (added 0); anon 401 | ✅ |
| **Loyalty** | 1 | admin / anon | visits counted; reward due at target; endpoint public | ✅ |
| Privacy parity | 1 | anon | `/api/settings` hides telegram/vapid_private; exposes loyalty + staff_label | ✅ |
| **Finance — P&L** | 1 | admin | booking revenue (accepted only) + manual income; gov expense bucket; labor computed; net = revenue − labor − other; range filter excludes out-of-range | ✅ |
| **Staff compensation** | 1 | admin | commission = pct×revenue; monthly salary prorated; per-staff profitability row | ✅ |
| **Finance lockout** | 1 | anon | summary/income/expenses/portal-link all 401 | ✅ |
| **Staff portal — magic link** | 1 | staff | `/staff?t=` sets session; `/api/staff/me` scoped to self; bookings/income/reviews own-only; earnings = commission + salary | ✅ |
| **Staff isolation** | 1 | staff / anon | invalid token → no access; logout revokes; every `/api/staff/*` 401 for anon; delete non-owned gallery 404 | ✅ |
| **Per-staff reviews** | 1 | anon / staff | review attributes to active barber; staff sees own attributed reviews | ✅ |
| **i18n — English storefront** | 1 | anon | `/api/services` exposes `name_en` for the language toggle | ✅ |
| **Language toggle** | 1.5 | anon (browser) | EN/AR toggle flips dir rtl↔ltr, translates static + dynamic (services, "min", staff card), persists across nav, staff-vertical heading round-trips with brand.js | ✅ verified |
| **Finance dashboard** | 1.5 | admin (browser) | KPIs render; add-income updates revenue/net live; per-staff table; comp persists into P&L | ✅ verified |
| **Staff portal** | 1.5 | staff (browser) | rating, bookings, income breakdown, reviews, gallery upload/list/delete, logout→denied | ✅ verified |
| **QR lock — reachability** | 1.5 | anon (browser) | `/book?barber=1`: lock banner, branch+staff steps hidden, dots renumbered, **booking completes & persists with that barber+branch** | ✅ verified |
| Loyalty widget render | 1.5 | anon (browser) | punch card shows when enabled | ✅ verified |
| QR page generation | 2 | admin (browser) | 1 salon + N branch + N staff cards, each with QR img + download | ✅ verified |
| Import-presets button | 2 | admin (browser) | click grows the service list | ✅ verified |
| Loyalty settings | 2 | admin (browser) | card loads saved values | ✅ verified |
| CSV button wiring | 2 | admin (browser) | link present → `/api/admin/bookings.csv` | ✅ verified |
| Render — zero console errors | 2 | both (browser) | `/book`, `/admin`, `/admin/qr`, `/admin/services`, `/admin/settings` clean | ✅ verified |

## Pass gate
- **Green ×2**: `run-api.mjs` runs the full suite twice on the same server/DB; both must be green. Current: **130/130 ×2**.
- Per-run unique tokens/phones keep re-runs collision-free.
- Public flows are asserted **as the anonymous customer** (no admin cookie), per the guideline's "no more admin" rule.
- Staff flows are asserted **as the staff member** (magic-link cookie only), never the admin cookie.
- i18n dictionaries checked for AR/EN key parity (102 keys each).

## Not yet covered (next pass)
- Automated WhatsApp reminders (blocked on WhatsApp Business API).
- Push-notification delivery to a real device (can't be exercised headless).
- Full EN translation of the admin panel (admin intentionally stays Arabic).
