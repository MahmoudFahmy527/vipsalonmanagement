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
      const barbers = await (await fetch('/api/admin/barbers')).json();
      render(barbers);
    } catch (_) {
      listEl.innerHTML = '<div class="empty-state"><p>⚠️ تعذر تحميل الحلاقين</p></div>';
    }
  }

  function render(barbers) {
    if (!barbers.length) {
      listEl.innerHTML = '<div class="empty-state"><div class="empty-icon">💈</div><h3>لا يوجد حلاقون بعد</h3><p>أضف أول حلاق ليتمكن العملاء من الاختيار.</p></div>';
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
        if (!confirm(`حذف الحلاق "${b.name}"؟`)) return;
        await fetch(`/api/admin/barbers/${b.id}`, { method: 'DELETE' });
        showToast('تم الحذف');
        load();
      });
      listEl.appendChild(card);
    });
  }

  // Modal
  function openModal(b) {
    document.getElementById('modal-title').textContent = b ? 'تعديل حلاق' : 'إضافة حلاق';
    document.getElementById('barber-id').value = b ? b.id : '';
    document.getElementById('barber-name').value = b ? b.name : '';
    document.getElementById('barber-specialty').value = b ? (b.specialty || '') : '';
    document.getElementById('barber-sort').value = b ? (b.sort_order || 0) : 0;
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
    if (!name) { showToast('الاسم مطلوب', 'error'); return; }

    const body = JSON.stringify({ name, specialty, sort_order });
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
