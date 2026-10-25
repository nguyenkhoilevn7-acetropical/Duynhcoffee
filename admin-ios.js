/* Mom Tea & Coffee — Admin iOS navigation enhancement.
   Presentation only: original tab buttons and action handlers are preserved. */
(function () {
  'use strict';

  function init() {
    const root = document.getElementById('view-backend');
    if (!root || root.dataset.iosAdminReady === '1') return;

    const header = root.querySelector('.backend-header');
    const nav = root.querySelector('.backend-tabs-nav');
    if (!header || !nav || !header.children[1]) return;

    const primaryIds = new Set(['btn-tab-new', 'btn-tab-prep', 'btn-tab-shipping']);
    const tabGroups = [
      { name: 'orders', vi: 'Quản lý đơn hàng', en: 'Orders', ids: ['btn-tab-done', 'btn-tab-cancelled', 'btn-tab-all'] },
      { name: 'business', vi: 'Kinh doanh & vận hành', en: 'Business & operations', ids: ['btn-tab-profits', 'btn-tab-menu', 'btn-tab-inventory', 'btn-tab-discounts', 'btn-tab-banner', 'btn-tab-settings'] }
    ];

    const tools = header.children[1];
    const notice = header.nextElementSibling;
    const stats = document.getElementById('stat-total-orders');
    if (stats && stats.parentElement && stats.parentElement.parentElement) {
      stats.parentElement.parentElement.classList.add('ios-admin-stats');
    }

    const backdrop = document.createElement('div');
    backdrop.id = 'ios-admin-backdrop';
    backdrop.hidden = true;

    const drawer = document.createElement('aside');
    drawer.id = 'ios-admin-drawer';
    drawer.hidden = true;
    drawer.setAttribute('role', 'dialog');
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('aria-labelledby', 'ios-admin-drawer-title');

    const drawerHead = document.createElement('div');
    drawerHead.className = 'ios-admin-drawer-head';
    const heading = document.createElement('div');
    heading.id = 'ios-admin-drawer-title';
    heading.className = 'ios-admin-drawer-title';
    const close = document.createElement('button');
    close.type = 'button';
    close.id = 'ios-admin-drawer-close';
    close.className = 'ios-admin-close';
    close.textContent = '×';
    drawerHead.append(heading, close);
    drawer.appendChild(drawerHead);

    const drawerScroll = document.createElement('div');
    drawerScroll.className = 'ios-admin-drawer-scroll';
    drawer.appendChild(drawerScroll);

    function section(id, vi, en) {
      const group = document.createElement('section');
      group.className = 'ios-admin-drawer-group';
      group.dataset.group = id;
      const label = document.createElement('h3');
      label.dataset.vi = vi;
      label.dataset.en = en;
      group.appendChild(label);
      drawerScroll.appendChild(group);
      return group;
    }

    tabGroups.forEach(function (group) {
      const container = section(group.name, group.vi, group.en);
      group.ids.forEach(function (id) {
        const item = document.getElementById(id);
        if (!item) return;
        item.classList.add('ios-admin-drawer-tab');
        container.appendChild(item);
      });
    });

    const alerts = section('alerts', 'Thông báo điện thoại', 'Phone notifications');
    if (notice && notice.tagName === 'SECTION' && notice.querySelector('#admin-push-status')) {
      notice.classList.add('ios-admin-push-panel');
      alerts.appendChild(notice);
    }

    const actions = section('tools', 'Công cụ & tài khoản', 'Tools & account');
    tools.classList.add('ios-admin-tool-buttons');
    actions.appendChild(tools);

    const toolbar = document.createElement('div');
    toolbar.className = 'ios-admin-toolbar';
    const current = document.createElement('span');
    current.id = 'ios-admin-current-tab';
    current.className = 'ios-admin-current-tab';
    current.setAttribute('aria-live', 'polite');
    const open = document.createElement('button');
    open.type = 'button';
    open.id = 'ios-admin-menu-toggle';
    open.className = 'ios-admin-menu-toggle';
    open.setAttribute('aria-controls', drawer.id);
    open.setAttribute('aria-expanded', 'false');
    open.setAttribute('aria-label', 'Mở menu quản trị');
    open.textContent = '☰';
    toolbar.append(current, open);
    header.appendChild(toolbar);

    // Keep the three operational tabs on screen; move all others into the drawer.
    Array.from(nav.querySelectorAll('.backend-tab-btn')).forEach(function (button) {
      if (!primaryIds.has(button.id)) {
        const fallback = drawer.querySelector('[data-group="business"]');
        button.classList.add('ios-admin-drawer-tab');
        if (fallback) fallback.appendChild(button);
      }
    });

    document.body.append(backdrop, drawer);
    root.dataset.iosAdminReady = '1';

    let opened = false;
    let lastFocus = null;
    function setOpen(value) {
      if (opened === value) return;
      opened = value;
      backdrop.hidden = !value;
      drawer.hidden = !value;
      open.setAttribute('aria-expanded', String(value));
      document.body.classList.toggle('ios-admin-menu-open', value);
      if (value) {
        lastFocus = document.activeElement;
        close.focus();
      } else if (lastFocus && typeof lastFocus.focus === 'function' && document.contains(lastFocus)) {
        lastFocus.focus();
      }
    }
    open.addEventListener('click', function () { setOpen(!opened); });
    close.addEventListener('click', function () { setOpen(false); });
    backdrop.addEventListener('click', function () { setOpen(false); });

    function currentTabLabel(button) {
      const copy = button.cloneNode(true);
      copy.querySelectorAll('.tab-badge').forEach(function (badge) { badge.remove(); });
      return (copy.textContent || '').replace(/\s+/g, ' ').trim();
    }
    function syncActive() {
      const active = document.querySelector('.backend-tab-btn.active');
      if (!active) return;
      current.textContent = currentTabLabel(active);
      document.querySelectorAll('.backend-tab-btn').forEach(function (button) {
        button.setAttribute('aria-current', button === active ? 'page' : 'false');
      });
    }

    drawer.addEventListener('click', function (event) {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.classList.contains('backend-tab-btn') ||
          button.closest('.ios-admin-tool-buttons') ||
          button.getAttribute('onclick')?.includes('DuynhAdminNotifications.open(')) {
        setOpen(false);
      }
    });
    nav.addEventListener('click', syncActive);
    const observedButtons = document.querySelectorAll('.backend-tab-btn');
    const observer = new MutationObserver(syncActive);
    observedButtons.forEach(function (button) {
      observer.observe(button, { attributes: true, attributeFilter: ['class'] });
    });

    function updateLanguage() {
      const en = (document.documentElement.lang || '').toLowerCase().startsWith('en');
      heading.textContent = en ? 'Management' : 'Quản trị';
      drawer.querySelectorAll('[data-vi][data-en]').forEach(function (node) {
        node.textContent = en ? node.dataset.en : node.dataset.vi;
      });
      open.setAttribute('aria-label', en ? 'Open management menu' : 'Mở menu quản trị');
      close.setAttribute('aria-label', en ? 'Close menu' : 'Đóng menu');
      syncActive();
    }
    const langObserver = new MutationObserver(updateLanguage);
    langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    document.addEventListener('keydown', function (event) {
      if (!opened) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === 'Tab') {
        const nodes = Array.from(drawer.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled])'))
          .filter(function (node) { return node.getClientRects().length > 0; });
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    });
    // Switching views while the menu is open must never leave its overlay covering customers.
    document.addEventListener('click', function (event) {
      if (!opened || !event.target.closest) return;
      const target = event.target.closest('a, button');
      if (target && target.closest('#ios-admin-drawer') === null &&
          target !== open && target !== close &&
          !root.contains(target)) setOpen(false);
    });
    updateLanguage();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();