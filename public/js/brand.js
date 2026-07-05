/* ============================================================
   brand.js — White-label runtime branding
   ------------------------------------------------------------
   Fetches the salon's settings and injects them into the page:
   theme color, name, logo, socials, currency. Included on every
   page so re-branding for a new salon = editing settings only.
   Exposes window.SALON for other scripts (currency, whatsapp…).
   ============================================================ */
(function () {
  // Apply a cached color instantly to avoid a flash of the default theme.
  try {
    const cached = localStorage.getItem('salon_brand_color');
    if (cached) applyColor(cached);
  } catch (_) {}

  function hexToRgb(hex) {
    hex = String(hex || '').replace('#', '').trim();
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16);
    if (isNaN(n) || hex.length !== 6) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function mix(rgb, target, amt) {
    return {
      r: Math.round(rgb.r + (target - rgb.r) * amt),
      g: Math.round(rgb.g + (target - rgb.g) * amt),
      b: Math.round(rgb.b + (target - rgb.b) * amt),
    };
  }
  const toHex = ({ r, g, b }) =>
    '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');

  function applyColor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    const root = document.documentElement.style;
    root.setProperty('--brand', hex);
    root.setProperty('--brand-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.setProperty('--brand-light', toHex(mix(rgb, 255, 0.35)));
    root.setProperty('--brand-dark', toHex(mix(rgb, 0, 0.25)));
  }

  function setText(selector, text) {
    document.querySelectorAll(selector).forEach(el => {
      // Preserve a leading icon element if present
      const icon = el.querySelector('.logo-icon');
      if (icon) {
        el.textContent = '';
        el.appendChild(icon);
        el.appendChild(document.createTextNode(' ' + text));
      } else {
        el.textContent = text;
      }
    });
  }

  const SOCIALS = ['instagram', 'tiktok', 'facebook'];

  function applyBranding(s) {
    window.SALON = s;

    if (s.brand_color) {
      applyColor(s.brand_color);
      try { localStorage.setItem('salon_brand_color', s.brand_color); } catch (_) {}
    }

    const name = s.salon_name || 'صالونك';

    // Document title: keep page-specific prefix, swap the salon suffix.
    if (document.title.includes('—')) {
      document.title = document.title.split('—')[0].trim() + ' — ' + name;
    } else {
      document.title = name;
    }

    // Brand name touchpoints
    setText('.navbar-logo', name);
    setText('.navbar-brand', name);
    document.querySelectorAll('.footer-brand, [data-brand-name]').forEach(el => { el.textContent = name; });
    document.querySelectorAll('.login-logo h1').forEach(el => { el.textContent = name; });

    // Logo emoji
    if (s.logo_emoji) {
      document.querySelectorAll('.logo-icon').forEach(el => { el.textContent = s.logo_emoji; });
    }

    // Hero image
    if (s.hero_image) {
      document.documentElement.style.setProperty('--hero-image', `url('${s.hero_image}')`);
    }

    // Social links: set href, hide the ones with no value.
    SOCIALS.forEach(net => {
      document.querySelectorAll(`[data-social="${net}"], .social-icon[aria-label="${net}" i]`).forEach(a => {
        if (s[net]) { a.href = s[net]; a.style.display = ''; }
        else { a.style.display = 'none'; }
      });
    });

    // Anything tagged with data-setting gets its text filled in.
    document.querySelectorAll('[data-setting]').forEach(el => {
      const key = el.getAttribute('data-setting');
      if (s[key]) el.textContent = s[key];
    });

    document.dispatchEvent(new CustomEvent('branding:ready', { detail: s }));
  }

  async function load() {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      const s = Array.isArray(data)
        ? data.reduce((o, r) => ((o[r.key] = r.value), o), {})
        : data;
      applyBranding(s);
    } catch (err) {
      console.warn('brand.js: could not load settings', err);
    }
  }

  // Helper other scripts can call: window.SALON?.currency
  window.getCurrency = () => (window.SALON && window.SALON.currency) || 'ج.م';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
