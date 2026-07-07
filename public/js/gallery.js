/* ============================================================
   الشرقاوي صالون — Gallery Page Logic
   ============================================================ */

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

/* ---------- Fetch Gallery ---------- */
async function loadGallery() {
  const content = document.getElementById('galleryContent');

  try {
    const res = await fetch('/api/gallery');
    if (!res.ok) throw new Error('فشل التحميل');
    const data = await res.json();
    const items = Array.isArray(data) ? data : (data.items || data.gallery || []);

    if (!items.length) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📸</div>
          <h3>سيتم إضافة الأعمال قريباً</h3>
          <p>تابعنا على وسائل التواصل لمشاهدة آخر أعمالنا</p>
        </div>`;
      return;
    }

    renderGallery(items);
    initScrollReveal();
  } catch (err) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📸</div>
        <h3>سيتم إضافة الأعمال قريباً</h3>
        <p>تابعنا على وسائل التواصل لمشاهدة آخر أعمالنا</p>
      </div>`;
  }
}

/* ---------- Render Gallery ---------- */
function renderGallery(items) {
  const content = document.getElementById('galleryContent');

  const html = `
    <div class="gallery-grid">
      ${items.map(item => renderGalleryItem(item)).join('')}
    </div>
  `;

  content.innerHTML = html;
}

function renderGalleryItem(item) {
  const src = item.url || item.src || `/uploads/${item.filename}`;
  const desc = item.description || item.caption || '';
  const type = item.type || detectType(item.filename || src);

  if (type === 'video') {
    return `
      <div class="gallery-item reveal">
        <video 
          src="${src}" 
          controls 
          preload="metadata" 
          ${item.poster ? `poster="${item.poster}"` : ''}
          playsinline
        ></video>
        ${desc ? `<div class="gallery-overlay"><p>${desc}</p></div>` : ''}
      </div>
    `;
  }

  // Image
  return `
    <div class="gallery-item reveal" onclick="openLightbox('${src}', '${escapeAttr(desc)}')">
      <img 
        src="${src}" 
        alt="${desc || 'صورة من معرض الأعمال'}" 
        loading="lazy"
      >
      ${desc ? `<div class="gallery-overlay"><p>${desc}</p></div>` : ''}
    </div>
  `;
}

function detectType(filename) {
  if (!filename) return 'image';
  const ext = filename.split('.').pop().toLowerCase();
  if (['mp4', 'webm', 'ogg', 'mov'].includes(ext)) return 'video';
  return 'image';
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

/* ---------- Lightbox ---------- */
function openLightbox(src, caption) {
  const overlay = document.getElementById('lightbox');
  const img = document.getElementById('lightboxImg');
  const cap = document.getElementById('lightboxCaption');

  img.src = src;
  cap.textContent = caption || '';
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox(e) {
  // Only close if clicking overlay or close button, not the image
  if (e && e.target.tagName === 'IMG') return;

  const overlay = document.getElementById('lightbox');
  overlay.classList.remove('active');
  document.body.style.overflow = '';

  // Clear src to stop any loading
  setTimeout(() => {
    document.getElementById('lightboxImg').src = '';
  }, 300);
}

// Close lightbox with Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('lightbox');
    if (overlay.classList.contains('active')) {
      closeLightbox(e);
    }
  }
});

/* ---------- Scroll Reveal ---------- */
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
      if (entry.isIntersecting) {
        // Stagger the reveal
        setTimeout(() => {
          entry.target.classList.add('visible');
        }, index * 80);
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: '0px 0px -30px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
}

/* ---------- Customer photo submission ---------- */
function openSubmit() {
  document.getElementById('submitModal').classList.remove('hidden');
}
function closeSubmit() {
  document.getElementById('submitModal').classList.add('hidden');
}
window.openSubmit = openSubmit;
window.closeSubmit = closeSubmit;

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('submitForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = document.getElementById('sub-file').files[0];
    if (!file) { showToast('اختر صورة أولاً', 'error'); return; }
    if (!file.type.startsWith('image/')) { showToast('الصور فقط مسموح بها', 'error'); return; }

    const fd = new FormData();
    fd.append('media', file);
    fd.append('submitter_name', document.getElementById('sub-name').value.trim());
    fd.append('description', document.getElementById('sub-desc').value.trim());

    const btn = document.getElementById('sub-btn');
    btn.disabled = true; btn.textContent = 'جاري الإرسال...';
    try {
      const res = await fetch('/api/gallery/submit', { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('شكراً! سيتم مراجعة صورتك قبل نشرها', 'success');
        closeSubmit();
        form.reset();
      } else {
        showToast(data.error || 'تعذر الإرسال', 'error');
      }
    } catch (_) {
      showToast('حدث خطأ في الاتصال', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'إرسال للمراجعة';
    }
  });
});

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', loadGallery);
