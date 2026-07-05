document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  const settingsForm = document.getElementById('settings-form');
  const passwordForm = document.getElementById('password-form');
  const homeDescInput = document.getElementById('home_description');
  const toastContainer = document.getElementById('toast-container');

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  // Auth guard
  fetch('/api/auth/check')
    .then(res => res.json())
    .then(data => { if (!data.authenticated) window.location.href = '/login'; else loadSettings(); })
    .catch(() => window.location.href = '/login');

  logoutBtn.addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' }).then(() => window.location.href = '/login');
  });

  function loadSettings() {
    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        // /api/settings returns an object { key: value }
        if (settings && settings.home_description) homeDescInput.value = settings.home_description;
      })
      .catch(() => showToast('حدث خطأ أثناء تحميل الإعدادات', 'error'));
  }

  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    fetch('/api/admin/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'home_description', value: homeDescInput.value.trim() }),
    })
      .then(res => res.json())
      .then(data => showToast(data.success ? 'تم حفظ الإعدادات بنجاح' : (data.error || 'فشل الحفظ'), data.success ? 'success' : 'error'))
      .catch(() => showToast('حدث خطأ', 'error'));
  });

  passwordForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const current_password = document.getElementById('current_password').value;
    const new_username = document.getElementById('new_username').value.trim();
    const new_password = document.getElementById('new_password').value;
    if (new_password.length < 6) { showToast('كلمة المرور يجب أن تكون 6 أحرف على الأقل', 'error'); return; }

    fetch('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password, new_username, new_password }),
    })
      .then(res => res.json().then(data => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (ok && data.success) { showToast('تم تحديث بيانات الدخول'); passwordForm.reset(); }
        else showToast(data.error || 'فشل التحديث', 'error');
      })
      .catch(() => showToast('حدث خطأ', 'error'));
  });
});
