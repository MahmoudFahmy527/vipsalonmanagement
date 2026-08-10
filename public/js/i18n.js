/* ============================================================
   i18n.js — bilingual (Arabic / English) storefront toggle.
   ------------------------------------------------------------
   • Static text: tag elements with data-i18n / data-i18n-ph /
     data-i18n-html and they translate on load + on toggle.
   • Dynamic text (rendered by page JS): call window.t('key').
   • Staff-vertical wording (data-staff-*) stays owned by brand.js
     in Arabic; in English we override with a business-type term
     and restore the Arabic on switch-back.
   • Language persists in localStorage; dir flips rtl↔ltr.
   Load AFTER brand.js on every storefront page.
   ============================================================ */
(function () {
  'use strict';
  const KEY = 'salon_lang';

  const DICT = {
    ar: {
      // nav / shared
      nav_home: 'الرئيسية', nav_services: 'خدماتنا', nav_gallery: 'معرض الأعمال',
      nav_reviews: 'التقييمات', nav_book: 'احجز الآن', back_home: '→ العودة للرئيسية',
      // home hero / sections
      hero_cta: 'احجز موعدك الآن',
      services_title: 'خدماتنا', services_sub: 'أفضل خدمات العناية بالمظهر بأعلى جودة',
      view_all_services: 'عرض جميع الخدمات',
      gallery_title: 'معرض الأعمال', gallery_sub: 'شاهد أحدث أعمالنا', view_full_gallery: 'عرض المعرض الكامل',
      ig_title: '📸 إنستجرام', ig_sub: 'تابع أحدث أعمالنا', ig_follow: 'تابعنا على إنستجرام',
      reviews_title: 'آراء العملاء',
      add_review: 'أضف تقييمك', rev_name: 'الاسم', rev_name_ph: 'اسمك',
      rev_rating: 'التقييم', rev_staff: 'الحلاق (اختياري)', rev_staff_any: '— تقييم عام للصالون —',
      rev_text: 'رأيك (اختياري)', rev_text_ph: 'أخبرنا عن تجربتك...', rev_submit: 'إرسال التقييم',
      rev_thanks: 'شكراً! تم إرسال تقييمك', rev_failed: 'تعذر إرسال التقييم', rev_need_name: 'يرجى إدخال الاسم',
      rev_be_first: 'كن أول من يترك تقييماً!',
      rate_5: '⭐⭐⭐⭐⭐ ممتاز', rate_4: '⭐⭐⭐⭐ جيد جداً', rate_3: '⭐⭐⭐ جيد', rate_2: '⭐⭐ مقبول', rate_1: '⭐ ضعيف',
      contact_title: 'تواصل معنا', whatsapp: '💬 واتساب', call_us: '📞 اتصل بنا',
      rights: 'جميع الحقوق محفوظة',
      // booking flow
      book_title_1: 'احجز', book_title_2: 'موعدك', book_sub: 'اختر الخدمة والموعد المناسب لك',
      step_branch: 'اختر الفرع', step_service: 'اختر الخدمة', step_date: 'اختر التاريخ',
      step_time: 'اختر الموعد', step_details: 'أدخل بياناتك',
      back: '← رجوع', minutes: 'دقيقة',
      slot_available: '🟢 متاح', slot_pending: '🟡 قيد الانتظار', slot_taken: '🔴 محجوز',
      name: 'الاسم', name_ph: 'أدخل اسمك الكامل', phone: 'رقم الهاتف',
      confirm_booking: 'تأكيد الحجز', submitting: 'جاري الإرسال...',
      success_title: 'تم إرسال الحجز بنجاح!', success_sub: 'سيتم مراجعة حجزك وتأكيده قريباً',
      // booking dynamic
      load_services_failed: 'تعذر تحميل الخدمات', no_services: 'لا توجد خدمات متاحة حالياً',
      no_slots: 'لا توجد مواعيد متاحة في هذا اليوم', try_another: 'جرّب تاريخاً آخر أو موعداً آخر',
      dawn: ' (فجراً)', fill_all: 'يرجى ملء جميع البيانات',
      booking_sent: 'تم إرسال الحجز بنجاح! ✅', booking_error: 'حدث خطأ أثناء الحجز',
      sum_branch: 'الفرع', sum_service: 'الخدمة', sum_price: 'السعر', sum_date: 'التاريخ', sum_time: 'الموعد',
      my_bookings: '📅 حجوزاتك', service_fallback: 'خدمة',
      st_pending: 'قيد المراجعة', st_accepted: 'مؤكد', st_rejected: 'مرفوض', st_reserved: 'محجوز',
      booking_with: 'حجزك مع', wa_send: '💬 أرسل الحجز عبر واتساب',
      any_staff: 'أي {s} متاح', we_book_first: 'نحجز لك أول {s} متاح',
      welcome_back: '👋 أهلاً بعودتك يا', not_you: 'مش إنت؟',
      // gallery page
      gal_title_1: 'معرض', gal_title_2: 'الأعمال', gal_sub: 'شاهد أحدث أعمالنا وتصميماتنا',
      gal_empty: 'سيتم إضافة الأعمال قريباً', gal_empty_sub: 'تابعنا على وسائل التواصل لمشاهدة آخر أعمالنا',
      share_photo: '📷 شارك صورتك', share_title: 'شارك صورتك', share_note: 'ستتم مراجعة الصورة قبل نشرها في المعرض.',
      your_name: 'اسمك (اختياري)', your_name_ph: 'اسمك', comment: 'تعليق (اختياري)', comment_ph: 'مثال: قصة شعر جديدة',
      photo: 'الصورة', send_review: 'إرسال للمراجعة',
      pick_photo: 'اختر صورة أولاً', images_only: 'الصور فقط مسموح بها',
      submit_thanks: 'شكراً! سيتم مراجعة صورتك قبل نشرها', submit_failed: 'تعذر الإرسال',
    },
    en: {
      nav_home: 'Home', nav_services: 'Services', nav_gallery: 'Gallery',
      nav_reviews: 'Reviews', nav_book: 'Book now', back_home: '← Back to home',
      hero_cta: 'Book your appointment',
      services_title: 'Our Services', services_sub: 'Top grooming services at the highest quality',
      view_all_services: 'View all services',
      gallery_title: 'Our Work', gallery_sub: 'See our latest work', view_full_gallery: 'View full gallery',
      ig_title: '📸 Instagram', ig_sub: 'Follow our latest work', ig_follow: 'Follow us on Instagram',
      reviews_title: 'Client Reviews',
      add_review: 'Add your review', rev_name: 'Name', rev_name_ph: 'Your name',
      rev_rating: 'Rating', rev_staff: 'Staff member (optional)', rev_staff_any: '— General salon review —',
      rev_text: 'Your review (optional)', rev_text_ph: 'Tell us about your experience...', rev_submit: 'Submit review',
      rev_thanks: 'Thanks! Your review was submitted', rev_failed: 'Could not submit review', rev_need_name: 'Please enter your name',
      rev_be_first: 'Be the first to leave a review!',
      rate_5: '⭐⭐⭐⭐⭐ Excellent', rate_4: '⭐⭐⭐⭐ Very good', rate_3: '⭐⭐⭐ Good', rate_2: '⭐⭐ Fair', rate_1: '⭐ Poor',
      contact_title: 'Contact us', whatsapp: '💬 WhatsApp', call_us: '📞 Call us',
      rights: 'All rights reserved',
      book_title_1: 'Book', book_title_2: 'your appointment', book_sub: 'Choose the service and time that suit you',
      step_branch: 'Choose a branch', step_service: 'Choose a service', step_date: 'Choose a date',
      step_time: 'Choose a time', step_details: 'Enter your details',
      back: '← Back', minutes: 'min',
      slot_available: '🟢 Available', slot_pending: '🟡 Pending', slot_taken: '🔴 Booked',
      name: 'Name', name_ph: 'Enter your full name', phone: 'Phone number',
      confirm_booking: 'Confirm booking', submitting: 'Sending...',
      success_title: 'Booking sent successfully!', success_sub: 'Your booking will be reviewed and confirmed soon',
      load_services_failed: 'Failed to load services', no_services: 'No services available right now',
      no_slots: 'No slots available on this day', try_another: 'Try another date or time',
      dawn: ' (AM)', fill_all: 'Please fill in all fields',
      booking_sent: 'Booking sent successfully! ✅', booking_error: 'Something went wrong while booking',
      sum_branch: 'Branch', sum_service: 'Service', sum_price: 'Price', sum_date: 'Date', sum_time: 'Time',
      my_bookings: '📅 Your bookings', service_fallback: 'Service',
      st_pending: 'Under review', st_accepted: 'Confirmed', st_rejected: 'Rejected', st_reserved: 'Reserved',
      booking_with: 'Your booking with', wa_send: '💬 Send booking via WhatsApp',
      any_staff: 'Any available {s}', we_book_first: "We'll book the first available {s}",
      welcome_back: '👋 Welcome back,', not_you: 'Not you?',
      gal_title_1: 'Our', gal_title_2: 'Gallery', gal_sub: 'See our latest work and styles',
      gal_empty: 'Work will be added soon', gal_empty_sub: 'Follow us on social media for our latest work',
      share_photo: '📷 Share your photo', share_title: 'Share your photo', share_note: 'Your photo will be reviewed before it appears in the gallery.',
      your_name: 'Your name (optional)', your_name_ph: 'Your name', comment: 'Comment (optional)', comment_ph: 'e.g. Fresh new haircut',
      photo: 'Photo', send_review: 'Submit for review',
      pick_photo: 'Choose a photo first', images_only: 'Images only',
      submit_thanks: 'Thanks! Your photo will be reviewed before publishing', submit_failed: 'Could not submit',
    },
  };

  // Localized staff noun for English (Arabic stays with brand.js).
  const STAFF_EN = {
    barbershop: { s: 'barber', p: 'Barbers', choose: 'Choose your barber' },
    beauty: { s: 'stylist', p: 'Stylists', choose: 'Choose your stylist' },
    spa: { s: 'therapist', p: 'Therapists', choose: 'Choose your therapist' },
    custom: { s: 'staff member', p: 'Staff', choose: 'Choose staff' },
  };
  function staffEn() {
    const bt = (window.SALON && window.SALON.business_type) || 'barbershop';
    return STAFF_EN[bt] || STAFF_EN.barbershop;
  }
  const cap = (w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

  let lang;
  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'ar'; } catch (_) { lang = 'ar'; }

  function t(key) {
    const d = DICT[lang] || DICT.ar;
    if (d[key] != null) return d[key];
    return DICT.ar[key] != null ? DICT.ar[key] : key;
  }

  function applyStaffWording() {
    const en = lang === 'en';
    const save = (el) => { if (el.dataset.arText == null) el.dataset.arText = el.textContent; };
    const eng = staffEn();
    document.querySelectorAll('[data-staff-label]').forEach((el) => {
      save(el); if (en) el.textContent = cap(eng.s); else if (el.dataset.arText != null) el.textContent = el.dataset.arText;
    });
    document.querySelectorAll('[data-staff-plural]').forEach((el) => {
      save(el); if (en) el.textContent = eng.p; else if (el.dataset.arText != null) el.textContent = el.dataset.arText;
    });
    document.querySelectorAll('[data-staff-choose]').forEach((el) => {
      save(el); if (en) el.textContent = eng.choose; else if (el.dataset.arText != null) el.textContent = el.dataset.arText;
    });
  }

  function apply() {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'en' ? 'ltr' : 'rtl';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n')); if (v != null) el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n-ph')); if (v != null) el.setAttribute('placeholder', v);
    });
    document.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const v = t(el.getAttribute('data-i18n-html')); if (v != null) el.innerHTML = v;
    });
    applyStaffWording();
    document.querySelectorAll('[data-lang-toggle]').forEach((b) => { b.textContent = lang === 'en' ? 'العربية' : 'EN'; });
    document.dispatchEvent(new CustomEvent('lang:changed', { detail: { lang } }));
  }

  function set(l) {
    lang = l === 'en' ? 'en' : 'ar';
    try { localStorage.setItem(KEY, lang); } catch (_) {}
    apply();
  }
  function toggle() { set(lang === 'en' ? 'ar' : 'en'); }

  // Arabic currency symbols → ISO codes for the English view.
  const CURRENCY_EN = {
    'ج.م': 'EGP', 'ر.س': 'SAR', 'د.إ': 'AED', 'ر.ق': 'QAR', 'د.ك': 'KWD',
    'ر.ع': 'OMR', 'د.ب': 'BHD', 'د.أ': 'JOD', 'د.ا': 'JOD', 'ل.ل': 'LBP',
    'د.ل': 'LYD', 'د.ت': 'TND', 'د.ج': 'DZD', 'درهم': 'MAD', 'ل.س': 'SYP',
    'ر.ي': 'YER', 'ج.س': 'SDG',
  };
  function currencyLocalized() {
    const c = (window.SALON && window.SALON.currency) || 'ج.م';
    if (lang !== 'en') return c;
    return CURRENCY_EN[c.trim()] || c; // fall back to the raw symbol if unmapped ($/€ etc.)
  }

  window.I18N = {
    t,
    get lang() { return lang; },
    set, toggle, apply,
    staffWord: () => (lang === 'en' ? staffEn().s : (window.getStaffLabel ? window.getStaffLabel() : 'حلاق')),
    currency: currencyLocalized,
  };
  window.t = t;
  window.getCurrencyLocalized = currencyLocalized;

  // Toggle buttons (event delegation so dynamically added ones work too).
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang-toggle]');
    if (b) { e.preventDefault(); toggle(); }
  });

  // Apply on load, and re-apply English staff wording once brand.js finishes.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
  document.addEventListener('branding:ready', applyStaffWording);
})();
