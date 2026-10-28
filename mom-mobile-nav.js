/* Mobile dock only: navigation highlight, never changes order/payment behavior. */
(() => {
  function initMomDock() {
    const dock = document.getElementById('mom-mobile-nav');
    if (!dock) return;
    const tabs = [...dock.querySelectorAll('[data-mom-tab]')];
    const activate = target => {
      for (const tab of tabs) {
        tab.classList.toggle('active', tab === target);
        if (tab === target && tab.tagName === 'A') tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
      }
    };
    dock.addEventListener('click', event => {
      const target = event.target.closest('[data-mom-tab]');
      if (!target || !dock.contains(target)) return;
      // Language is a toggle, not a destination.
      if (target.dataset.momTab !== 'language') activate(target);
    });
    window.addEventListener('hashchange', () => {
      const key = window.location.hash;
      if (key === '#mom-menu-section') activate(dock.querySelector('[data-mom-tab="menu"]'));
      if (key === '#view-customer' || key === '') activate(dock.querySelector('[data-mom-tab="home"]'));
    });
    const initial = window.location.hash === '#mom-menu-section'
      ? dock.querySelector('[data-mom-tab="menu"]')
      : dock.querySelector('[data-mom-tab="home"]');
    activate(initial);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMomDock, {once:true});
  } else initMomDock();
})();
