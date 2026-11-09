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

    // A mention in a private message is plain BBCode, since the mention tag isn't allowed there
    // (js/pmMentions.js): a profile link around "@name" in bold and in the mention's blue. It's
    // shown here as a real mention, so it looks the same and takes the theme's mention color.
    const PM_MENTION_COLOR = /^color:\s*#115098;?$/i;

    function init() {
        document.querySelectorAll('.content a.postlink[href*="mode=viewprofile"]').forEach(restoreMention);
        document.querySelectorAll('em.mention').forEach(linkMention);
    }

    function restoreMention(link) {
        const span = link.firstElementChild;
        if (link.childNodes.length !== 1 || !span || span.tagName !== 'SPAN'
            || !PM_MENTION_COLOR.test(span.getAttribute('style') || '')) return;
        const bold = span.firstElementChild;
        if (span.childNodes.length !== 1 || !bold || bold.tagName !== 'STRONG') return;
        const text = bold.textContent;
        if (!/^@\S/.test(text)) return;

        const mention = document.createElement('em');
        mention.className = 'mention';
        mention.textContent = text;
        link.className = 'ih-mention-link';
        link.replaceChildren(mention);
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
