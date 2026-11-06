// The forum's count of unread notifications. When they're split into bells (js/splitNotifications.js)
// it's spread over them: each bell's count, the grey "+N", and the unread private message
// notifications (the PM icon's own count is of unread messages, not of notifications)
let unreadNotifications = function() {
    const group = document.querySelector('.notif-group');
    if (!group)
        return (notificationNode.innerHTML.match(/\d+/) || ['0'])[0];

    let count = 0;
    group.querySelectorAll('.dropdown-trigger:not(#pm_notification_list_button) strong.badge, #more_unread_notifications strong.badge')
        .forEach(badge => count += parseInt(badge.textContent.replace('+', ''), 10) || 0);
    count += group.querySelectorAll('#pm_notification_list li.bg1, #pm_notification_list li.bg2').length;
    return String(count);
}

let checkNewNotification = function() {
    // the extension was reloaded or updated while this tab stayed open: this copy can't reach it
    // any more ("Extension context invalidated"), so it stops watching
    if (!chrome.runtime?.id) {
        observer?.disconnect();
        return;
    }
    let newCount = unreadNotifications();
    chrome.runtime.sendMessage({text: newCount !== '0' ? newCount : '', type: 'badgeText'});
}

let observer = null;

const notificationNode = document.getElementById('notification_list_button');
if(notificationNode){
    // The whole header menu, since the bells are made (and moved into one group) after this starts,
    // and a PM notification marked read only changes its row's class
    const config = { characterData : true, childList: true, subtree: true, attributes: true, attributeFilter: ['class'] };
    observer = new MutationObserver(checkNewNotification);
    observer.observe(notificationNode.closest('ul') || notificationNode, config);

    checkNewNotification();
}
