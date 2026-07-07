/* ============================================================
   instagram.js — real Instagram content on the storefront
   ------------------------------------------------------------
   Two modes, driven by settings (owner picks in admin):
   - instagram_embed: raw widget code (Behold/LightWidget/…) → live auto feed
   - instagram_posts: list of IG post URLs → official Instagram embeds
   Renders into #instagram-feed and reveals #instagram-section.
   ============================================================ */
(function () {
  function loadScript(src, cb) {
    if (document.querySelector(`script[src="${src}"]`)) { cb && cb(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => cb && cb();
    document.body.appendChild(s);
  }

  // innerHTML doesn't execute <script> tags — re-create them so widget code runs.
  function setHTMLWithScripts(el, html) {
    el.innerHTML = html;
    el.querySelectorAll('script').forEach((old) => {
      const s = document.createElement('script');
      [...old.attributes].forEach((a) => s.setAttribute(a.name, a.value));
      s.textContent = old.textContent;
      old.replaceWith(s);
    });
  }

  function igBlockquote(url) {
    // Only accept real Instagram permalinks.
    if (!/^https?:\/\/(www\.)?instagram\.com\//i.test(url)) return '';
    const safe = url.split('"')[0];
    return `<blockquote class="instagram-media" data-instgrm-permalink="${safe}" data-instgrm-version="14"
             style="margin:0;width:100%;max-width:328px;min-width:260px;background:#fff;border-radius:12px;"></blockquote>`;
  }

  async function run() {
    const container = document.getElementById('instagram-feed');
    if (!container) return;
    const section = document.getElementById('instagram-section');

    let s;
    try { s = await (await fetch('/api/settings')).json(); } catch (_) { return; }

    const embed = (s.instagram_embed || '').trim();
    const posts = (s.instagram_posts || '').split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

    if (embed) {
      setHTMLWithScripts(container, embed);
      if (section) section.hidden = false;
    } else if (posts.length) {
      container.innerHTML = posts.map(igBlockquote).join('');
      loadScript('https://www.instagram.com/embed.js', () => {
        if (window.instgrm && window.instgrm.Embeds) window.instgrm.Embeds.process();
      });
      if (section) section.hidden = false;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
