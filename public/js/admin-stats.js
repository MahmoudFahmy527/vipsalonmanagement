// ============================================================
// Admin Analytics dashboard
// ============================================================
(function () {
  'use strict';

  const el = document.getElementById('stats-content');
  const cur = () => (window.getCurrency ? window.getCurrency() : 'ج.م');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  fetch('/api/auth/check').then(r => r.json())
    .then(d => { if (!d.authenticated) location.href = '/login'; else load(); })
    .catch(() => location.href = '/login');

  document.getElementById('logout-btn').addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).then(() => location.href = '/login');
  });

  async function load() {
    try {
      const s = await (await fetch('/api/admin/stats')).json();
      render(s);
    } catch (_) {
      el.innerHTML = '<div class="empty-state"><p>⚠️ تعذر تحميل الإحصائيات</p></div>';
    }
  }

  const DAY = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  const money = (v) => `${Number(v || 0).toLocaleString('en-US')} ${cur()}`;

  function statCard(num, label, color) {
    return `<div class="card stat-card"><div class="stat-number" style="${color ? `color:${color}` : ''}">${num}</div><div class="stat-label">${label}</div></div>`;
  }

  function rankList(rows, emptyMsg) {
    if (!rows || !rows.length) return `<p class="text-muted">${emptyMsg}</p>`;
    const max = Math.max(...rows.map(r => r.c));
    return rows.map(r => `
      <div class="rank-row">
        <span style="flex:0 0 40%;">${esc(r.name || '—')}</span>
        <span class="rank-bar" style="flex:0 0 ${Math.round((r.c / max) * 45) + 5}%;"></span>
        <strong style="margin-inline-start:0.6rem;">${r.c}</strong>
      </div>`).join('');
  }

  function render(s) {
    const maxSeries = Math.max(1, ...s.series.map(p => p.count));
    const chart = s.series.map(p => {
      const d = new Date(p.date + 'T00:00:00');
      const h = Math.round((p.count / maxSeries) * 130);
      return `<div class="chart-bar" title="${p.date}: ${p.count}">
        <span class="val">${p.count || ''}</span>
        <div class="bar" style="height:${h}px;"></div>
        <span class="lbl"><span class="d">${DAY[d.getDay()]}</span> ${d.getDate()}</span>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="stats-bar">
        ${statCard(s.total, 'إجمالي الحجوزات')}
        ${statCard(s.month, 'هذا الشهر')}
        ${statCard(s.today, 'اليوم')}
        ${statCard(s.customers.total, 'العملاء')}
      </div>

      <div class="grid-2 mt-3" style="align-items:stretch;">
        <div class="card">
          <h3 style="margin-top:0;">💰 الإيرادات (المؤكدة)</h3>
          <div class="flex-between" style="margin-bottom:0.5rem;"><span class="text-muted">هذا الشهر</span><strong class="text-gold" style="font-size:1.3rem;">${money(s.revenueMonth)}</strong></div>
          <div class="flex-between"><span class="text-muted">الإجمالي</span><strong>${money(s.revenueTotal)}</strong></div>
          <p class="text-muted" style="font-size:0.78rem;margin:0.75rem 0 0;">تُحتسب من الحجوزات المقبولة فقط.</p>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">📊 حالة الحجوزات</h3>
          <div class="flex-between" style="padding:0.35rem 0;"><span>🟡 قيد الانتظار</span><strong>${s.byStatus.pending}</strong></div>
          <div class="flex-between" style="padding:0.35rem 0;"><span>🟢 مقبول</span><strong>${s.byStatus.accepted}</strong></div>
          <div class="flex-between" style="padding:0.35rem 0;"><span>🔵 محجوز</span><strong>${s.byStatus.reserved}</strong></div>
          <div class="flex-between" style="padding:0.35rem 0;"><span>🔴 مرفوض</span><strong>${s.byStatus.rejected}</strong></div>
        </div>
      </div>

      <div class="card mt-3">
        <h3 style="margin-top:0;">📈 الحجوزات — آخر 14 يوم</h3>
        <div class="chart">${chart}</div>
      </div>

      <div class="grid-2 mt-3" style="align-items:stretch;">
        <div class="card">
          <h3 style="margin-top:0;">✂️ الخدمات الأكثر طلباً</h3>
          ${rankList(s.topServices, 'لا توجد بيانات بعد')}
        </div>
        <div class="card">
          <h3 style="margin-top:0;">👥 العملاء</h3>
          <div class="flex-between" style="padding:0.4rem 0;"><span>عملاء عائدون</span><strong class="text-gold">${s.customers.returning}</strong></div>
          <div class="flex-between" style="padding:0.4rem 0;"><span>عملاء جدد</span><strong>${s.customers.new}</strong></div>
          ${s.barberLoad && s.barberLoad.length ? `<h4 style="margin:1rem 0 0.4rem;">تحميل الحلاقين</h4>${rankList(s.barberLoad, '')}` : ''}
        </div>
      </div>
    `;
  }
})();
