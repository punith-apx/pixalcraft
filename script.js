(() => {
  document.documentElement.classList.add('js');
  const config = window.PIXALCRAFT_CONFIG || {};
  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-toggle');
  const menu = document.querySelector('.nav-links');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const updateHeader = () => header?.classList.toggle('scrolled', window.scrollY > 24);
  updateHeader();
  window.addEventListener('scroll', updateHeader, { passive: true });

  menuButton?.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    menu?.classList.toggle('open', open);
  });
  menu?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', 'Open menu');
    menu?.classList.remove('open');
  }));
  const contactDetails = document.querySelector('.contact-details');
  const contactForm = document.querySelector('#contact-form');
  document.querySelectorAll('a[href="#contact"]').forEach(link => link.addEventListener('click', () => {
    if (contactDetails) contactDetails.open = true;
    window.setTimeout(() => contactForm?.elements.name?.focus({ preventScroll: true }), 350);
  }));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton?.getAttribute('aria-expanded') === 'true') {
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.setAttribute('aria-label', 'Open menu');
      menu?.classList.remove('open');
      menuButton.focus();
    }
  });

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reducedMotion) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }), { threshold: 0.12, rootMargin: '0px 0px -28px 0px' });
    revealItems.forEach(item => observer.observe(item));
  } else revealItems.forEach(item => item.classList.add('is-visible'));

  const sectionLinks = [...document.querySelectorAll('.nav-links a[href^="#"]')];
  const sectionTargets = sectionLinks
    .map(link => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);
  if ('IntersectionObserver' in window && sectionTargets.length) {
    const activeSections = new Set();
    const sectionObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) activeSections.add(entry.target.id);
        else activeSections.delete(entry.target.id);
      });
      const active = [...activeSections].at(-1);
      sectionLinks.forEach(link => {
        if (link.hash === `#${active}`) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    }, { rootMargin: '-24% 0px -65% 0px', threshold: 0 });
    sectionTargets.forEach(section => sectionObserver.observe(section));
  }

  document.querySelector('#year').textContent = String(new Date().getFullYear());

  const serialize = (form, title) => {
    const values = Object.fromEntries(new FormData(form).entries());
    return `${title}\n\n${Object.entries(values).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${String(value).trim()}`).join('\n')}\n`;
  };
  async function copyMessage(message) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(message);
      return;
    }
    const temporary = document.createElement('textarea');
    temporary.value = message;
    temporary.setAttribute('readonly', '');
    temporary.className = 'copy-fallback';
    document.body.append(temporary);
    temporary.select();
    const copied = document.execCommand('copy');
    temporary.remove();
    if (!copied) throw new Error('Copy unavailable');
  }
  const setStatus = (node, message) => {
    node.textContent = message;
    node.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  };
  contactForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const status = document.querySelector('#contact-status');
    if (!contactForm.reportValidity()) return;
    const message = serialize(contactForm, 'PIXALCRAFT PROJECT ENQUIRY');
    if (config.contactEmail) {
      const subject = encodeURIComponent(`Project enquiry — ${contactForm.elements.name.value.trim()}`);
      window.location.href = `mailto:${encodeURIComponent(config.contactEmail)}?subject=${subject}&body=${encodeURIComponent(message)}`;
      setStatus(status, 'Your email app should open with the enquiry ready. It has not been sent yet.');
      return;
    }
    const whatsappDestination = String(config.whatsappNumber || '').replace(/\D/g, '');
    if (whatsappDestination.length >= 8 && whatsappDestination.length <= 15) {
      window.location.href = `https://wa.me/${whatsappDestination}?text=${encodeURIComponent(message)}`;
      setStatus(status, 'Opening WhatsApp with your enquiry ready. Review it there before sending.');
      return;
    }
    try {
      await copyMessage(message);
      setStatus(status, 'Enquiry copied. No business email or WhatsApp destination is configured, so it has not been sent.');
    } catch {
      setStatus(status, 'No contact destination is configured. Add a business email or WhatsApp number in config.js to enable direct contact.');
    }
  });
})();
