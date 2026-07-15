// ============================================================
// Admin Branches — locations, each with its own hours + calendar
// ============================================================
(function () {
  'use strict';

  const listEl = document.getElementById('branches-list');
  const modal = document.getElementById('branch-modal');
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
  const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  function scheduleSummary(b) {
    const days = String(b.work_days || '').split(',').map(s => s.trim()).filter(Boolean);
    let out = days.length ? days.map(d => DAY_SHORT[Number(d)]).join('، ') : 'كل الأيام';
    if (b.work_start != null && b.work_end != null) out += ` · ${b.work_start}:00–${b.work_end}:00`;
    const off = String(b.off_dates || '').split(',').map(s => s.trim()).filter(Boolean);
    if (off.length) out += ` · ${off.length} إغلاق`;
    return out;
  }

  // Auth guard
  fetch('/api/auth/check').then(r => r.json())
    .then(d => { if (!d.authenticated) location.href = '/login'; else load(); })
    .catch(() => location.href = '/login');

  document.getElementById('logout-btn').addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).then(() => location.href = '/login');
  });

  async function load() {
    listEl.innerHTML = '<div class="flex-center mt-3"><div class="spinner"></div></div>';
    try {
      render(await (await fetch('/api/admin/branches')).json());
    } catch (_) {
      listEl.innerHTML = '<div class="empty-state"><p>⚠️ تعذر تحميل الفروع</p></div>';
    }
  }

  function render(branches) {
    if (!branches.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">🏢</div><h3>لا توجد فروع</h3><p>أضف فرعاً لكل موقع إذا كان لديك أكثر من فرع.</p></div>';
      return;
    }
    listEl.innerHTML = '';
    branches.forEach(b => {
      const card = document.createElement('div');
      card.className = 'card booking-card';
      card.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;';
      const dim = b.is_active ? '' : 'opacity:0.5;';
      card.innerHTML = `
        <div class="flex" style="align-items:center;gap:0.9rem;${dim}">
          <div class="barber-avatar" style="margin:0;width:48px;height:48px;font-size:1.2rem;">🏢</div>
          <div>
            <h4 style="margin:0;">${esc(b.name)} ${b.is_active ? '' : '<span class="badge badge-rejected">مخفي</span>'}</h4>
            ${b.address ? `<div class="text-muted" style="font-size:0.85rem;">📍 ${esc(b.address)}</div>` : ''}
            ${b.phone ? `<div class="text-muted" style="font-size:0.8rem;" dir="ltr">📞 ${esc(b.phone)}</div>` : ''}
            <div class="text-muted" style="font-size:0.8rem;">🗓️ ${scheduleSummary(b)}</div>
          </div>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" data-edit>✏️ تعديل</button>
          <button class="btn btn-secondary btn-sm" data-toggle>${b.is_active ? '🙈 إخفاء' : '👁️ إظهار'}</button>
          <button class="btn btn-danger btn-sm" data-del>🗑️ حذف</button>
        </div>`;

      card.querySelector('[data-edit]').addEventListener('click', () => openModal(b));
      card.querySelector('[data-toggle]').addEventListener('click', async () => {
        await fetch(`/api/admin/branches/${b.id}/toggle`, { method: 'PUT' });
        load();
      });
      card.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm(`حذف الفرع "${b.name}"؟ سيتم فصل الموظفين عنه.`)) return;
        await fetch(`/api/admin/branches/${b.id}`, { method: 'DELETE' });
        showToast('تم الحذف');
        load();
      });
      listEl.appendChild(card);
    });
  }

  // ---- Schedule editor ----
  let offDates = [];
  const workdaysEl = document.getElementById('branch-workdays');
  workdaysEl.innerHTML = DAY_NAMES.map((d, i) =>
    `<button type="button" class="workday-chip active" data-day="${i}">${d}</button>`).join('');
  workdaysEl.querySelectorAll('.workday-chip').forEach(chip =>
    chip.addEventListener('click', () => chip.classList.toggle('active')));

  function setWorkdays(csv) {
    const days = String(csv || '').split(',').map(s => s.trim()).filter(Boolean);
    const all = days.length === 0; // empty = open every day
    workdaysEl.querySelectorAll('.workday-chip').forEach(chip =>
      chip.classList.toggle('active', all || days.includes(chip.dataset.day)));
  }
  function getWorkdays() {
    const active = [...workdaysEl.querySelectorAll('.workday-chip.active')].map(c => c.dataset.day);
    return active.length === 7 ? '' : active.join(',');
  }

  function renderOffDates() {
    const el = document.getElementById('branch-offdates');
    el.innerHTML = offDates.map(d =>
      `<span class="offdate-chip">${d}<button type="button" data-off="${d}">✕</button></span>`).join('');
    el.querySelectorAll('button[data-off]').forEach(btn =>
      btn.addEventListener('click', () => { offDates = offDates.filter(x => x !== btn.dataset.off); renderOffDates(); }));
  }
  document.getElementById('add-offdate').addEventListener('click', () => {
    const input = document.getElementById('branch-offdate');
    if (input.value && !offDates.includes(input.value)) { offDates.push(input.value); offDates.sort(); renderOffDates(); }
    input.value = '';
  });

  function openModal(b) {
    document.getElementById('modal-title').textContent = b ? 'تعديل فرع' : 'إضافة فرع';
    document.getElementById('branch-id').value = b ? b.id : '';
    document.getElementById('branch-name').value = b ? b.name : '';
    document.getElementById('branch-address').value = b ? (b.address || '') : '';
    document.getElementById('branch-phone').value = b ? (b.phone || '') : '';
    document.getElementById('branch-map').value = b ? (b.map_url || '') : '';
    document.getElementById('branch-sort').value = b ? (b.sort_order || 0) : 0;
    document.getElementById('branch-start').value = (b && b.work_start != null) ? b.work_start : '';
    document.getElementById('branch-end').value = (b && b.work_end != null) ? b.work_end : '';
    setWorkdays(b ? b.work_days : '');
    offDates = b && b.off_dates ? String(b.off_dates).split(',').map(s => s.trim()).filter(Boolean) : [];
    renderOffDates();
    modal.classList.remove('hidden');
  }
  const closeModal = () => modal.classList.add('hidden');

  document.getElementById('add-btn').addEventListener('click', () => openModal(null));
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  document.getElementById('modal-save').addEventListener('click', async () => {
    const id = document.getElementById('branch-id').value;
    const name = document.getElementById('branch-name').value.trim();
    if (!name) { showToast('اسم الفرع مطلوب', 'error'); return; }

    const body = JSON.stringify({
      name,
      address: document.getElementById('branch-address').value.trim(),
      phone: document.getElementById('branch-phone').value.trim(),
      map_url: document.getElementById('branch-map').value.trim(),
      sort_order: Number(document.getElementById('branch-sort').value) || 0,
      work_days: getWorkdays(),
      off_dates: offDates.join(','),
      work_start: document.getElementById('branch-start').value,
      work_end: document.getElementById('branch-end').value,
    });
    try {
      const res = await fetch(id ? `/api/admin/branches/${id}` : '/api/admin/branches', {
        method: id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      if (!res.ok) throw new Error();
      showToast('تم الحفظ');
      closeModal();
      load();
    } catch (_) {
      showToast('تعذر الحفظ', 'error');
    }
  });
})();
