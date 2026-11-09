// Topic titles open the first unread post
//
// In a list of topics (a forum, active topics, search results...), clicking the title
// of a topic that has unread posts opens it at the first unread post - the same place
// the forum's own small "new post" icon in front of the title leads to - instead of at
// the first page. Topics with nothing unread open as usual.
//
// Runs as a content script (isolated world) and is controlled by the
// "titleOpensUnread" setting (on by default); turning it on or off applies from the
// next page load.

(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const SETTING_KEY = 'titleOpensUnread';

    function init() {
        if (!chrome.storage || !chrome.storage.local) return;

        chrome.storage.local.get([SETTING_KEY], (items) => {
            if (items[SETTING_KEY] === false) return;

            document.querySelectorAll('.topiclist.topics a.topictitle').forEach((title) => {
                const unreadLink = title.closest('.row').querySelector('a.unread');
                if (unreadLink) title.href = unreadLink.href;
            });
        });
    }

    init();
})();
