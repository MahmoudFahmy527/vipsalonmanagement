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
| **QR lock — reachability** | 1.5 | anon (browser) | `/book?barber=1`: lock banner, branch+staff steps hidden, dots renumbered, **booking completes & persists with that barber+branch** | ✅ verified |
| Loyalty widget render | 1.5 | anon (browser) | punch card shows when enabled | ✅ verified |
| QR page generation | 2 | admin (browser) | 1 salon + N branch + N staff cards, each with QR img + download | ✅ verified |
| Import-presets button | 2 | admin (browser) | click grows the service list | ✅ verified |
| Loyalty settings | 2 | admin (browser) | card loads saved values | ✅ verified |
| CSV button wiring | 2 | admin (browser) | link present → `/api/admin/bookings.csv` | ✅ verified |
| Render — zero console errors | 2 | both (browser) | `/book`, `/admin`, `/admin/qr`, `/admin/services`, `/admin/settings` clean | ✅ verified |

## Pass gate
- **Green ×2**: `run-api.mjs` runs the full suite twice on the same server/DB; both must be green. Current: **54/54 ×2**.
- Per-run unique tokens/phones keep re-runs collision-free.
- Public flows are asserted **as the anonymous customer** (no admin cookie), per the guideline's "no more admin" rule.

## Not yet covered (next pass)
- Multi-language toggle (feature not built yet).
- Automated WhatsApp reminders (blocked on WhatsApp Business API).
- Push-notification delivery to a real device (can't be exercised headless).
