// ============================================================
// Admin Finance — income, expenses, P&L, per-staff profitability
// ============================================================
(function () {
  'use strict';
  const el = document.getElementById('fin-content');
  const toastC = document.getElementById('toast-container');
  const cur = () => (window.getCurrency ? window.getCurrency() : 'ج.م');
  const money = (v) => `${Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${cur()}`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const todayStr = () => new Date().toISOString().slice(0, 10);

  const INC_CATS = { service: 'خدمة', retail: 'بيع منتجات', tip: 'بقشيش', other: 'أخرى' };
  const EXP_CATS = { rent: 'إيجار', supplies: 'مستلزمات', utilities: 'فواتير', gov: 'رسوم حكومية (إقامة/تأمين)', marketing: 'تسويق', maintenance: 'صيانة', other: 'أخرى' };

  function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`; t.textContent = msg;
    toastC.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
  }

  fetch('/api/auth/check').then(r => r.json())
    .then(d => { if (!d.authenticated) location.href = '/login'; else load(); })
    .catch(() => location.href = '/login');
  document.getElementById('logout-btn').addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).then(() => location.href = '/login');
  });
  document.getElementById('period').addEventListener('change', load);
  document.getElementById('export-csv').addEventListener('click', () => {
    window.location.href = '/api/admin/finance.csv' + qs();
  });

  let barbers = [];

  function periodRange() {
    const p = document.getElementById('period').value;
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const fmt = (d) => d.toISOString().slice(0, 10);
    if (p === 'all') return { from: '', to: '' };
    if (p === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
    if (p === 'last') { const f = new Date(y, m - 1, 1), t = new Date(y, m, 0); return { from: fmt(f), to: fmt(t) }; }
    const f = new Date(y, m, 1), t = new Date(y, m + 1, 0); return { from: fmt(f), to: fmt(t) }; // month
  }
  const qs = () => { const { from, to } = periodRange(); const p = new URLSearchParams(); if (from) p.set('from', from); if (to) p.set('to', to); return p.toString() ? '?' + p : ''; };

  async function load() {
    el.innerHTML = '<div class="flex-center mt-3"><div class="spinner"></div></div>';
    try {
      const [fin, income, expenses] = await Promise.all([
        fetch('/api/admin/finance' + qs()).then(r => r.json()),
        fetch('/api/admin/income' + qs()).then(r => r.json()),
        fetch('/api/admin/expenses' + qs()).then(r => r.json()),
      ]);
      barbers = await fetch('/api/admin/barbers').then(r => r.json());
      render(fin, income, expenses);
    } catch (_) {
      el.innerHTML = '<div class="empty-state"><p>⚠️ تعذر تحميل البيانات المالية</p></div>';
    }
  }

  function barberOptions() {
    return '<option value="">— بدون —</option>' + barbers.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
  }
  const catOptions = (map) => Object.entries(map).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');

  function txnList(rows, kind) {
    if (!rows.length) return '<p class="text-muted" style="font-size:0.88rem;">لا توجد حركات في هذه الفترة.</p>';
    const cats = kind === 'income' ? INC_CATS : EXP_CATS;
    return rows.map(r => `
      <div class="txn-row">
        <div style="min-width:0;">
          <strong>${money(r.amount)}</strong>
          <span class="badge category-badge" style="margin-inline-start:0.4rem;">${cats[r.category] || r.category}</span>
          ${r.barber_name ? `<span class="text-muted" style="font-size:0.8rem;"> · ${esc(r.barber_name)}</span>` : ''}
          <div class="text-muted" style="font-size:0.8rem;">${r.date}${r.note ? ' — ' + esc(r.note) : ''}</div>
        </div>
        <button class="btn btn-danger btn-sm" data-del="${kind}:${r.id}">🗑️</button>
      </div>`).join('');
  }

  function render(fin, income, expenses) {
    const netColor = fin.netProfit >= 0 ? 'var(--success)' : 'var(--danger)';
    el.innerHTML = `
      <div class="kpi-grid">
        <div class="card kpi"><div class="v text-gold">${money(fin.revenue.total)}</div><div class="l">الإيرادات</div></div>
        <div class="card kpi"><div class="v" style="color:var(--danger)">${money(fin.expenses.total)}</div><div class="l">المصروفات</div></div>
        <div class="card kpi"><div class="v" style="color:${netColor}">${money(fin.netProfit)}</div><div class="l">صافي الربح</div></div>
        <div class="card kpi"><div class="v" style="color:${netColor}">${fin.margin}%</div><div class="l">هامش الربح</div></div>
      </div>

      <div class="grid-2 mb-3" style="align-items:stretch;">
        <div class="card">
          <h3 style="margin-top:0;">📈 الإيرادات</h3>
          <div class="flex-between" style="padding:0.35rem 0;"><span class="text-muted">من الحجوزات (تلقائي)</span><strong>${money(fin.revenue.bookings)}</strong></div>
          <div class="flex-between" style="padding:0.35rem 0;"><span class="text-muted">دخل يدوي مضاف</span><strong>${money(fin.revenue.manual)}</strong></div>
          <div class="flex-between" style="padding:0.5rem 0 0;border-top:1px solid var(--border-color);"><strong>الإجمالي</strong><strong class="text-gold">${money(fin.revenue.total)}</strong></div>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">📉 المصروفات</h3>
          <div class="flex-between" style="padding:0.35rem 0;"><span class="text-muted">رواتب وعمولات (تلقائي)</span><strong>${money(fin.expenses.labor)}</strong></div>
          <div class="flex-between" style="padding:0.35rem 0;"><span class="text-muted">مصروفات أخرى</span><strong>${money(fin.expenses.other)}</strong></div>
          <div class="flex-between" style="padding:0.5rem 0 0;border-top:1px solid var(--border-color);"><strong>الإجمالي</strong><strong style="color:var(--danger)">${money(fin.expenses.total)}</strong></div>
        </div>
      </div>

      ${fin.byBarber.length ? `
      <div class="card mb-3">
        <h3 style="margin-top:0;">👤 ربحية كل فرد</h3>
        <div class="fin-scroll"><table class="fin-table">
          <thead><tr><th>الاسم</th><th>الجلسات</th><th>الإيراد</th><th>العمولة</th><th>الراتب</th><th>التكلفة</th><th>الربح للصالون</th></tr></thead>
          <tbody>${fin.byBarber.map(b => `
            <tr>
              <td>${esc(b.name)}</td><td>${b.count}</td>
              <td class="text-gold">${money(b.revenue)}</td>
              <td>${b.commission_enabled ? money(b.commission) + ` <span class="text-muted">(${b.commission_pct}%)</span>` : '—'}</td>
              <td>${b.salary_type !== 'none' ? money(b.salary) : '—'}</td>
              <td>${money(b.cost)}</td>
              <td style="color:${b.profit >= 0 ? 'var(--success)' : 'var(--danger)'}">${money(b.profit)}</td>
            </tr>`).join('')}</tbody>
        </table></div>
        <p class="text-muted" style="font-size:0.78rem;margin:0.6rem 0 0;">الرواتب والعمولات تُحتسب تلقائياً من إعداد كل فرد — لا تُضِفها كمصروف يدوي. الإقامة/التأمين أضِفها كمصروف باسم الفرد.</p>
      </div>` : ''}

      <div class="grid-2" style="align-items:stretch;">
        <div class="card">
          <h3 style="margin-top:0;">➕ إضافة دخل</h3>
          <div class="form-group"><input class="form-input" id="inc-amount" type="number" min="0" step="0.5" placeholder="المبلغ"></div>
          <div class="flex gap-2" style="flex-wrap:wrap;">
            <input class="form-input" id="inc-date" type="date" style="flex:1;color-scheme:dark;" value="${todayStr()}">
            <select class="form-select" id="inc-cat" style="flex:1;">${catOptions(INC_CATS)}</select>
          </div>
          <div class="form-group mt-2"><input class="form-input" id="inc-note" placeholder="ملاحظة (اختياري)"></div>
          <button class="btn btn-gold w-full" id="add-inc">إضافة دخل</button>
          <div style="margin-top:1rem;">${txnList(income, 'income')}</div>
        </div>
        <div class="card">
          <h3 style="margin-top:0;">➖ إضافة مصروف</h3>
          <div class="form-group"><input class="form-input" id="exp-amount" type="number" min="0" step="0.5" placeholder="المبلغ"></div>
          <div class="flex gap-2" style="flex-wrap:wrap;">
            <input class="form-input" id="exp-date" type="date" style="flex:1;color-scheme:dark;" value="${todayStr()}">
            <select class="form-select" id="exp-cat" style="flex:1;">${catOptions(EXP_CATS)}</select>
          </div>
          <div class="form-group mt-2">
            <select class="form-select" id="exp-barber">${barberOptions()}</select>
            <div class="text-muted" style="font-size:0.78rem;margin-top:0.2rem;">اختر الفرد لمصروفات مثل الإقامة/التأمين.</div>
          </div>
          <div class="form-group"><input class="form-input" id="exp-note" placeholder="ملاحظة (اختياري)"></div>
          <button class="btn btn-danger w-full" id="add-exp">إضافة مصروف</button>
          <div style="margin-top:1rem;">${txnList(expenses, 'expense')}</div>
        </div>
      </div>`;

    document.getElementById('add-inc').addEventListener('click', addIncome);
    document.getElementById('add-exp').addEventListener('click', addExpense);
    el.querySelectorAll('[data-del]').forEach(btn => btn.addEventListener('click', () => delTxn(btn.dataset.del)));
  }

  async function addIncome() {
    const amount = Number(document.getElementById('inc-amount').value);
    const date = document.getElementById('inc-date').value;
    if (!(amount > 0) || !date) { showToast('أدخل المبلغ والتاريخ', 'error'); return; }
    const body = { amount, date, category: document.getElementById('inc-cat').value, note: document.getElementById('inc-note').value.trim() };
    const res = await fetch('/api/admin/income', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { showToast('تمت إضافة الدخل'); load(); } else { showToast('تعذر الحفظ', 'error'); }
  }
  async function addExpense() {
    const amount = Number(document.getElementById('exp-amount').value);
    const date = document.getElementById('exp-date').value;
    if (!(amount > 0) || !date) { showToast('أدخل المبلغ والتاريخ', 'error'); return; }
    const barberV = document.getElementById('exp-barber').value;
    const body = { amount, date, category: document.getElementById('exp-cat').value, note: document.getElementById('exp-note').value.trim(), barber_id: barberV ? Number(barberV) : null };
    const res = await fetch('/api/admin/expenses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) { showToast('تمت إضافة المصروف'); load(); } else { showToast('تعذر الحفظ', 'error'); }
  }
  async function delTxn(key) {
    const [kind, id] = key.split(':');
    if (!confirm('حذف هذه الحركة؟')) return;
    const path = kind === 'income' ? `/api/admin/income/${id}` : `/api/admin/expenses/${id}`;
    await fetch(path, { method: 'DELETE' });
    showToast('تم الحذف'); load();
  }
})();
