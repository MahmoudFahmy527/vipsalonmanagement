// ============================================================
// Admin Gallery — الشرقاوي صالون
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
  // State
  // ----------------------------------------------------------
  let selectedFile = null;
  let deleteCallback = null;

  // ----------------------------------------------------------
  // DOM elements
  // ----------------------------------------------------------
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const uploadPreview = document.getElementById('upload-preview');
  const previewThumb = document.getElementById('preview-thumb');
  const uploadDesc = document.getElementById('upload-desc');
  const uploadSubmitBtn = document.getElementById('upload-submit');
  const uploadCancelBtn = document.getElementById('upload-cancel-btn');
  const uploadProgress = document.getElementById('upload-progress');
  const uploadProgressBar = document.getElementById('upload-progress-bar');
  const galleryGrid = document.getElementById('gallery-grid');

  // Edit description modal
  const editDescModal = document.getElementById('edit-desc-modal');
  const editDescClose = document.getElementById('edit-desc-close');
  const editDescCancel = document.getElementById('edit-desc-cancel');
  const editDescSubmit = document.getElementById('edit-desc-submit');
  const editDescId = document.getElementById('edit-desc-id');
  const editDescInput = document.getElementById('edit-desc-input');

  // Confirm delete modal
  const confirmModal = document.getElementById('confirm-modal');
  const confirmClose = document.getElementById('confirm-modal-close');
  const confirmCancelBtn = document.getElementById('confirm-cancel');
  const confirmYesBtn = document.getElementById('confirm-yes');

  // ----------------------------------------------------------
  // Drag & Drop
  // ----------------------------------------------------------
  uploadZone.addEventListener('click', () => fileInput.click());

  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
  });

  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
  });

  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) handleFileSelected(files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFileSelected(fileInput.files[0]);
  });

  function handleFileSelected(file) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
      showToast('يرجى اختيار صورة أو فيديو فقط', 'error');
      return;
    }

    selectedFile = file;
    uploadDesc.value = '';

    if (isImage) {
      const reader = new FileReader();
      reader.onload = (e) => {
        previewThumb.src = e.target.result;
        previewThumb.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      // Video: create a video element for poster
      const videoURL = URL.createObjectURL(file);
      previewThumb.src = '';
      previewThumb.style.display = 'none';

      const video = document.createElement('video');
      video.src = videoURL;
      video.muted = true;
      video.currentTime = 1;
      video.addEventListener('loadeddata', () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0);
        previewThumb.src = canvas.toDataURL();
        previewThumb.style.display = 'block';
        URL.revokeObjectURL(videoURL);
      });
    }

    uploadPreview.classList.add('visible');
  }

  uploadCancelBtn.addEventListener('click', () => {
    selectedFile = null;
    uploadPreview.classList.remove('visible');
    uploadProgress.classList.remove('visible');
    uploadProgressBar.style.width = '0%';
    fileInput.value = '';
  });

  // ----------------------------------------------------------
  // Upload
  // ----------------------------------------------------------
  uploadSubmitBtn.addEventListener('click', () => {
    if (!selectedFile) {
      showToast('يرجى اختيار ملف أولاً', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('media', selectedFile);
    formData.append('description', uploadDesc.value.trim());

    uploadSubmitBtn.disabled = true;
    uploadSubmitBtn.textContent = 'جاري الرفع...';
    uploadProgress.classList.add('visible');

    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        uploadProgressBar.style.width = pct + '%';
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        showToast('تم رفع الملف بنجاح');
        resetUploadUI();
        loadGallery();
      } else {
        let errMsg = 'فشل في رفع الملف';
        try {
          const resp = JSON.parse(xhr.responseText);
          if (resp.message) errMsg = resp.message;
        } catch (e) { /* ignore */ }
        showToast(errMsg, 'error');
        uploadSubmitBtn.disabled = false;
        uploadSubmitBtn.textContent = 'رفع';
      }
    });

    xhr.addEventListener('error', () => {
      showToast('حدث خطأ في الاتصال', 'error');
      uploadSubmitBtn.disabled = false;
      uploadSubmitBtn.textContent = 'رفع';
    });

    xhr.open('POST', '/api/admin/gallery');
    xhr.send(formData);
  });

  function resetUploadUI() {
    selectedFile = null;
    uploadPreview.classList.remove('visible');
    uploadProgress.classList.remove('visible');
    uploadProgressBar.style.width = '0%';
    uploadDesc.value = '';
    fileInput.value = '';
    uploadSubmitBtn.disabled = false;
    uploadSubmitBtn.textContent = 'رفع';
  }

  // ----------------------------------------------------------
  // Load Gallery
  // ----------------------------------------------------------
  async function loadGallery() {
    galleryGrid.innerHTML = '<div class="flex-center mt-3" style="grid-column:1/-1;"><div class="spinner"></div></div>';

    try {
      const res = await fetch('/api/admin/gallery');
      if (!res.ok) throw new Error('فشل في تحميل المعرض');
      const data = await res.json();
      const items = data.items || data || [];
      renderGallery(items);
    } catch (err) {
      galleryGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><p>⚠️ ${err.message}</p></div>`;
    }
  }

  function renderGallery(items) {
    if (!items.length) {
      galleryGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><p style="font-size:2rem;margin-bottom:0.5rem;">🖼️</p><p>لا توجد عناصر في المعرض</p></div>';
      return;
    }

    galleryGrid.innerHTML = '';

    items.forEach(item => {
      const src = `/uploads/${item.filename}`;
      const isVideo = item.type === 'video';
      const isPending = item.status === 'pending';
      const card = document.createElement('div');
      card.className = 'card gallery-item' + (isPending ? ' pending' : '');

      let mediaHTML = '';
      if (isVideo) {
        mediaHTML = `
          <video class="gallery-thumb" src="${src}" preload="metadata" muted></video>
          <span class="media-type-badge">🎬 فيديو</span>
        `;
      } else {
        mediaHTML = `<img class="gallery-thumb" src="${src}" alt="${item.description || ''}" loading="lazy">`;
      }
      if (isPending) mediaHTML += '<span class="pending-flag">بانتظار المراجعة</span>';

      const submitter = item.submitter_name ? `<p class="text-muted" style="font-size:0.8rem;margin:0 0 0.3rem;">أرسلها: ${item.submitter_name}</p>` : '';
      const approveBtn = isPending
        ? `<button class="btn btn-success btn-sm" data-approve-id="${item.id}">✅ نشر</button>`
        : '';

      card.innerHTML = `
        ${mediaHTML}
        <div class="gallery-item-body">
          ${submitter}
          <p class="gallery-item-desc">${item.description || 'بدون وصف'}</p>
          <div class="gallery-item-actions">
            ${approveBtn}
            <button class="btn btn-outline btn-sm" data-edit-id="${item.id}">✏️ تعديل الوصف</button>
            <button class="btn btn-danger btn-sm" data-delete-id="${item.id}">🗑️ ${isPending ? 'رفض' : 'حذف'}</button>
          </div>
        </div>
      `;

      // Approve handler (pending submissions only)
      const approveEl = card.querySelector('[data-approve-id]');
      if (approveEl) {
        approveEl.addEventListener('click', async () => {
          try {
            const res = await fetch(`/api/admin/gallery/${item.id}/approve`, { method: 'PUT' });
            if (!res.ok) throw new Error('فشل في نشر الصورة');
            showToast('تم نشر الصورة');
            loadGallery();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      }

      // Edit description handler
      card.querySelector('[data-edit-id]').addEventListener('click', () => {
        editDescId.value = item.id;
        editDescInput.value = item.description || '';
        editDescModal.classList.remove('hidden');
      });

      // Delete handler
      card.querySelector('[data-delete-id]').addEventListener('click', () => {
        confirmModal.classList.remove('hidden');
        deleteCallback = async () => {
          try {
            const res = await fetch(`/api/admin/gallery/${item.id}`, { method: 'DELETE' });
            if (!res.ok) throw new Error('فشل في حذف العنصر');
            showToast('تم حذف العنصر بنجاح');
            loadGallery();
          } catch (err) {
            showToast(err.message, 'error');
          }
        };
      });

      galleryGrid.appendChild(card);
    });
  }

  // ----------------------------------------------------------
  // Edit Description Modal
  // ----------------------------------------------------------
  editDescClose.addEventListener('click', () => editDescModal.classList.add('hidden'));
  editDescCancel.addEventListener('click', () => editDescModal.classList.add('hidden'));
  editDescModal.addEventListener('click', (e) => {
    if (e.target === editDescModal) editDescModal.classList.add('hidden');
  });

  editDescSubmit.addEventListener('click', async () => {
    const id = editDescId.value;
    const description = editDescInput.value.trim();

    editDescSubmit.disabled = true;
    editDescSubmit.textContent = 'جاري الحفظ...';

    try {
      const res = await fetch(`/api/admin/gallery/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description })
      });
      if (!res.ok) throw new Error('فشل في تحديث الوصف');
      showToast('تم تحديث الوصف بنجاح');
      editDescModal.classList.add('hidden');
      loadGallery();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      editDescSubmit.disabled = false;
      editDescSubmit.textContent = 'حفظ';
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
  loadGallery();

})();
