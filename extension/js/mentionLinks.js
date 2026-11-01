// Mentions link to the profile
//
// A mention in a post (@name, from the forum's mention add-on) is only blue text. Here it
// becomes a link to that user's profile. The forum's profile page can find a user by name
// (memberlist.php?mode=viewprofile&un=<name>), so the user's number isn't needed.
//
// Runs as a content script (isolated world).

(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const PROFILE_BY_NAME = '/forum/memberlist.php?mode=viewprofile&un=';

    function init() {
        document.querySelectorAll('em.mention').forEach(linkMention);
    }

    function linkMention(mention) {
        if (mention.closest('a')) return;

        const name = mention.textContent.trim().replace(/^@/, '');
        if (!name) return;

        const link = document.createElement('a');
        link.className = 'ih-mention-link';
        link.href = PROFILE_BY_NAME + encodeURIComponent(name);
        mention.replaceWith(link);
        link.appendChild(mention);
    }

    init();
})();
