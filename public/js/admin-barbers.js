// ============================================================
// Admin Barbers — manage staff + per-barber calendars
// ============================================================
(function () {
  'use strict';

  const listEl = document.getElementById('barbers-list');
  const modal = document.getElementById('barber-modal');
  const toastC = document.getElementById('toast-container');

  function showToast(msg, type = 'success') {
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = msg;
    toastC.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
  }

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const DAY_SHORT = ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];
  function scheduleSummary(b) {
    const days = String(b.work_days || '').split(',').map(s => s.trim()).filter(Boolean);
    let out = days.length ? days.map(d => DAY_SHORT[Number(d)]).join('، ') : 'كل الأيام';
    if (b.work_start != null && b.work_end != null) out += ` · ${b.work_start}:00–${b.work_end}:00`;
    const off = String(b.off_dates || '').split(',').map(s => s.trim()).filter(Boolean);
    if (off.length) out += ` · ${off.length} إجازة`;
    return out;
  }

  // Auth guard
  fetch('/api/auth/check').then(r => r.json())
    .then(d => { if (!d.authenticated) location.href = '/login'; else load(); })
    .catch(() => location.href = '/login');

  document.getElementById('logout-btn').addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).then(() => location.href = '/login');
  });

  // Branches (only shown when the salon actually has some)
  let branches = [];
  async function loadBranches() {
    try { branches = await (await fetch('/api/admin/branches')).json(); } catch (_) { branches = []; }
    const group = document.getElementById('barber-branch-group');
    const sel = document.getElementById('barber-branch');
    if (!branches.length) { group.style.display = 'none'; return; }
    sel.innerHTML = '<option value="">— بدون فرع —</option>' +
      branches.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    group.style.display = '';
  }

  async function load() {
    listEl.innerHTML = '<div class="flex-center mt-3"><div class="spinner"></div></div>';
    try {
      await loadBranches();
      const barbers = await (await fetch('/api/admin/barbers')).json();
      render(barbers);
    } catch (_) {
      listEl.innerHTML = '<div class="empty-state"><p>⚠️ تعذر تحميل الحلاقين</p></div>';
    }
  }

  function render(barbers) {
    if (!barbers.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">💈</div><h3>لا يوجد أعضاء بعد</h3><p>أضف أول عضو ليتمكن العملاء من الاختيار.</p></div>';
      return;
    }
    listEl.innerHTML = '';
    barbers.forEach(b => {
      const card = document.createElement('div');
      card.className = 'card booking-card';
      card.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;';
      const dim = b.is_active ? '' : 'opacity:0.5;';
      card.innerHTML = `
        <div class="flex" style="align-items:center;gap:0.9rem;${dim}">
          <div class="barber-avatar" style="margin:0;width:48px;height:48px;font-size:1.3rem;">${esc((b.name || '?').trim().charAt(0))}</div>
          <div>
            <h4 style="margin:0;">${esc(b.name)} ${b.is_active ? '' : '<span class="badge badge-rejected">مخفي</span>'}</h4>
            ${b.specialty ? `<div class="text-muted" style="font-size:0.85rem;">${esc(b.specialty)}</div>` : ''}
            <div class="text-muted" style="font-size:0.8rem;">🗓️ ${scheduleSummary(b)}</div>
          </div>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" data-edit="${b.id}">✏️ تعديل</button>
          <button class="btn btn-secondary btn-sm" data-toggle="${b.id}">${b.is_active ? '🙈 إخفاء' : '👁️ إظهار'}</button>
          <button class="btn btn-danger btn-sm" data-del="${b.id}">🗑️ حذف</button>
        </div>`;

      card.querySelector('[data-edit]').addEventListener('click', () => openModal(b));
      card.querySelector('[data-toggle]').addEventListener('click', async () => {
        await fetch(`/api/admin/barbers/${b.id}/toggle`, { method: 'PUT' });
        load();
      });
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm(`حذف "${b.name}"؟`)) return;
        await fetch(`/api/admin/barbers/${b.id}`, { method: 'DELETE' });
        showToast('تم الحذف');
        load();
      });
      listEl.appendChild(card);
    });
  }

  // ---- Schedule editor state ----
  const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  let offDates = [];

  // Build the weekday chips once.
  const workdaysEl = document.getElementById('barber-workdays');
  workdaysEl.innerHTML = DAY_NAMES.map((d, i) =>
    `<button type="button" class="workday-chip active" data-day="${i}">${d}</button>`).join('');
  workdaysEl.querySelectorAll('.workday-chip').forEach(chip =>
    chip.addEventListener('click', () => chip.classList.toggle('active')));

  function setWorkdays(csv) {
    // Empty csv = works every day → all active.
    const days = String(csv || '').split(',').map(s => s.trim()).filter(Boolean);
    const all = days.length === 0;
    workdaysEl.querySelectorAll('.workday-chip').forEach(chip => {
      chip.classList.toggle('active', all || days.includes(chip.dataset.day));
    });
  }
  function getWorkdays() {
    const active = [...workdaysEl.querySelectorAll('.workday-chip.active')].map(c => c.dataset.day);
    // All 7 selected → store empty (= every day).
    return active.length === 7 ? '' : active.join(',');
  }

  function renderOffDates() {
    const el = document.getElementById('barber-offdates');
    el.innerHTML = offDates.map(d =>
      `<span class="offdate-chip">${d}<button type="button" data-off="${d}">✕</button></span>`).join('');
    el.querySelectorAll('button[data-off]').forEach(btn =>
      btn.addEventListener('click', () => { offDates = offDates.filter(x => x !== btn.dataset.off); renderOffDates(); }));
  }
  document.getElementById('add-offdate').addEventListener('click', () => {
    const input = document.getElementById('barber-offdate');
    const v = input.value;
    if (v && !offDates.includes(v)) { offDates.push(v); offDates.sort(); renderOffDates(); }
    input.value = '';
  });

  // Modal
  function openModal(b) {
    document.getElementById('modal-title').textContent = b ? 'تعديل' : 'إضافة';
    document.getElementById('barber-id').value = b ? b.id : '';
    document.getElementById('barber-name').value = b ? b.name : '';
    document.getElementById('barber-specialty').value = b ? (b.specialty || '') : '';
    document.getElementById('barber-sort').value = b ? (b.sort_order || 0) : 0;
    document.getElementById('barber-branch').value = (b && b.branch_id != null) ? String(b.branch_id) : '';
    document.getElementById('barber-start').value = (b && b.work_start != null) ? b.work_start : '';
    document.getElementById('barber-end').value = (b && b.work_end != null) ? b.work_end : '';
    setWorkdays(b ? b.work_days : '');
    offDates = b && b.off_dates ? String(b.off_dates).split(',').map(s => s.trim()).filter(Boolean) : [];
    renderOffDates();
    modal.classList.remove('hidden');
  }
  function closeModal() { modal.classList.add('hidden'); }

  document.getElementById('add-btn').addEventListener('click', () => openModal(null));
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('modal-save').addEventListener('click', async () => {
    const id = document.getElementById('barber-id').value;
    const name = document.getElementById('barber-name').value.trim();
    const specialty = document.getElementById('barber-specialty').value.trim();
    const sort_order = Number(document.getElementById('barber-sort').value) || 0;
    const startV = document.getElementById('barber-start').value;
    const endV = document.getElementById('barber-end').value;
    if (!name) { showToast('الاسم مطلوب', 'error'); return; }

    const branchV = document.getElementById('barber-branch').value;
    const body = JSON.stringify({
      name, specialty, sort_order,
      branch_id: branchV === '' ? null : Number(branchV),
      work_days: getWorkdays(),
      off_dates: offDates.join(','),
      work_start: startV === '' ? null : Number(startV),
      work_end: endV === '' ? null : Number(endV),
    });
    const url = id ? `/api/admin/barbers/${id}` : '/api/admin/barbers';
    const method = id ? 'PUT' : 'POST';
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body });
      if (!res.ok) throw new Error();
      showToast('تم الحفظ');
      closeModal();
      load();
    } catch (_) {
      showToast('تعذر الحفظ', 'error');
    }
  });
})();
