// ============================================================
// Admin Dashboard — الشرقاوي صالون
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
  const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const STATUS_LABELS = {
    pending: 'قيد الانتظار',
    accepted: 'مقبول',
    rejected: 'مرفوض',
    reserved: 'محجوز'
  };

  let selectedDate = formatDate(new Date());
  let selectedBarberFilter = '';
  let confirmCallback = null;

  // ----------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------
  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Build a wa.me link from a local phone number. Egyptian numbers
  // starting with 0 are normalised to the 20 country code.
  function waLink(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.startsWith('0')) digits = '20' + digits.slice(1);
    return `https://wa.me/${digits}`;
  }

  // Pre-filled WhatsApp reminder to the customer about their appointment.
  function reminderLink(phone, name, time, date) {
    const salon = (window.SALON && window.SALON.salon_name) || 'صالوننا';
    const text = `مرحباً ${name}، تذكير بموعدك في ${salon} يوم ${date} الساعة ${time}. بانتظارك 🙏`;
    return `${waLink(phone)}?text=${encodeURIComponent(text)}`;
  }

  function formatTime12(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1] || '00';
    const period = h < 12 ? 'ص' : 'م';
    if (h === 0) h = 12;
    else if (h > 12) h -= 12;
    return `${h}:${m} ${period}`;
  }

  function generateTimeSlots() {
    const slots = [];
    // 12:00 PM (noon) to 2:00 AM next day
    for (let h = 12; h <= 23; h++) {
      slots.push(`${String(h).padStart(2, '0')}:00`);
    }
    slots.push('00:00');
    slots.push('01:00');
    slots.push('02:00');
    return slots;
  }

  function populateTimeSelect(selectEl) {
    selectEl.innerHTML = '';
    const slots = generateTimeSlots();
    slots.forEach(slot => {
      const opt = document.createElement('option');
      opt.value = slot;
      opt.textContent = formatTime12(slot);
      selectEl.appendChild(opt);
    });
  }

  // ----------------------------------------------------------
  // Date Navigator
  // ----------------------------------------------------------
  function renderDatePicker() {
    const picker = document.getElementById('date-picker');
    picker.innerHTML = '';
    const today = new Date();

    for (let i = -7; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const dateStr = formatDate(d);
      const dayName = DAY_NAMES[d.getDay()];
      const dayNum = d.getDate();

      const item = document.createElement('button');
      item.className = 'date-item' + (dateStr === selectedDate ? ' active' : '');
      item.innerHTML = `<span style="font-size:0.75rem;display:block;">${dayName}</span><span style="font-size:1.2rem;font-weight:700;">${dayNum}</span>`;
      item.addEventListener('click', () => {
        selectedDate = dateStr;
        renderDatePicker();
        loadBookings();
      });
      picker.appendChild(item);
    }

    // Scroll active into view
    const activeItem = picker.querySelector('.date-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  // ----------------------------------------------------------
  // Load Bookings
  // ----------------------------------------------------------
  async function loadBookings() {
    const listEl = document.getElementById('bookings-list');
    listEl.innerHTML = '<div class="flex-center mt-3"><div class="spinner"></div></div>';

    // Update title
    const today = formatDate(new Date());
    const titleEl = document.getElementById('bookings-title');
    if (selectedDate === today) {
      titleEl.textContent = 'حجوزات اليوم';
    } else {
      titleEl.textContent = `حجوزات ${selectedDate}`;
    }

    try {
      const q = selectedBarberFilter ? `?barber=${selectedBarberFilter}` : '';
      const res = await fetch(`/api/admin/bookings/${selectedDate}${q}`);
      if (!res.ok) throw new Error('فشل في تحميل الحجوزات');
      const data = await res.json();
      const bookings = data.bookings || data || [];

      updateStats(bookings);
      renderBookings(bookings);
    } catch (err) {
      listEl.innerHTML = `<div class="empty-state"><p>⚠️ ${err.message}</p></div>`;
    }
  }

  // ----------------------------------------------------------
  // Barbers (filter + manual-reserve select)
  // ----------------------------------------------------------
  let barbers = [];
  async function loadBarbers() {
    try {
      barbers = await (await fetch('/api/barbers')).json();
    } catch (_) { barbers = []; }
    if (!Array.isArray(barbers) || !barbers.length) return; // salon not using barbers

    const filter = document.getElementById('barber-filter');
    if (filter) {
      filter.innerHTML = '<option value="">كل الحلاقين</option>' +
        barbers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
      filter.style.display = '';
      filter.addEventListener('change', () => {
        selectedBarberFilter = filter.value;
        loadBookings();
      });
    }
    const reserveSel = document.getElementById('reserve-barber');
    if (reserveSel) {
      reserveSel.innerHTML = '<option value="">— بدون تحديد —</option>' +
        barbers.map(b => `<option value="${b.id}">${b.name}</option>`).join('');
      const wrap = document.getElementById('reserve-barber-group');
      if (wrap) wrap.style.display = '';
    }
  }

  function updateStats(bookings) {
    const total = bookings.length;
    const pending = bookings.filter(b => b.status === 'pending').length;
    const accepted = bookings.filter(b => b.status === 'accepted').length;
    const reserved = bookings.filter(b => b.status === 'reserved').length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-pending').textContent = pending;
    document.getElementById('stat-accepted').textContent = accepted;
    document.getElementById('stat-reserved').textContent = reserved;
  }

  function renderBookings(bookings) {
    const listEl = document.getElementById('bookings-list');

    if (!bookings.length) {
      listEl.innerHTML = '<div class="empty-state"><p style="font-size:2rem;margin-bottom:0.5rem;">📭</p><p>لا توجد حجوزات لهذا اليوم</p></div>';
      return;
    }

    // Sort by time
    bookings.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

    listEl.innerHTML = '';
    bookings.forEach(booking => {
      const card = document.createElement('div');
      card.className = `card booking-card status-${booking.status}`;

      const serviceName = booking.service_name || booking.serviceName || 'خدمة';
      const customerName = booking.customer_name || booking.customerName || booking.name || 'حجز يدوي';
      const phone = booking.customer_phone || booking.phone || '';
      const timeSlot = booking.time_slot || booking.time;
      const time = formatTime12(timeSlot);
      const duration = booking.duration || 60;
      const note = booking.note || booking.notes || '';
      const statusLabel = STATUS_LABELS[booking.status] || booking.status;
      const badgeClass = `badge badge-${booking.status}`;

      // New vs returning tag (only for real customer bookings, not manual reserves)
      let customerTag = '';
      if (phone && phone !== '-') {
        customerTag = booking.is_returning
          ? '<span class="customer-tag returning">عميل عائد</span>'
          : '<span class="customer-tag new">جديد</span>';
      }

      // WhatsApp appointment reminder (upcoming bookings with a real phone).
      const reminderBtn = (phone && phone !== '-')
        ? `<a class="btn btn-outline btn-sm" href="${reminderLink(phone, customerName, time, booking.date || selectedDate)}" target="_blank" rel="noopener">🔔 تذكير</a>`
        : '';

      let actionsHTML = '';

      if (booking.status === 'pending') {
        actionsHTML = `
          <button class="btn btn-success btn-sm" onclick="adminActions.updateStatus(${booking.id}, 'accepted')">قبول</button>
          <button class="btn btn-danger btn-sm" onclick="adminActions.updateStatus(${booking.id}, 'rejected')">رفض</button>
          <button class="btn btn-outline btn-sm" onclick="adminActions.openEditModal(${booking.id}, '${booking.date || selectedDate}', '${timeSlot}', ${duration})">✏️ تعديل</button>
          ${reminderBtn}
        `;
      } else if (booking.status === 'accepted') {
        actionsHTML = `
          <button class="btn btn-outline btn-sm" onclick="adminActions.openEditModal(${booking.id}, '${booking.date || selectedDate}', '${timeSlot}', ${duration})">✏️ تعديل</button>
          ${reminderBtn}
          <button class="btn btn-danger btn-sm" onclick="adminActions.updateStatus(${booking.id}, 'rejected')">رفض</button>
        `;
      } else if (booking.status === 'reserved') {
        actionsHTML = `
          <button class="btn btn-outline btn-sm" onclick="adminActions.openEditModal(${booking.id}, '${booking.date || selectedDate}', '${timeSlot}', ${duration})">✏️ تعديل</button>
          <button class="btn btn-danger btn-sm" onclick="adminActions.confirmDelete(${booking.id})">🗑️ حذف</button>
        `;
      } else if (booking.status === 'rejected') {
        actionsHTML = `
          <button class="btn btn-success btn-sm" onclick="adminActions.updateStatus(${booking.id}, 'accepted')">قبول</button>
          <button class="btn btn-danger btn-sm" onclick="adminActions.confirmDelete(${booking.id})">🗑️ حذف</button>
        `;
      }

      card.innerHTML = `
        <div class="booking-info">
          <h4>${customerName}${customerTag}</h4>
          ${phone && phone !== '-' ? `<a class="booking-phone" href="${waLink(phone)}" target="_blank" rel="noopener" title="مراسلة عبر واتساب" dir="ltr">💬 ${phone}</a>` : ''}
          ${note ? `<p class="note-text">📝 ${note}</p>` : ''}
        </div>
        <div class="booking-meta">
          <div class="meta-item">🕐 <span class="value">${time}</span></div>
          <div class="meta-item">⏱ <span class="value">${duration} د</span></div>
          <div class="meta-item">💇 <span class="value">${serviceName}</span></div>
          ${booking.barber_name ? `<div class="meta-item">✂️ <span class="value">${booking.barber_name}</span></div>` : ''}
          <span class="${badgeClass}">${statusLabel}</span>
        </div>
        <div class="booking-actions">
          ${actionsHTML}
        </div>
      `;

      listEl.appendChild(card);
    });
  }

  // ----------------------------------------------------------
  // Booking Actions (exposed globally)
  // ----------------------------------------------------------
  window.adminActions = {
    async updateStatus(id, status) {
      try {
        const res = await fetch(`/api/admin/bookings/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status })
        });
        if (!res.ok) throw new Error('فشل في تحديث الحالة');
        showToast(status === 'accepted' ? 'تم قبول الحجز' : 'تم رفض الحجز');
        loadBookings();
      } catch (err) {
        showToast(err.message, 'error');
      }
    },

    openEditModal(id, date, time, duration) {
      document.getElementById('edit-booking-id').value = id;
      document.getElementById('edit-date').value = date;
      document.getElementById('edit-duration').value = duration || 60;

      const editTimeSelect = document.getElementById('edit-time');
      populateTimeSelect(editTimeSelect);
      if (time) editTimeSelect.value = time;

      document.getElementById('edit-modal').classList.remove('hidden');
    },

    confirmDelete(id) {
      document.getElementById('confirm-message').textContent = 'هل أنت متأكد من حذف هذا الحجز؟';
      document.getElementById('confirm-modal').classList.remove('hidden');
      confirmCallback = async () => {
        try {
          const res = await fetch(`/api/admin/bookings/${id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('فشل في حذف الحجز');
          showToast('تم حذف الحجز بنجاح');
          loadBookings();
        } catch (err) {
          showToast(err.message, 'error');
        }
      };
    }
  };

  // ----------------------------------------------------------
  // Reserve Slot Modal
  // ----------------------------------------------------------
  const reserveModal = document.getElementById('reserve-modal');
  const reserveBtn = document.getElementById('reserve-btn');
  const reserveClose = document.getElementById('reserve-modal-close');
  const reserveCancel = document.getElementById('reserve-cancel');
  const reserveSubmit = document.getElementById('reserve-submit');

  reserveBtn.addEventListener('click', () => {
    document.getElementById('reserve-date').value = selectedDate;
    populateTimeSelect(document.getElementById('reserve-time'));
    document.getElementById('reserve-duration').value = 60;
    document.getElementById('reserve-note').value = '';
    reserveModal.classList.remove('hidden');
  });

  reserveClose.addEventListener('click', () => reserveModal.classList.add('hidden'));
  reserveCancel.addEventListener('click', () => reserveModal.classList.add('hidden'));
  reserveModal.addEventListener('click', (e) => {
    if (e.target === reserveModal) reserveModal.classList.add('hidden');
  });

  reserveSubmit.addEventListener('click', async () => {
    const date = document.getElementById('reserve-date').value;
    const time = document.getElementById('reserve-time').value;
    const duration = parseInt(document.getElementById('reserve-duration').value, 10) || 60;
    const note = document.getElementById('reserve-note').value.trim();
    const barberSel = document.getElementById('reserve-barber');
    const barber_id = barberSel && barberSel.value ? Number(barberSel.value) : null;

    if (!date || !time) {
      showToast('يرجى اختيار التاريخ والوقت', 'error');
      return;
    }

    reserveSubmit.disabled = true;
    reserveSubmit.textContent = 'جاري الحجز...';

    try {
      const res = await fetch('/api/admin/reserve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time_slot: time, duration, note, barber_id })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'فشل في الحجز');
      }
      showToast('تم الحجز بنجاح');
      reserveModal.classList.add('hidden');
      selectedDate = date;
      renderDatePicker();
      loadBookings();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      reserveSubmit.disabled = false;
      reserveSubmit.textContent = 'حجز';
    }
  });

  // ----------------------------------------------------------
  // Edit Time Modal
  // ----------------------------------------------------------
  const editModal = document.getElementById('edit-modal');
  const editClose = document.getElementById('edit-modal-close');
  const editCancel = document.getElementById('edit-cancel');
  const editSubmit = document.getElementById('edit-submit');

  editClose.addEventListener('click', () => editModal.classList.add('hidden'));
  editCancel.addEventListener('click', () => editModal.classList.add('hidden'));
  editModal.addEventListener('click', (e) => {
    if (e.target === editModal) editModal.classList.add('hidden');
  });

  editSubmit.addEventListener('click', async () => {
    const id = document.getElementById('edit-booking-id').value;
    const date = document.getElementById('edit-date').value;
    const time = document.getElementById('edit-time').value;
    const duration = parseInt(document.getElementById('edit-duration').value, 10) || 60;

    if (!date || !time) {
      showToast('يرجى اختيار التاريخ والوقت', 'error');
      return;
    }

    editSubmit.disabled = true;
    editSubmit.textContent = 'جاري الحفظ...';

    try {
      const res = await fetch(`/api/admin/bookings/${id}/time`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, time, duration })
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || 'فشل في تعديل الموعد');
      }
      showToast('تم تعديل الموعد بنجاح');
      editModal.classList.add('hidden');
      loadBookings();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      editSubmit.disabled = false;
      editSubmit.textContent = 'حفظ التعديل';
    }
  });

  // ----------------------------------------------------------
  // Confirm Delete Modal
  // ----------------------------------------------------------
  const confirmModal = document.getElementById('confirm-modal');
  const confirmClose = document.getElementById('confirm-modal-close');
  const confirmCancelBtn = document.getElementById('confirm-cancel');
  const confirmYesBtn = document.getElementById('confirm-yes');

  confirmClose.addEventListener('click', () => confirmModal.classList.add('hidden'));
  confirmCancelBtn.addEventListener('click', () => confirmModal.classList.add('hidden'));
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) confirmModal.classList.add('hidden');
  });

  confirmYesBtn.addEventListener('click', async () => {
    confirmModal.classList.add('hidden');
    if (confirmCallback) {
      await confirmCallback();
      confirmCallback = null;
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
  renderDatePicker();
  populateTimeSelect(document.getElementById('reserve-time'));
  populateTimeSelect(document.getElementById('edit-time'));
  loadBarbers();
  loadBookings();

})();
