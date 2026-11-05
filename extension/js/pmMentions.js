// Mentions in a private message
//
// Sending a PM from a post (the post's PM button, or the extension's PM button on a phone)
// fills in the post as a quote, and a mention in it comes along as the mention add-on's tag,
// [smention u=<user id>]name[/smention]. That tag isn't allowed in private messages, so the
// forum refuses to send ("you can't use the following BBCode: [smention]"). Here the tag
// becomes BBCode that PMs allow and that looks like a mention: a link to the user's profile,
// in bold and in the mention's blue. The link goes by the user ID (it stays right if the user is
// renamed); a tag without one links by name.
//
// Done when the PM editor opens, and again just before it's sent or previewed (send,
// preview and Ctrl+Enter all submit the form), for a mention pasted in later.
//
// Runs as a content script (isolated world) on ucp.php.

(function () {
    'use strict';

    const params = new URLSearchParams(location.search);
    if (!/^(ucp_)?pm$/.test(params.get('i') || '')) return;

    const MENTION_COLOR = '#115098'; // the forum's .mention color
    const MENTION_TAG = /\[(s?mention)\b([^\]]*)\]([\s\S]*?)\[\/\1\]/gi;

    function profileUrl(attrs, name) {
        const base = location.origin + '/forum/memberlist.php?mode=viewprofile&';
        const id = /\bu\s*=\s*["']?(\d+)/i.exec(attrs);
        return id ? base + 'u=' + id[1] : base + 'un=' + encodeURIComponent(name);
    }

    function convert(text) {
        return text.replace(MENTION_TAG, (whole, tag, attrs, inner) => {
            const name = inner.trim().replace(/^@/, '');
            if (!name) return inner;
            // the color inside the link, or the link's own color wins
            return `[url=${profileUrl(attrs, name)}][color=${MENTION_COLOR}][b]@${name}[/b][/color][/url]`;
        });
    }

    function convertEditor(textarea) {
        if (!textarea) return;
        const converted = convert(textarea.value);
        if (converted === textarea.value) return;
        textarea.value = converted;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const form = document.getElementById('postform');
    if (!form) return;
    convertEditor(form.querySelector('#message'));

    // Capture phase, so it runs before anything else that handles the submit
    document.addEventListener('submit', (e) => {
        if (e.target === form) convertEditor(form.querySelector('#message'));
    }, true);
})();
