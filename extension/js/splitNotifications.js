function splitNotifications() {
    const originalLI = document.querySelector('#notification_list')?.closest('li');
    if (!originalLI) return;

    const allItems = Array.from(document.querySelectorAll('#notification_list ul li'));

    const matchType = (li, type) => {
      const title = li.querySelector('.notification-title')?.textContent.trim() || '';
      return title.startsWith(type);
    };

    const citirtItemsAll   = allItems.filter(li => matchType(li, 'ציטירט'));
    const badanktItemsAll  = allItems.filter(li => matchType(li, 'באדאנקט'));
    const dermantItemsAll  = allItems.filter(li => matchType(li, 'דערמאנט'));
    // Private messages go to the forum's own PM icon (with its own count of unread messages), when
    // it's there, instead of being among the general notifications
    const pmLink = [...originalLI.parentElement.querySelectorAll(':scope > li > a')]
      .find(a => /[?&]i=pm\b/.test(a.getAttribute('href') || '') && /folder=inbox/.test(a.getAttribute('href')));
    const pmItemsAll       = pmLink ? allItems.filter(li => matchType(li, 'פריוואטע מעסעדזש')) : [];

    const isUnread = li => li.classList.contains('bg1') || li.classList.contains('bg2');

    const citirtCount  = citirtItemsAll.filter(isUnread).length;
    const badanktCount = badanktItemsAll.filter(isUnread).length;
    const dermantCount = dermantItemsAll.filter(isUnread).length;
    const pmCount      = pmItemsAll.filter(isUnread).length;

    // A copy of the original bell's dropdown, with these items in it
    const originalDropdown = originalLI.querySelector('.dropdown-extended').cloneNode(true);

    // Remove matched items from original list
    [...citirtItemsAll, ...badanktItemsAll, ...dermantItemsAll, ...pmItemsAll].forEach(li => li.remove());

    function createDropdown(type, label, items, footerHref, footerText) {
      const dropdown = originalDropdown.cloneNode(true);
      dropdown.id = `${type}_notification_list`;
      // Not whatever position phpBB had set on the original when it was copied
      dropdown.removeAttribute('style');
      // so the pinned first post isn't drawn over them
      dropdown.style.zIndex = '1000';

      // Update header
      const header = dropdown.querySelector('.header');
      if (header) {
        header.textContent = label;
      }

      // Move original items to the new dropdown
      const ul = dropdown.querySelector('ul');
      if (ul) {
        ul.innerHTML = '';
        items.forEach(item => ul.appendChild(item));
        // phpBB sizes the dropdown to what's in it, so an empty one was just a sliver
        if (!items.length) ul.appendChild(createEmptyRow());
      }

      // Update footer link
      const footerLink = dropdown.querySelector('.footer a');
      if (footerLink) {
        footerLink.href = footerHref;
        footerLink.textContent = footerText;
      }

      return dropdown;
    }

    // Only the newest notifications come with the page, so an empty bell may still have older ones
    function createEmptyRow() {
      const empty = document.createElement('li');
      empty.className = 'no_notifications';
      empty.textContent = 'נישטא קיין לעצטיגע נאטיפיקאציעס';
      return empty;
    }

    function createNotificationBell(type, label, count, items, iconClass) {
      // Clone the original notification LI
      const li = originalLI.cloneNode(true);
      li.id = `${type}_notification_item`;
      li.classList.add('notif-bell');

      // Update the link and badge
      const link = li.querySelector('a.dropdown-trigger');
      if (link) {
        link.id = `${type}_notification_list_button`;
        link.href = '#';

        // Update icon
        const icon = link.querySelector('i.icon');
        if (icon) {
          icon.className = `icon ${iconClass} fa-fw`;
        }

        // Update label
        const labelSpan = link.querySelector('span');
        if (labelSpan) {
          labelSpan.textContent = label;
        }

        // Update badge
        const badge = link.querySelector('strong.badge');
        if (badge) {
          if (count <= 0) {
            badge.remove();
          }
          badge.textContent = count;
        }
      }

      // Update dropdown
      const dropdown = createDropdown(type, label, items, './ucp.php?i=ucp_notifications', 'ווייז אלע');
      li.querySelector('.dropdown-extended').replaceWith(dropdown);
      handleMarkRead(dropdown, link);

      // Opened and closed by phpBB's own dropdown code, like the original bell: it keeps the
      // dropdown on screen (on a phone the bells are near the left edge) and closes it on a
      // click elsewhere
      if (link) registerDropdown(link, dropdown);

      return li;
    }

    // The check mark next to an unread notification. phpBB's own handler always takes one off the
    // original bell's count, so here it's done for the bell the notification is in: the row turns
    // read, this bell's count goes down, and so does the count in the page title. Without a
    // bellLink (the PM icon, whose count is of unread messages) only the row and the title change
    function handleMarkRead(dropdown, bellLink) {
      // in the capture phase, so it runs before phpBB's handler on the link itself, and stops it
      dropdown.addEventListener('click', async (event) => {
        const markRead = event.target.closest('a.mark_read');
        if (!markRead) return;
        event.preventDefault();
        event.stopPropagation();

        const row = markRead.closest('li');
        try {
          const response = await fetch(markRead.href, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          if (!(await response.json()).success) return;
        } catch (e) {
          return;
        }

        row.classList.remove('bg1', 'bg2');
        markRead.remove();
        // the notification's link went through a "mark read" URL until now, as phpBB does it
        const notificationLink = row.querySelector('a[data-real-url]');
        if (notificationLink) notificationLink.href = notificationLink.getAttribute('data-real-url');

        const badge = bellLink?.querySelector('strong.badge');
        if (badge) {
          const count = parseInt(badge.textContent, 10) - 1;
          if (count > 0) badge.textContent = count;
          else badge.remove();
        }
        document.title = document.title.replace(/^\((\d+)\)\s*/, (match, count) => count > 1 ? `(${count - 1}) ` : '');
      }, true);
    }

    function registerDropdown(link, dropdown) {
      if (!window.jQuery || !window.phpbb || !phpbb.registerDropdown) return;
      // After phpBB's own ready handlers, which register every dropdown already on the page (maybe
      // these too, when this ran first), so each is registered once
      jQuery(() => setTimeout(() => {
        if (!jQuery(link).data('dropdown-options'))
          phpbb.registerDropdown(jQuery(link), jQuery(dropdown), { direction: 'auto', verticalDirection: 'auto' });
      }));
    }

    // Create notification bells by cloning the original
    const badanktLI = createNotificationBell('badankt', 'באדאנקט', badanktCount, badanktItemsAll, 'fa-thumbs-up');
    const dermantLI = createNotificationBell('dermant', 'דערמאנט', dermantCount, dermantItemsAll, 'fa-at');
    const citirtLI  = createNotificationBell('citirt', 'ציטירט', citirtCount, citirtItemsAll, 'fa-quote-left');

    // Insert the new notification bells to the left of the original bell
    const parent = originalLI.parentElement;
    if (parent) {
      // Insert in reverse order since we're adding to the left
      [badanktLI, dermantLI, citirtLI].filter(Boolean).forEach(bell => {
        parent.insertBefore(bell, originalLI);
      });
    }

    // The original bell keeps whatever isn't in the others (mostly replies in subscribed topics), so
    // its dropdown says so, next to phpBB's own settings and mark-all links
    const originalHeader = originalLI.querySelector('.dropdown-extended .header');
    const headerText = originalHeader && [...originalHeader.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
    if (headerText) headerText.textContent = 'אנדערע נאטיפיקאציעס';
    const originalUL = originalLI.querySelector('.dropdown-extended ul');
    if (originalUL && !originalUL.children.length) originalUL.appendChild(createEmptyRow());

    // The PM icon opens the private messages, the footer goes to the inbox
    if (pmLink) {
      const pmLI = pmLink.parentElement;
      const dropdown = createDropdown('pm', 'פריוואטע מעסעדזשעס', pmItemsAll, pmLink.getAttribute('href'), 'גיי צום פאסט קעסטל');
      pmLI.classList.add('dropdown-container', 'notif-bell');
      pmLI.id = 'pm_notification_item';
      pmLink.classList.add('dropdown-trigger');
      pmLink.id = 'pm_notification_list_button';
      pmLI.appendChild(dropdown);
      registerDropdown(pmLink, dropdown);
      handleMarkRead(dropdown, null);
    }

    // Update original badge count. The forum only sends the newest notifications with the page, so
    // older unread ones aren't in any of the bells: the original bell counts only the unread ones it
    // has, and a grey "+N" next to it, a plain link to the notifications page, counts the rest.
    // With "olderNotifsPlus" turned off, the original bell counts them too, and there's no "+N".
    const originalBadge = originalLI.querySelector('strong.badge');
    if (originalBadge) {
      const currentCount = parseInt(originalBadge.textContent.trim(), 10);
      let newCount = allItems.filter(li => li.isConnected && originalLI.contains(li) && isUnread(li)).length;
      let missing = currentCount - citirtCount - badanktCount - dermantCount - pmCount - newCount;
      if (missing > 0 && iveltSetting("olderNotifsPlus") === false) {
        newCount += missing;
        missing = 0;
      }

      if (missing > 0 && parent) {
        const moreLI = document.createElement('li');
        moreLI.className = 'rightside';
        moreLI.id = 'more_unread_notifications';
        const link = document.createElement('a');
        link.href = './ucp.php?i=ucp_notifications';
        link.title = missing === 1
          ? 'נאך 1 אומגעליינטע נאטיפיקאציע וואס איז נישט אין די גלעקלעך, דריק צו זען אלע'
          : `נאך ${missing} אומגעליינטע נאטיפיקאציעס וואס זענען נישט אין די גלעקלעך, דריק צו זען אלע`;
        const badge = document.createElement('strong');
        badge.className = 'badge';
        badge.style.backgroundColor = '#8a8a8a';
        // otherwise the right-to-left header shows it as "5+"
        badge.dir = 'ltr';
        badge.textContent = `+${missing}`;
        link.appendChild(badge);
        moreLI.appendChild(link);
        originalLI.after(moreLI);
      }

      if (newCount > 0) {
        originalBadge.textContent = newCount;
      } else {
        originalBadge.remove();
      }
    }

    // All of them in one item of the header, on one light background (see css/appcss.css), so they
    // read as one group apart from the forum's other menus and never wrap apart on a phone
    const group = [pmLink?.parentElement, badanktLI, dermantLI, citirtLI, originalLI,
      document.getElementById('more_unread_notifications')].filter(Boolean);
    if (parent) {
      const groupLI = document.createElement('li');
      groupLI.className = 'rightside notif-group';
      // like the forum's own bell and PM icon, so phpBB doesn't move it out of the header when the
      // header is too narrow for everything (on a phone)
      groupLI.setAttribute('data-skip-responsive', 'true');
      const groupUL = document.createElement('ul');
      groupLI.appendChild(groupUL);
      group[0].before(groupLI);
      group.forEach(li => groupUL.appendChild(li));
    }
}

whenIveltSettingsReady(() => {
  if (iveltSetting("ShowMultiNotifs") === true) {
    splitNotifications();
  }
});