// ============================================================
// Admin QR — one general code + a per-branch and per-staff code.
// Scanning a staff code deep-links to /book?barber=<id>, which locks
// that staff member and drops the customer into the booking flow.
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('qr-grid');

  fetch('/api/auth/check').then(r => r.json())
    .then(d => { if (!d.authenticated) location.href = '/login'; else init(); })
    .catch(() => location.href = '/login');

  document.getElementById('logout-btn').addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).then(() => location.href = '/login');
  });

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function qrDataUrl(url) {
    const qr = qrcode(0, 'H');     // auto type, high error-correction
    qr.addData(url);
    qr.make();
    // Pull the data-URI out of the generated <img> tag.
    const tag = qr.createImgTag(6, 2);
    const m = tag.match(/src="([^"]+)"/);
    return m ? m[1] : '';
  }

  function safeFile(s) {
    return String(s || 'qr').replace(/[^\w؀-ۿ-]+/g, '_').slice(0, 40);
  }

  function card({ title, subtitle, url, file }) {
    const src = qrDataUrl(url);
    const el = document.createElement('div');
    el.className = 'card';
    el.style.textAlign = 'center';
    el.innerHTML = `
      <h3 style="margin:0 0 0.25rem;">${esc(title)}</h3>
      ${subtitle ? `<div class="text-muted" style="font-size:0.85rem;margin-bottom:0.75rem;">${esc(subtitle)}</div>` : ''}
      <div style="background:#fff;padding:0.75rem;border-radius:8px;display:inline-block;">
        <img src="${src}" alt="QR" style="display:block;width:160px;height:160px;image-rendering:pixelated;">
      </div>
      <div class="text-muted" style="font-size:0.72rem;direction:ltr;margin-top:0.5rem;word-break:break-all;">${esc(url)}</div>
      <button class="btn btn-outline btn-sm mt-2" style="width:100%;">⬇️ تنزيل</button>`;
    el.querySelector('button').addEventListener('click', () => {
      const a = document.createElement('a');
      a.href = src; a.download = `qr-${safeFile(file)}.gif`;
      document.body.appendChild(a); a.click(); a.remove();
    });
    return el;
  }

  async function init() {
    const origin = location.origin;
    let branches = [], barbers = [];
    try { branches = await (await fetch('/api/admin/branches')).json(); } catch (_) {}
    try { barbers = await (await fetch('/api/admin/barbers')).json(); } catch (_) {}

    const staffWord = (window.getStaffLabel ? window.getStaffLabel() : 'حلاق');
    const salonName = (window.SALON && window.SALON.salon_name) || 'الصالون';
    grid.innerHTML = '';

    // 1) General salon QR → homepage
    grid.appendChild(card({
      title: `🏠 ${salonName}`,
      subtitle: 'الرمز العام — الصفحة الرئيسية',
      url: `${origin}/`,
      file: 'salon',
    }));

    // 2) One QR per active branch → books at that branch
    (branches || []).filter(b => b.is_active).forEach(b => {
      grid.appendChild(card({
        title: `🏢 ${b.name}`,
        subtitle: 'حجز في هذا الفرع',
        url: `${origin}/book?branch=${b.id}`,
        file: `branch-${b.name}`,
      }));
    });

    // 3) One QR per active staff member → books with that person
    (barbers || []).filter(b => b.is_active).forEach(b => {
      grid.appendChild(card({
        title: `💈 ${b.name}`,
        subtitle: `حجز مباشر مع هذا ${staffWord}`,
        url: `${origin}/book?barber=${b.id}`,
        file: `staff-${b.name}`,
      }));
    });
  }
});
