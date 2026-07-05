/* ============================================================
   الشرقاوي صالون — Services Page Logic
   ============================================================ */

const CATEGORIES = {
  haircut:  { name: 'قص الشعر', icon: '💇' },
  beard:    { name: 'اللحية', icon: '🧔' },
  skincare: { name: 'العناية بالبشرة', icon: '✨' },
  package:  { name: 'الباقات', icon: '🎁' },
  other:    { name: 'أخرى', icon: '💈' },
};

const CATEGORY_ORDER = ['haircut', 'beard', 'skincare', 'package', 'other'];

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

/* ---------- Fetch Services ---------- */
async function loadServices() {
  const content = document.getElementById('servicesContent');

  try {
    const res = await fetch('/api/services');
    if (!res.ok) throw new Error('فشل التحميل');
    const data = await res.json();
    const services = Array.isArray(data) ? data : (data.services || []);

    if (!services.length) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💈</div>
          <h3>لا توجد خدمات حالياً</h3>
          <p>سيتم إضافة خدمات قريباً</p>
        </div>`;
      return;
    }

    renderGrouped(services);
    initScrollReveal();
  } catch (err) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>تعذر تحميل الخدمات</h3>
        <p>يرجى المحاولة لاحقاً</p>
      </div>`;
    showToast('تعذر تحميل الخدمات', 'error');
  }
}

/* ---------- Group & Render ---------- */
function renderGrouped(services) {
  const content = document.getElementById('servicesContent');
  const grouped = {};

  services.forEach(s => {
    const cat = s.category || 'other';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(s);
  });

  let html = '';

  CATEGORY_ORDER.forEach(catKey => {
    if (!grouped[catKey] || !grouped[catKey].length) return;
    const catInfo = CATEGORIES[catKey] || CATEGORIES.other;

    html += `
      <div class="category-section reveal">
        <div class="category-header">
          <span class="category-icon">${catInfo.icon}</span>
          <h2>${catInfo.name}</h2>
        </div>
        <div class="grid-2">
          ${grouped[catKey].map(s => renderServiceCard(s, catKey)).join('')}
        </div>
      </div>
    `;
  });

  // Handle any categories not in CATEGORY_ORDER
  Object.keys(grouped).forEach(catKey => {
    if (CATEGORY_ORDER.includes(catKey)) return;
    const catInfo = CATEGORIES[catKey] || CATEGORIES.other;

    html += `
      <div class="category-section reveal">
        <div class="category-header">
          <span class="category-icon">${catInfo.icon}</span>
          <h2>${catInfo.name}</h2>
        </div>
        <div class="grid-2">
          ${grouped[catKey].map(s => renderServiceCard(s, catKey)).join('')}
        </div>
      </div>
    `;
  });

  content.innerHTML = html;
}

function renderServiceCard(service, category) {
  const id = service.id || service._id;
  const isPackage = category === 'package';

  return `
    <div class="service-card ${isPackage ? 'package-card' : ''} card-hover">
      ${isPackage ? '<span class="service-category-badge">باقة مميزة ⭐</span>' : ''}
      <h3>${service.name}</h3>
      ${service.description ? `<p>${service.description}</p>` : ''}
      <div class="service-meta">
        <div class="service-price">
          ${service.price} <span class="currency">${window.getCurrency ? window.getCurrency() : 'ج.م'}</span>
        </div>
        <div class="service-duration">⏱ ${service.duration} دقيقة</div>
      </div>
      <a href="/book?service=${id}" class="btn btn-gold btn-sm w-full mt-2">احجز الآن</a>
    </div>
  `;
}

/* ---------- Scroll Reveal ---------- */
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', loadServices);
