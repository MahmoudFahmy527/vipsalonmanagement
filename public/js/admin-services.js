// ============================================================
// Admin Services — الشرقاوي صالون
// ============================================================

(function () {
  'use strict';

  // ----------------------------------------------------------
  // Auth check
  // ----------------------------------------------------------
  fetch('/api/auth/check')
    .then(r => r.json())
    .then(d => { if (!d.authenticated) window.location.href = '/login'; })
    .catch(() => { window.location.href = '/login'; });

  // ----------------------------------------------------------
  // Toast helper
  // ----------------------------------------------------------
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ----------------------------------------------------------
  // Constants
  // ----------------------------------------------------------
  const CATEGORY_LABELS = {
    haircut: 'قص الشعر',
    beard: 'اللحية',
    skincare: 'العناية بالبشرة',
    package: 'الباقات',
    other: 'أخرى'
  };

  // ----------------------------------------------------------
  // State
  // ----------------------------------------------------------
  let allServices = [];
  let activeFilter = 'all';
  let deleteCallback = null;

  // ----------------------------------------------------------
  // DOM
  // ----------------------------------------------------------
  const servicesList = document.getElementById('services-list');
  const filterBar = document.getElementById('filter-bar');

  // Service modal
  const serviceModal = document.getElementById('service-modal');
  const serviceModalTitle = document.getElementById('service-modal-title');
  const serviceModalClose = document.getElementById('service-modal-close');
  const serviceCancelBtn = document.getElementById('service-cancel');
  const serviceSubmitBtn = document.getElementById('service-submit');
  const serviceEditId = document.getElementById('service-edit-id');
  const serviceName = document.getElementById('service-name');
  const serviceNameEn = document.getElementById('service-name-en');
  const servicePrice = document.getElementById('service-price');
  const serviceDuration = document.getElementById('service-duration');
  const serviceCategory = document.getElementById('service-category');
  const serviceDescription = document.getElementById('service-description');

  // Confirm modal
  const confirmModal = document.getElementById('confirm-modal');
  const confirmClose = document.getElementById('confirm-modal-close');
  const confirmCancelBtn = document.getElementById('confirm-cancel');
  const confirmYesBtn = document.getElementById('confirm-yes');

  // ----------------------------------------------------------
  // Load Services
  // ----------------------------------------------------------
  async function loadServices() {
    servicesList.innerHTML = '<div class="flex-center mt-3"><div class="spinner"></div></div>';

    try {
      const res = await fetch('/api/admin/services');
      if (!res.ok) throw new Error('فشل في تحميل الخدمات');
      const data = await res.json();
      allServices = data.services || data || [];
      renderServices();
    } catch (err) {
      servicesList.innerHTML = `<div class="empty-state"><p>⚠️ ${err.message}</p></div>`;
    }
  }

  function renderServices() {
    let filtered = allServices;
    if (activeFilter !== 'all') {
      filtered = allServices.filter(s => s.category === activeFilter);
    }

    if (!filtered.length) {
      servicesList.innerHTML = '<div class="empty-state"><p style="font-size:2rem;margin-bottom:0.5rem;">💇</p><p>لا توجد خدمات</p></div>';
      return;
    }

    servicesList.innerHTML = '';

    filtered.forEach((service, index) => {
      const card = document.createElement('div');
      const isHidden = service.hidden || service.is_hidden || false;
      card.className = `card service-card${isHidden ? ' hidden-service' : ''}`;

      const catLabel = CATEGORY_LABELS[service.category] || service.category || 'أخرى';
      const priceFormatted = service.price != null ? `${service.price} ${window.getCurrency ? window.getCurrency() : 'ج.م'}` : '';
      const durationFormatted = service.duration ? `${service.duration} د` : '60 د';
      const nameEn = service.name_en || service.nameEn || '';
      const desc = service.description || '';

      card.innerHTML = `
        <div class="service-info">
          <h4>${service.name}</h4>
          ${nameEn ? `<div class="service-name-en">${nameEn}</div>` : ''}
          ${desc ? `<p class="service-desc">${desc}</p>` : ''}
        </div>
        <div class="service-meta">
          <span class="service-price">${priceFormatted}</span>
          <span class="service-duration">⏱ ${durationFormatted}</span>
          <span class="category-badge">${catLabel}</span>
          ${isHidden ? '<span class="badge badge-rejected">مخفي</span>' : '<span class="badge badge-accepted">مرئي</span>'}
        </div>
        <div class="service-actions">
          <div class="order-btns">
            <button class="order-btn" title="تحريك لأعلى" data-move-up="${service.id}">▲</button>
            <button class="order-btn" title="تحريك لأسفل" data-move-down="${service.id}">▼</button>
          </div>
          <button class="visibility-btn" title="${isHidden ? 'إظهار' : 'إخفاء'}" data-toggle-id="${service.id}">${isHidden ? '👁️‍🗨️' : '👁️'}</button>
          <button class="btn btn-outline btn-sm" data-edit-id="${service.id}">✏️ تعديل</button>
          <button class="btn btn-danger btn-sm" data-delete-id="${service.id}">🗑️</button>
        </div>
      `;

      // Move up
      card.querySelector('[data-move-up]').addEventListener('click', () => moveService(service.id, 'up'));

      // Move down
      card.querySelector('[data-move-down]').addEventListener('click', () => moveService(service.id, 'down'));

      // Toggle visibility
      card.querySelector('[data-toggle-id]').addEventListener('click', () => toggleVisibility(service.id));

      // Edit
      card.querySelector('[data-edit-id]').addEventListener('click', () => openEditModal(service));

      // Delete
      card.querySelector('[data-delete-id]').addEventListener('click', () => {
        confirmModal.classList.remove('hidden');
        deleteCallback = async () => {
          try {
            const res = await fetch(`/api/admin/services/${service.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('فشل في حذف الخدمة');
            showToast('تم حذف الخدمة بنجاح');
            loadServices();
          } catch (err) {
            showToast(err.message, 'error');
          }
        };
      });

      servicesList.appendChild(card);
    });
  }

  // ----------------------------------------------------------
  // Move Service (reorder)
  // ----------------------------------------------------------
  async function moveService(id, direction) {
    const currentIndex = allServices.findIndex(s => s.id === id);
    if (currentIndex === -1) return;

    let targetIndex;
    if (direction === 'up') {
      targetIndex = currentIndex - 1;
      if (targetIndex < 0) return;
    } else {
      targetIndex = currentIndex + 1;
      if (targetIndex >= allServices.length) return;
    }

    // Swap locally for instant feedback
    const temp = allServices[currentIndex];
    allServices[currentIndex] = allServices[targetIndex];
    allServices[targetIndex] = temp;
    renderServices();

    // Send order update to server
    try {
      const orderedIds = allServices.map(s => s.id);
      await fetch('/api/admin/services/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: orderedIds })
      });
    } catch (err) {
      // Silently fail — local order is still shown
    }
  }

  // ----------------------------------------------------------
  // Toggle Visibility
  // ----------------------------------------------------------
  async function toggleVisibility(id) {
    try {
      const res = await fetch(`/api/admin/services/${id}/toggle`, {
        method: 'PUT'
      });
      if (!res.ok) throw new Error('فشل في تغيير الحالة');
      showToast('تم تغيير حالة الخدمة');
      loadServices();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ----------------------------------------------------------
  // Category Filter
  // ----------------------------------------------------------
  filterBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    filterBar.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.category;
    renderServices();
  });

  // ----------------------------------------------------------
  // Add Service
  // ----------------------------------------------------------
  document.getElementById('add-service-btn').addEventListener('click', () => {
    serviceModalTitle.textContent = 'إضافة خدمة جديدة';
    serviceEditId.value = '';
    serviceName.value = '';
    serviceNameEn.value = '';
    servicePrice.value = '';
    serviceDuration.value = 60;
    serviceCategory.value = 'haircut';
    serviceDescription.value = '';
    serviceSubmitBtn.textContent = 'حفظ';
    serviceModal.classList.remove('hidden');
  });

  // ----------------------------------------------------------
  // Edit Service
  // ----------------------------------------------------------
  function openEditModal(service) {
    serviceModalTitle.textContent = 'تعديل الخدمة';
    serviceEditId.value = service.id;
    serviceName.value = service.name || '';
    serviceNameEn.value = service.name_en || service.nameEn || '';
    servicePrice.value = service.price || '';
    serviceDuration.value = service.duration || 60;
    serviceCategory.value = service.category || 'other';
    serviceDescription.value = service.description || '';
    serviceSubmitBtn.textContent = 'حفظ التعديل';
    serviceModal.classList.remove('hidden');
  }

  // ----------------------------------------------------------
  // Service Modal Controls
  // ----------------------------------------------------------
  serviceModalClose.addEventListener('click', () => serviceModal.classList.add('hidden'));
  serviceCancelBtn.addEventListener('click', () => serviceModal.classList.add('hidden'));
  serviceModal.addEventListener('click', (e) => {
    if (e.target === serviceModal) serviceModal.classList.add('hidden');
  });

  serviceSubmitBtn.addEventListener('click', async () => {
    const name = serviceName.value.trim();
    const nameEn = serviceNameEn.value.trim();
    const price = parseFloat(servicePrice.value);
    const duration = parseInt(serviceDuration.value, 10) || 60;
    const category = serviceCategory.value;
    const description = serviceDescription.value.trim();
    const editId = serviceEditId.value;

    if (!name) {
      showToast('يرجى إدخال اسم الخدمة', 'error');
      return;
    }
    if (isNaN(price) || price < 0) {
      showToast('يرجى إدخال سعر صحيح', 'error');
      return;
    }

    const body = { name, name_en: nameEn, price, duration, category, description };

    serviceSubmitBtn.disabled = true;
    serviceSubmitBtn.textContent = 'جاري الحفظ...';

    try {
      let res;
      if (editId) {
        res = await fetch(`/api/admin/services/${editId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } else {
        res = await fetch('/api/admin/services', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'فشل في حفظ الخدمة');
      }

      showToast(editId ? 'تم تعديل الخدمة بنجاح' : 'تمت إضافة الخدمة بنجاح');
      serviceModal.classList.add('hidden');
      loadServices();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      serviceSubmitBtn.disabled = false;
      serviceSubmitBtn.textContent = editId ? 'حفظ التعديل' : 'حفظ';
    }
  });

  // ----------------------------------------------------------
  // Confirm Delete Modal
  // ----------------------------------------------------------
  confirmClose.addEventListener('click', () => confirmModal.classList.add('hidden'));
  confirmCancelBtn.addEventListener('click', () => confirmModal.classList.add('hidden'));
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) confirmModal.classList.add('hidden');
  });

  confirmYesBtn.addEventListener('click', async () => {
    confirmModal.classList.add('hidden');
    if (deleteCallback) {
      await deleteCallback();
      deleteCallback = null;
    }
  });

  // ----------------------------------------------------------
  // Logout
  // ----------------------------------------------------------
  document.getElementById('logout-btn').addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
      // ignore
    }
    window.location.href = '/login';
  });

  // ----------------------------------------------------------
  // Init
  // ----------------------------------------------------------
  loadServices();

})();
