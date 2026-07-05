/* ============================================================
   home.js — Landing page (services, gallery, reviews, contact)
   All brand/currency values come from window.SALON (brand.js).
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  loadServicesPreview();
  loadGalleryPreview();
  loadReviews();

  const reviewForm = document.getElementById('review-form');
  if (reviewForm) reviewForm.addEventListener('submit', handleReviewSubmit);
});

// Contact block is populated once branding is available.
document.addEventListener('branding:ready', (e) => setupContact(e.detail));

const cur = () => (window.getCurrency ? window.getCurrency() : 'ج.م');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- Services preview ---------- */
async function loadServicesPreview() {
  const grid = document.getElementById('services-preview');
  try {
    const res = await fetch('/api/services');
    const services = await res.json();
    if (!Array.isArray(services) || !services.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">💈</div><h3>سيتم إضافة الخدمات قريباً</h3></div>';
      return;
    }
    grid.innerHTML = services.slice(0, 6).map(s => `
      <a class="service-select-card" href="/book?service=${s.id}">
        <h3>${esc(s.name)}</h3>
        <div class="price">${esc(s.price)} <span class="currency">${esc(cur())}</span></div>
        <div class="duration">⏱ ${esc(s.duration)} دقيقة</div>
      </a>`).join('');
  } catch (_) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><h3>تعذر تحميل الخدمات</h3></div>';
  }
}

/* ---------- Gallery preview ---------- */
async function loadGalleryPreview() {
  const grid = document.getElementById('gallery-preview');
  try {
    const res = await fetch('/api/gallery');
    const items = await res.json();
    if (!Array.isArray(items) || !items.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">📷</div><h3>سيتم إضافة الأعمال قريباً</h3></div>';
      return;
    }
    grid.innerHTML = items.slice(0, 8).map(it => {
      const src = `/uploads/${it.filename}`;
      const media = it.type === 'video'
        ? `<video class="gallery-thumb" src="${src}" muted></video><span class="media-type-badge">🎬</span>`
        : `<img class="gallery-thumb" src="${src}" alt="${esc(it.description || 'عمل')}" loading="lazy">`;
      return `<div class="gallery-item">${media}${it.description ? `<div class="gallery-overlay">${esc(it.description)}</div>` : ''}</div>`;
    }).join('');
  } catch (_) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⚠️</div><h3>تعذر تحميل المعرض</h3></div>';
  }
}

/* ---------- Reviews ---------- */
async function loadReviews() {
  const list = document.getElementById('reviews-list');
  try {
    const res = await fetch('/api/reviews');
    const reviews = await res.json();
    renderReviews(Array.isArray(reviews) ? reviews : []);
  } catch (_) {
    list.innerHTML = '';
  }
}

function renderReviews(reviews) {
  const list = document.getElementById('reviews-list');
  const visible = reviews.slice(0, 6);
  if (!visible.length) {
    list.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">⭐</div><h3>كن أول من يترك تقييماً!</h3></div>';
    return;
  }
  list.innerHTML = visible.map(r => {
    const rating = parseInt(r.rating) || 5;
    const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);
    const text = r.review_text || r.text || '';
    const name = r.name || r.customer_name || 'زائر';
    return `<div class="review-card">
      <div class="review-stars">${stars}</div>
      ${text ? `<p>"${esc(text)}"</p>` : ''}
      <strong>— ${esc(name)}</strong>
    </div>`;
  }).join('');
}

async function handleReviewSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('rev-name').value.trim();
  const rating = document.getElementById('rev-rating').value;
  const review_text = document.getElementById('rev-text').value.trim();
  if (!name) { showToast('يرجى إدخال الاسم', 'error'); return; }

  try {
    const res = await fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, rating, review_text }),
    });
    if (res.ok) {
      showToast('شكراً! تم إرسال تقييمك', 'success');
      document.getElementById('review-form').reset();
      loadReviews();
    } else {
      showToast('تعذر إرسال التقييم', 'error');
    }
  } catch (_) {
    showToast('حدث خطأ في الاتصال', 'error');
  }
}

/* ---------- Contact / WhatsApp ---------- */
function setupContact(s) {
  const section = document.getElementById('contact-section');
  const wa = document.getElementById('contact-whatsapp');
  const phone = document.getElementById('contact-phone');
  let show = false;

  if (s.whatsapp) {
    const digits = String(s.whatsapp).replace(/\D/g, '');
    wa.href = `https://wa.me/${digits}`;
    wa.hidden = false; show = true;
  }
  if (s.phone) {
    phone.href = `tel:${s.phone}`;
    phone.hidden = false; show = true;
  }
  if (s.address) show = true;
  if (show) section.hidden = false;
}

/* ---------- Toast ---------- */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3200);
}
