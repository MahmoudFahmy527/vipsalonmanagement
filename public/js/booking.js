/* ============================================================
   الشرقاوي صالون — Booking Page Logic
   ============================================================ */

const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const MONTH_NAMES_AR = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

// Booking state
const state = {
  currentStep: 1,
  services: [],
  selectedService: null,
  selectedDate: null,
  selectedSlot: null,
};

// Currency comes from salon settings (brand.js); fallback to EGP.
const cur = () => (window.getCurrency ? window.getCurrency() : 'ج.م');

/* ---------- Device memory (returning-customer recognition) ----------
   We keep a small record in the browser: the customer's name, phone and a
   random private token. The token ties their bookings together so we can
   greet them and show "my bookings" — no accounts, no passwords, and (unlike
   an IP address) it's unique to them and stable across visits on this device. */
const DEVICE_KEY = 'salon_customer';

function getDevice() {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null'); } catch (_) { return null; }
}
function newToken() {
  if (window.crypto && crypto.randomUUID) return 'c_' + crypto.randomUUID();
  return 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function saveDevice(name, phone) {
  const d = getDevice() || {};
  d.name = name;
  d.phone = phone;
  if (!d.token) d.token = newToken();
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(d)); } catch (_) {}
  return d;
}
function forgetDevice() {
  try { localStorage.removeItem(DEVICE_KEY); } catch (_) {}
  location.reload();
}
window.forgetDevice = forgetDevice;

const STATUS_LABELS_AR = { pending: 'قيد المراجعة', accepted: 'مؤكد', rejected: 'مرفوض', reserved: 'محجوز' };
const STATUS_CLASS = { pending: 'badge-pending', accepted: 'badge-accepted', rejected: 'badge-rejected', reserved: 'badge-accepted' };

/* Greet a recognised customer, prefill their details, show their bookings. */
function initReturningCustomer() {
  const d = getDevice();
  if (!d || !d.token) return;

  // Prefill the details form
  const nameEl = document.getElementById('customerName');
  const phoneEl = document.getElementById('customerPhone');
  if (nameEl && d.name) nameEl.value = d.name;
  if (phoneEl && d.phone) phoneEl.value = d.phone;

  // Welcome-back banner
  const banner = document.getElementById('welcomeBack');
  if (banner && d.name) {
    banner.querySelector('.wb-name').textContent = d.name;
    banner.hidden = false;
  }

  loadMyBookings(d.token);
}

async function loadMyBookings(token) {
  const panel = document.getElementById('myBookings');
  if (!panel) return;
  try {
    const res = await fetch(`/api/my-bookings?token=${encodeURIComponent(token)}`);
    const list = await res.json();
    if (!Array.isArray(list) || !list.length) return;

    const items = list.map((b) => {
      const d = new Date(b.date + 'T00:00:00');
      const dateLabel = `${DAY_NAMES_AR[d.getDay()]} ${d.getDate()} ${MONTH_NAMES_AR[d.getMonth()]}`;
      const status = STATUS_LABELS_AR[b.status] || b.status;
      const badge = STATUS_CLASS[b.status] || 'badge';
      return `<div class="mybk-row">
        <div>
          <strong>${b.service_name || 'خدمة'}</strong>
          <div class="text-muted" style="font-size:0.85rem;">${dateLabel} — ${formatTime12(b.time_slot)}</div>
        </div>
        <span class="badge ${badge}">${status}</span>
      </div>`;
    }).join('');

    panel.querySelector('.mybk-list').innerHTML = items;
    panel.hidden = false;
  } catch (_) { /* silent */ }
}

/* ---------- Toast ---------- */
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 3200);
}

/* ---------- Step Navigation ---------- */
function goToStep(step) {
  // Hide all steps
  document.querySelectorAll('.booking-step').forEach(el => el.classList.add('hidden'));

  // Show target step
  const stepEl = document.getElementById(step === 5 ? 'stepSuccess' : `step${step}`);
  if (stepEl) stepEl.classList.remove('hidden');

  // Update step indicators
  document.querySelectorAll('.steps .step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'completed');
    if (s < step) el.classList.add('completed');
    if (s === step) el.classList.add('active');
  });

  state.currentStep = step;
}

/* ---------- Format Helpers ---------- */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTime12(slot) {
  // slot is like "12:00", "13:00", "00:00", "01:00", "02:00"
  const [h, m] = slot.split(':').map(Number);
  let period, hour12;
  if (h === 0) {
    hour12 = 12;
    period = 'ص';
  } else if (h < 12) {
    hour12 = h;
    period = 'ص';
  } else if (h === 12) {
    hour12 = 12;
    period = 'م';
  } else {
    hour12 = h - 12;
    period = 'م';
  }
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

/* ---------- Fetch Services ---------- */
async function loadServices() {
  try {
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error('فشل تحميل الخدمات');
    const data = await res.json();
    state.services = Array.isArray(data) ? data : (data.services || []);
    renderServices();

    // Check URL for pre-selected service
    const params = new URLSearchParams(window.location.search);
    const preselect = params.get('service');
    if (preselect) {
      const svc = state.services.find(s => String(s.id) === preselect || String(s._id) === preselect);
      if (svc) {
        selectService(svc);
      }
    }
  } catch (err) {
    document.getElementById('servicesGrid').innerHTML =
      '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">⚠️</div><h3>تعذر تحميل الخدمات</h3><p>يرجى المحاولة لاحقاً</p></div>';
    showToast('تعذر تحميل الخدمات', 'error');
  }
}

function renderServices() {
  const grid = document.getElementById('servicesGrid');
  if (!state.services.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">💈</div><h3>لا توجد خدمات متاحة حالياً</h3></div>';
    return;
  }
  grid.innerHTML = state.services.map(s => `
    <div class="service-select-card" data-id="${s.id || s._id}" onclick="selectService(${JSON.stringify(s).replace(/"/g, '&quot;')})">
      <h3>${s.name}</h3>
      <div class="price">${s.price} <span class="currency">${cur()}</span></div>
      <div class="duration">⏱ ${s.duration} دقيقة</div>
    </div>
  `).join('');
}

function selectService(service) {
  state.selectedService = service;

  // Highlight selected card
  document.querySelectorAll('.service-select-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.service-select-card[data-id="${service.id || service._id}"]`);
  if (card) card.classList.add('selected');

  // Build date picker and move to step 2
  buildDatePicker();
  setTimeout(() => goToStep(2), 300);
}

/* ---------- Date Picker ---------- */
function buildDatePicker() {
  const container = document.getElementById('datePicker');
  container.innerHTML = '';
  const today = new Date();

  for (let i = 0; i < 8; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);

    const dateStr = formatDate(d);
    const dayName = DAY_NAMES_AR[d.getDay()];
    const dayNum = d.getDate();
    const monthName = MONTH_NAMES_AR[d.getMonth()];

    const item = document.createElement('div');
    item.className = 'date-item' + (i === 0 ? ' today' : '');
    item.dataset.date = dateStr;
    item.innerHTML = `
      <span class="day-name">${dayName}</span>
      <span class="day-num">${dayNum}</span>
      <span class="month-name">${monthName}</span>
    `;
    item.addEventListener('click', () => selectDate(dateStr, item));
    container.appendChild(item);
  }
}

function selectDate(dateStr, el) {
  state.selectedDate = dateStr;

  document.querySelectorAll('.date-item').forEach(d => d.classList.remove('active'));
  el.classList.add('active');

  // Parse date for label
  const d = new Date(dateStr + 'T00:00:00');
  const dayName = DAY_NAMES_AR[d.getDay()];
  const dayNum = d.getDate();
  const monthName = MONTH_NAMES_AR[d.getMonth()];
  document.getElementById('selectedDateLabel').textContent = `${dayName} ${dayNum} ${monthName}`;

  // Load slots
  loadSlots(dateStr);
  setTimeout(() => goToStep(3), 300);
}

/* ---------- Load Slots ---------- */
async function loadSlots(date) {
  const grid = document.getElementById('slotsGrid');
  grid.innerHTML = '<div class="flex-center" style="grid-column:1/-1;"><div class="spinner"></div></div>';

  try {
    const res = await fetch(`/api/slots/${date}`);
    if (!res.ok) throw new Error('فشل تحميل المواعيد');
    const data = await res.json();
    const slots = Array.isArray(data) ? data : (data.slots || []);
    renderSlots(slots);
  } catch (err) {
    // Fallback: generate default slots locally
    const defaultSlots = generateDefaultSlots();
    renderSlots(defaultSlots);
  }
}

function generateDefaultSlots() {
  // 12:00 PM (12) to 2:00 AM (26 => next day 02)
  // Hours: 12,13,14,15,16,17,18,19,20,21,22,23,00,01,02
  const hours = [12,13,14,15,16,17,18,19,20,21,22,23,0,1,2];
  return hours.map(h => ({
    time: `${String(h).padStart(2,'0')}:00`,
    status: 'available'
  }));
}

function renderSlots(slots) {
  const grid = document.getElementById('slotsGrid');

  if (!slots.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">📅</div><h3>لا توجد مواعيد متاحة</h3></div>';
    return;
  }

  grid.innerHTML = slots.map(slot => {
    const time = slot.time || slot.time_slot;
    const status = slot.status || 'available';
    const display = formatTime12(time);
    const isAvailable = status === 'available';
    const statusClass = status === 'available' ? 'slot-available' : status === 'pending' ? 'slot-pending' : 'slot-taken';

    // Indicate midnight-crossing times
    const hour = parseInt(time.split(':')[0]);
    const nextDayLabel = (hour >= 0 && hour <= 2) ? ' (فجراً)' : '';

    return `<div class="slot-item ${statusClass}" 
                 data-time="${time}" 
                 ${isAvailable ? `onclick="selectSlot('${time}', this)"` : ''}>
              ${display}${nextDayLabel}
            </div>`;
  }).join('');
}

function selectSlot(time, el) {
  state.selectedSlot = time;

  document.querySelectorAll('.slot-item').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');

  // Build summary and go to step 4
  buildSummary();
  setTimeout(() => goToStep(4), 300);
}

/* ---------- Summary ---------- */
function buildSummary() {
  const s = state.selectedService;
  const d = new Date(state.selectedDate + 'T00:00:00');
  const dayName = DAY_NAMES_AR[d.getDay()];
  const dayNum = d.getDate();
  const monthName = MONTH_NAMES_AR[d.getMonth()];

  document.getElementById('bookingSummary').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.5rem;">
      <div class="flex-between">
        <span class="text-muted">الخدمة</span>
        <span style="font-weight:700;">${s.name}</span>
      </div>
      <div class="flex-between">
        <span class="text-muted">السعر</span>
        <span class="text-gold" style="font-weight:900;">${s.price} ${cur()}</span>
      </div>
      <div class="flex-between">
        <span class="text-muted">التاريخ</span>
        <span style="font-weight:700;">${dayName} ${dayNum} ${monthName}</span>
      </div>
      <div class="flex-between">
        <span class="text-muted">الموعد</span>
        <span style="font-weight:700;">${formatTime12(state.selectedSlot)}</span>
      </div>
    </div>
  `;
}

/* ---------- Submit Booking ---------- */
async function submitBooking(e) {
  e.preventDefault();

  const name = document.getElementById('customerName').value.trim();
  const phone = document.getElementById('customerPhone').value.trim();

  if (!name || !phone) {
    showToast('يرجى ملء جميع البيانات', 'error');
    return;
  }

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'جاري الإرسال...';

  // Remember this customer on the device and tie the booking to their token.
  const device = saveDevice(name, phone);

  try {
    const res = await fetch('/api/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: name,
        customer_phone: phone,
        service_id: state.selectedService.id || state.selectedService._id,
        date: state.selectedDate,
        time_slot: state.selectedSlot,
        customer_token: device.token,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'فشل الحجز');
    }

    const result = await res.json();
    showToast('تم إرسال الحجز بنجاح! ✅', 'success');
    showConfirmation(name, phone);
  } catch (err) {
    showToast(err.message || 'حدث خطأ أثناء الحجز', 'error');
    btn.disabled = false;
    btn.textContent = 'تأكيد الحجز';
  }
}

function showConfirmation(name, phone) {
  const s = state.selectedService;
  const d = new Date(state.selectedDate + 'T00:00:00');
  const dayName = DAY_NAMES_AR[d.getDay()];
  const dayNum = d.getDate();
  const monthName = MONTH_NAMES_AR[d.getMonth()];

  document.getElementById('confirmDetails').innerHTML = `
    <div class="detail-row">
      <span class="detail-label">الاسم</span>
      <span class="detail-value">${name}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">الهاتف</span>
      <span class="detail-value">${phone}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">الخدمة</span>
      <span class="detail-value">${s.name}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">السعر</span>
      <span class="detail-value" style="color:var(--gold);">${s.price} ${cur()}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">التاريخ</span>
      <span class="detail-value">${dayName} ${dayNum} ${monthName}</span>
    </div>
    <div class="detail-row">
      <span class="detail-label">الموعد</span>
      <span class="detail-value">${formatTime12(state.selectedSlot)}</span>
    </div>
  `;

  buildWhatsappButton(name, phone, `${dayName} ${dayNum} ${monthName}`);
  goToStep(5);
}

/* ---------- WhatsApp confirmation ---------- */
function buildWhatsappButton(name, phone, dateLabel) {
  const salon = window.SALON || {};
  if (!salon.whatsapp) return; // salon hasn't set a WhatsApp number

  const digits = String(salon.whatsapp).replace(/\D/g, '');
  const s = state.selectedService;
  const salonName = salon.salon_name || '';
  const lines = [
    `مرحباً ${salonName}، أود تأكيد حجزي:`,
    `الاسم: ${name}`,
    `الهاتف: ${phone}`,
    `الخدمة: ${s.name} (${s.price} ${cur()})`,
    `التاريخ: ${dateLabel}`,
    `الموعد: ${formatTime12(state.selectedSlot)}`,
  ];
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(lines.join('\n'))}`;

  const container = document.getElementById('stepSuccess');
  if (!container || container.querySelector('.wa-confirm-btn')) return;
  const a = document.createElement('a');
  a.className = 'btn btn-success mt-3 wa-confirm-btn';
  a.style.marginLeft = '0.5rem';
  a.target = '_blank';
  a.rel = 'noopener';
  a.href = url;
  a.textContent = '💬 أرسل الحجز عبر واتساب';
  const homeBtn = container.querySelector('a.btn-gold');
  if (homeBtn) homeBtn.parentNode.insertBefore(a, homeBtn);
  else container.appendChild(a);
}

/* ---------- Initialize ---------- */
document.addEventListener('DOMContentLoaded', () => {
  loadServices();
  initReturningCustomer();
});
