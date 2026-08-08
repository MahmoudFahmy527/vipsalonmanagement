// ============================================================
// Staff Portal — magic-link scoped view of one staff member's
// bookings, income, reviews, and gallery.
// ============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const toastC = $('toast-container');
  const cur = () => (window.getCurrency ? window.getCurrency() : 'ج.م');
  const money = (v) => `${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur()}`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));

  function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`; t.textContent = msg;
    toastC.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
  }

  const STATUS_AR = { pending: 'قيد الانتظار', accepted: 'مقبول', rejected: 'مرفوض', reserved: 'محجوز' };

  // ── Boot ──
  fetch('/api/staff/me').then(r => r.json().then(j => ({ ok: r.ok, j })))
    .then(({ ok, j }) => {
      if (!ok) { $('denied').classList.remove('hidden'); return; }
      startPortal(j);
    })
    .catch(() => $('denied').classList.remove('hidden'));

  function startPortal(me) {
    $('portal').classList.remove('hidden');
    $('logout-btn').classList.remove('hidden');
    $('staff-name').textContent = me.barber.name;
    $('hi').textContent = `أهلاً، ${me.barber.name} 👋`;
    $('specialty').textContent = me.barber.specialty || '';
    if (me.rating && me.rating.count) {
      $('rating-badge').innerHTML = `<span class="stars">${stars(me.rating.avg)}</span> ${me.rating.avg} <span class="text-muted">(${me.rating.count} تقييم)</span>`;
    } else {
      $('rating-badge').innerHTML = '<span class="text-muted">لا تقييمات بعد</span>';
    }

    $('logout-btn').addEventListener('click', () => {
      fetch('/api/staff/logout', { method: 'POST' }).then(() => location.reload());
    });

    // Tabs
    document.querySelectorAll('.staff-tab').forEach(btn => btn.addEventListener('click', () => {
      document.querySelectorAll('.staff-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      ['bookings', 'income', 'reviews', 'gallery'].forEach(t =>
        $('tab-' + t).classList.toggle('hidden', t !== btn.dataset.tab));
      if (btn.dataset.tab === 'income') loadIncome();
      if (btn.dataset.tab === 'reviews') loadReviews();
      if (btn.dataset.tab === 'gallery') loadGallery();
    }));

    $('inc-period').addEventListener('change', loadIncome);
    $('g-upload').addEventListener('click', uploadGallery);

    loadBookings();
  }

  // ── Bookings ──
  function bkRow(b) {
    const price = b.service_price != null ? ` · ${money(b.service_price)}` : '';
    return `<div class="bk-row">
      <div>
        <strong>${esc(b.customer_name || 'عميل')}</strong>
        <div class="text-muted" style="font-size:0.83rem;">${esc(b.service_name || '')}${price}${b.branch_name ? ' · ' + esc(b.branch_name) : ''}</div>
      </div>
      <div style="text-align:end;">
        <div>${b.date} · ${b.time_slot}</div>
        <span class="badge badge-${b.status}">${STATUS_AR[b.status] || b.status}</span>
      </div>
    </div>`;
  }
  async function loadBookings() {
    const rows = await fetch('/api/staff/bookings').then(r => r.json()).catch(() => []);
    const today = todayStr();
    const upcoming = rows.filter(b => b.date >= today && b.status !== 'rejected');
    const history = rows.filter(b => b.date < today || b.status === 'rejected');
    const accepted = rows.filter(b => b.status === 'accepted').length;
    $('bk-kpis').innerHTML = `
      <div class="card kpi"><div class="v text-gold">${upcoming.length}</div><div class="l">حجوزات قادمة</div></div>
      <div class="card kpi"><div class="v">${rows.length}</div><div class="l">إجمالي الحجوزات</div></div>
      <div class="card kpi"><div class="v" style="color:var(--success)">${accepted}</div><div class="l">جلسات مكتملة</div></div>`;
    $('bk-upcoming').innerHTML = upcoming.length ? upcoming.slice().reverse().map(bkRow).join('') : '<p class="text-muted">لا حجوزات قادمة.</p>';
    $('bk-history').innerHTML = history.length ? history.map(bkRow).join('') : '<p class="text-muted">لا سجل بعد.</p>';
  }

  // ── Income ──
  function incRange() {
    const p = $('inc-period').value;
    const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
    const fmt = (d) => d.toISOString().slice(0, 10);
    if (p === 'all') return { from: '', to: '' };
    if (p === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
    if (p === 'last') return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) };
    return { from: fmt(new Date(y, m, 1)), to: fmt(new Date(y, m + 1, 0)) };
  }
  const SAL_AR = { none: 'بدون', hourly: 'بالساعة', daily: 'يومي', monthly: 'شهري' };
  async function loadIncome() {
    $('income-content').innerHTML = '<div class="flex-center mt-3"><div class="spinner"></div></div>';
    const { from, to } = incRange();
    const p = new URLSearchParams(); if (from) p.set('from', from); if (to) p.set('to', to);
    const d = await fetch('/api/staff/income?' + p).then(r => r.json()).catch(() => null);
    if (!d) { $('income-content').innerHTML = '<p class="text-muted">تعذر التحميل.</p>'; return; }
    const net = d.earnings - d.govExpenses;
    $('income-content').innerHTML = `
      <div class="kpi-grid">
        <div class="card kpi"><div class="v text-gold">${money(d.earnings)}</div><div class="l">صافي مستحقاتك</div></div>
        <div class="card kpi"><div class="v">${money(d.revenue)}</div><div class="l">إيراد جلساتك</div></div>
        <div class="card kpi"><div class="v">${d.count}</div><div class="l">جلسات مكتملة</div></div>
      </div>
      <div class="card">
        <div class="bk-row"><span class="text-muted">إيراد الحجوزات المكتملة</span><strong>${money(d.revenue)}</strong></div>
        <div class="bk-row"><span class="text-muted">العمولة ${d.commission_enabled ? `(${d.commission_pct}%)` : '(غير مفعّلة)'}</span><strong>${money(d.commission)}</strong></div>
        <div class="bk-row"><span class="text-muted">الراتب (${SAL_AR[d.salary_type] || d.salary_type})</span><strong>${money(d.salary)}</strong></div>
        <div class="bk-row"><strong>مستحقاتك (عمولة + راتب)</strong><strong class="text-gold">${money(d.earnings)}</strong></div>
        <div class="bk-row"><span class="text-muted">خصومات (إقامة/تأمين)</span><strong style="color:var(--danger)">${money(d.govExpenses)}</strong></div>
        <div class="bk-row"><strong>الصافي بعد الخصومات</strong><strong style="color:${net >= 0 ? 'var(--success)' : 'var(--danger)'}">${money(net)}</strong></div>
      </div>
      <p class="text-muted" style="font-size:0.8rem;margin-top:0.6rem;">تُحتسب المستحقات تلقائياً من الحجوزات المقبولة وإعدادات أجرك.</p>`;
  }

  // ── Reviews ──
  async function loadReviews() {
    $('reviews-content').innerHTML = '<div class="flex-center mt-3"><div class="spinner"></div></div>';
    const rows = await fetch('/api/staff/reviews').then(r => r.json()).catch(() => []);
    if (!rows.length) { $('reviews-content').innerHTML = '<div class="empty-state"><div class="empty-icon">⭐</div><p>لا تقييمات موجهة إليك بعد.</p></div>'; return; }
    $('reviews-content').innerHTML = rows.map(r => `
      <div class="card mb-2">
        <div class="flex-between"><strong>${esc(r.name)}</strong><span class="stars">${stars(r.rating)}</span></div>
        ${r.review_text ? `<p class="text-muted" style="margin:0.4rem 0 0;">${esc(r.review_text)}</p>` : ''}
        <div class="text-muted" style="font-size:0.78rem;margin-top:0.3rem;">${(r.created_at || '').slice(0, 10)}</div>
      </div>`).join('');
  }

  // ── Gallery ──
  async function loadGallery() {
    $('gallery-content').innerHTML = '<div class="flex-center mt-3"><div class="spinner"></div></div>';
    const rows = await fetch('/api/staff/gallery').then(r => r.json()).catch(() => []);
    if (!rows.length) { $('gallery-content').innerHTML = '<div class="empty-state"><div class="empty-icon">🖼️</div><p>لم تُضِف أي صور بعد.</p></div>'; return; }
    const grid = document.createElement('div');
    grid.className = 'staff-gallery';
    grid.innerHTML = rows.map(g => {
      const media = g.type === 'video'
        ? `<video src="/uploads/${esc(g.filename)}" muted></video>`
        : `<img src="/uploads/${esc(g.filename)}" alt="">`;
      const pend = g.status === 'pending' ? '<span class="badge badge-pending" style="position:absolute;top:6px;inset-inline-start:6px;">بانتظار الموافقة</span>' : '';
      return `<figure>${media}${pend}<button class="btn btn-danger btn-sm del" data-del="${g.id}">🗑️</button></figure>`;
    }).join('');
    $('gallery-content').innerHTML = '';
    $('gallery-content').appendChild(grid);
    grid.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('حذف هذه الصورة؟')) return;
      const res = await fetch('/api/staff/gallery/' + btn.dataset.del, { method: 'DELETE' });
      if (res.ok) { showToast('تم الحذف'); loadGallery(); } else showToast('تعذر الحذف', 'error');
    }));
  }
  async function uploadGallery() {
    const file = $('g-file').files[0];
    if (!file) { showToast('اختر ملفاً أولاً', 'error'); return; }
    const fd = new FormData();
    fd.append('media', file);
    fd.append('description', $('g-desc').value.trim());
    $('g-upload').disabled = true;
    try {
      const res = await fetch('/api/staff/gallery', { method: 'POST', body: fd });
      if (!res.ok) throw new Error();
      showToast('تم الرفع'); $('g-file').value = ''; $('g-desc').value = ''; loadGallery();
    } catch (_) { showToast('تعذر الرفع', 'error'); }
    finally { $('g-upload').disabled = false; }
  }
})();
