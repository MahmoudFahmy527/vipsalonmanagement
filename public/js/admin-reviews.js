document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  const reviewsList = document.getElementById('reviews-list');
  const toastContainer = document.getElementById('toast-container');

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Check auth
  fetch('/api/auth/check')
    .then(res => {
      if (!res.ok) window.location.href = '/login';
      else loadReviews();
    })
    .catch(() => window.location.href = '/login');

  logoutBtn.addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' })
      .then(() => window.location.href = '/login');
  });

  function loadReviews() {
    fetch('/api/reviews')
      .then(res => res.json())
      .then(reviews => {
        reviewsList.innerHTML = '';
        if (reviews.length === 0) {
          reviewsList.innerHTML = '<p style="text-align:center;color:var(--text-secondary);">لا توجد تقييمات حالياً.</p>';
          return;
        }

        reviews.forEach(review => {
          const div = document.createElement('div');
          div.className = 'review-card';
          
          let stars = '';
          for (let i=0; i<5; i++) {
            stars += (i < review.rating) ? '★' : '☆';
          }
          
          const dateStr = new Date(review.created_at).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

          div.innerHTML = `
            <div class="review-header">
              <span class="review-author">${review.customer_name}</span>
              <span class="review-rating">${stars}</span>
            </div>
            <p class="review-text">${review.review_text || ''}</p>
            <div class="review-header" style="margin-bottom:0;">
              <span class="review-date">${dateStr}</span>
              <div class="review-actions">
                <button class="btn btn-danger btn-sm" onclick="deleteReview(${review.id})">حذف</button>
              </div>
            </div>
          `;
          reviewsList.appendChild(div);
        });
      })
      .catch(err => {
        console.error(err);
        showToast('حدث خطأ أثناء تحميل التقييمات', 'error');
      });
  }

  window.deleteReview = function(id) {
    if (!confirm('هل أنت متأكد من حذف هذا التقييم؟')) return;
    
    fetch(`/api/admin/reviews/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          showToast('تم حذف التقييم بنجاح');
          loadReviews();
        } else {
          showToast(data.message || 'فشل الحذف', 'error');
        }
      })
      .catch(() => showToast('حدث خطأ', 'error'));
  };
});
