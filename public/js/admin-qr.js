document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  const qrcodeContainer = document.getElementById('qrcode');
  const downloadBtn = document.getElementById('download-btn');

  // Check auth
  fetch('/api/auth/check')
    .then(res => {
      if (!res.ok) window.location.href = '/login';
      else generateQR();
    })
    .catch(() => window.location.href = '/login');

  logoutBtn.addEventListener('click', () => {
    fetch('/api/logout', { method: 'POST' })
      .then(() => window.location.href = '/login');
  });

  function generateQR() {
    // Generate QR linking to homepage
    const typeNumber = 0; // Auto
    const errorCorrectionLevel = 'H'; // High correction for better look
    const qr = qrcode(typeNumber, errorCorrectionLevel);
    
    const targetUrl = window.location.origin + '/';
    qr.addData(targetUrl);
    qr.make();
    
    // Create image tag for QR
    // Size cell=6, margin=2
    qrcodeContainer.innerHTML = qr.createImgTag(6, 2);
    
    // We can style the image a bit more if needed
    const img = qrcodeContainer.querySelector('img');
    if(img) {
      img.style.display = 'block';
      img.style.margin = '0 auto';
    }
  }

  downloadBtn.addEventListener('click', () => {
    const img = qrcodeContainer.querySelector('img');
    if (!img) return;

    const link = document.createElement('a');
    link.href = img.src;
    link.download = 'elsharkawy-salon-qr.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });
});
