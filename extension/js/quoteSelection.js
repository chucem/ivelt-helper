// Quote a selection, with the post's own ציטיר button
//
// While words in a post are selected, that post's ציטיר button changes (its icon, its text and
// its color) to "ציטיר אנגעצייכנט", and a click on it quotes just those words where the cursor
// is in the reply box, instead of the whole post. With nothing selected it's the forum's own
// button again. Nothing pops up over the text, so it doesn't get in the way of double-clicking
// or copying. Only where there's a reply box on the page, and not for words inside a quote.
//
// On a phone (or zoomed in) the post's buttons are in its ⋯ menu, where phpBB keeps a copy of
// each one, so the copy is marked too. Tapping ⋯ clears the selection on a touch screen, so the
// selected words are kept while that menu is being used, and quoted from what was kept.
//
// Runs as a content script (isolated world), controlled by the "quoteSelection" setting.

(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const SETTING_KEY = 'quoteSelection';
    const JUMP_KEY = 'quoteJumpToReply'; // after quoting, go down to the reply box (on by default)
    const DONE_MS = 1200;
    const MARKED_ICON = 'fa-i-cursor';
    const MARKED_TEXT = 'ציטיר אנגעצייכנט';

    // The post whose quote button is marked, with what the button was before and the selection it
    // would quote: { post, iconClass, labelText, title, content, range }
    let marked = null;
    let doneUntil = 0;
    // When the marked post's ⋯ menu was last pressed (its toggle or a button in it)
    let menuPressAt = 0;
    // The selection is gone, but because the post's ⋯ menu was pressed: the mark and the selected
    // words stay until the menu is used, or something else is pressed
    let held = false;
    const MENU_PRESS_MS = 1500;
    // Where the user left the cursor in the reply box, once they clicked or typed in it: a quote goes
    // there. Kept as they go, since selecting text in the page can reset the box's own cursor
    let caret = null;
    let jumpToReply = false;

    function init() {
        if (!getTextarea() || !chrome.storage || !chrome.storage.local) return;

        chrome.storage.local.get([SETTING_KEY, JUMP_KEY], (items) => {
            jumpToReply = items[JUMP_KEY] !== false;
            if (items[SETTING_KEY] !== false) start();
        });
    }

    function start() {
        const textarea = getTextarea();

        ['mouseup', 'keyup', 'input'].forEach((type) => {
            textarea.addEventListener(type, (event) => {
                if (event.isTrusted) caret = textarea.selectionEnd;
            });
        });

        let updateTimeout;
        document.addEventListener('selectionchange', () => {
            clearTimeout(updateTimeout);
            updateTimeout = setTimeout(update, 60);
        });

        // in the capture phase, before the forum's own handlers on the button
        document.addEventListener('pointerdown', (event) => {
            if (isInMenu(event.target)) menuPressAt = Date.now();
            else if (held) unmark(); // the ⋯ menu was left without quoting
        }, true);
        document.addEventListener('mousedown', (event) => {
            // pressing the marked button (or the ⋯ menu it's in) mustn't clear the selection it's
            // about to quote
            if (getMarkedLink(event.target) || isInMenu(event.target)) event.preventDefault();
        }, true);
        document.addEventListener('click', (event) => {
            const link = getMarkedLink(event.target);
            // not while it says "צוגעלייגט": a second tap would add the same quote again
            if (!link || Date.now() < doneUntil) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            const end = addQuote(marked.content, selectedText(marked.content, marked.range));
            showDone();
            window.getSelection().removeAllRanges();
            if (jumpToReply) {
                closeMenu(link);
                goToReply(end);
            }
        }, true);
    }

    // The marked post's quote button (on the bar or in its ⋯ menu) that the target is in
    function getMarkedLink(target) {
        if (!marked || !(target instanceof Element)) return null;
        const link = target.closest('a');
        return link && findQuoteLinks(marked.post).includes(link) ? link : null;
    }

    // Whether the target is in the marked post's ⋯ menu (phpBB's .responsive-menu)
    function isInMenu(target) {
        if (!marked || !(target instanceof Element)) return false;
        const menu = target.closest('.post-buttons .responsive-menu');
        return !!menu && marked.post.contains(menu);
    }

    // Closes the ⋯ menu the button was clicked in, since the click doesn't reach the forum's own
    // handler that would close it
    function closeMenu(link) {
        const menu = link.closest('.dropdown-container.dropdown-visible');
        const toggle = menu && menu.querySelector(':scope > .dropdown-toggle');
        if (toggle) toggle.click();
    }

    function getTextarea() {
        return document.querySelector('#message-box textarea');
    }

    // Marks the quote button of the post the selection is in, or puts it back when there's none
    function update() {
        if (Date.now() < doneUntil) return;

        const selection = window.getSelection();
        const text = selection.toString().trim();
        const content = text && selection.rangeCount && getQuotableContent(selection);
        const post = content && content.closest('.post');
        if (!post || !findQuoteLinks(post).length) {
            // tapping ⋯ on a touch screen clears the selection: it's kept for the menu
            if (marked && (held || Date.now() - menuPressAt < MENU_PRESS_MS)) held = true;
            else unmark();
            return;
        }

        held = false;
        if (marked && marked.post !== post) unmark();
        mark(post);
        marked.content = content;
        marked.range = selection.getRangeAt(0).cloneRange();
    }

    // The selected words, only from the post the selection was started in: a selection dragged on
    // past the post (into the signature, the next post…, or up into the one before) is cut back to
    // the post first. Taken from the selection itself, which has the line breaks as they show: the
    // kept one is selected again if it's gone (on a touch screen, by tapping ⋯)
    function selectedText(content, kept) {
        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) {
            selection.removeAllRanges();
            selection.addRange(kept);
        }
        const range = selection.getRangeAt(0);
        const startsIn = content.contains(range.startContainer), endsIn = content.contains(range.endContainer);
        if (!startsIn || !endsIn) {
            const clipped = range.cloneRange();
            if (!startsIn) {
                // from the top of the post, but after the quotes it starts with
                clipped.setStart(content, 0);
                const quotes = [...content.querySelectorAll(':scope > blockquote')]
                    .filter((quote) => clipped.comparePoint(quote, quote.childNodes.length) === 0);
                if (quotes.length) clipped.setStartAfter(quotes[quotes.length - 1]);
            }
            if (!endsIn) clipped.setEnd(content, content.childNodes.length);
            selection.removeAllRanges();
            selection.addRange(clipped);
        }
        return selection.toString().trim();
    }

    // The forum's own ציטיר buttons of the post (not the extension's "ציטיר לעצטע", which has
    // "last"): the one on the bar, and phpBB's copy of it in the ⋯ menu
    function findQuoteLinks(post) {
        return [...post.querySelectorAll('.post-buttons a[href*="mode=quote"]')]
            .filter((link) => !link.querySelector('.last'));
    }

    // Marks all of the post's quote buttons (again each time, so a copy made since is marked too)
    function mark(post) {
        if (!marked) {
            const link = findQuoteLinks(post)[0];
            const icon = link.querySelector('i.icon');
            const label = link.querySelector('span');
            marked = {
                post,
                iconClass: icon ? icon.className : '',
                labelText: label ? label.textContent : '',
                title: link.getAttribute('title')
            };
        }
        setLinks(`icon ${MARKED_ICON} fa-fw`, MARKED_TEXT, MARKED_TEXT, true);
    }

    function unmark() {
        held = false;
        if (!marked) return;
        const { iconClass, labelText, title } = marked;
        setLinks(iconClass, labelText, title, false);
        marked = null;
    }

    function setLinks(iconClass, labelText, title, isMarked) {
        findQuoteLinks(marked.post).forEach((link) => {
            const icon = link.querySelector('i.icon');
            const label = link.querySelector('span');
            if (icon) icon.className = iconClass;
            if (label) label.textContent = labelText;
            if (title === null) link.removeAttribute('title');
            else link.setAttribute('title', title);
            link.classList.toggle('ih-quote-marked', isMarked);
        });
    }

    // "צוגעלייגט ✓" on the button for a moment, then it's the forum's own button again
    function showDone() {
        if (!marked) return;
        held = false;
        doneUntil = Date.now() + DONE_MS;
        setLinks('icon fa-check fa-fw', 'צוגעלייגט', 'צוגעלייגט', true);
        setTimeout(() => {
            doneUntil = 0;
            unmark();
            update();
        }, DONE_MS);
    }

    // The post the selection was started in (its anchor, which is the end when dragged upwards)
    function getQuotableContent(selection) {
        const start = selection.anchorNode;
        const element = start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement;
        if (element.closest('blockquote') || element.closest('#preview')) return null;
        return element.closest('.postbody .content');
    }

    function getPostId(content) {
        for (let node = content; node; node = node.parentElement) {
            const match = node.id.match(/\d+$/);
            if (match) return match[0];
        }
        return '';
    }

    function addQuote(content, text) {
        const post = content.closest('.post') || content;
        const postId = getPostId(content);
        const usernameElm = post.querySelector('.username, .username-coloured');
        const username = usernameElm ? usernameElm.textContent.trim() : '';
        const userId = usernameElm && usernameElm.href ? new URL(usernameElm.href).searchParams.get('u') || '' : '';
        const timeElm = post.querySelector('time');
        const time = timeElm ? Date.parse(timeElm.dateTime) / 1000 : '';

        // The topic review under the reply box shows the date as plain text, without a <time>:
        // what isn't known is left out rather than written empty
        const attributes = [`user_id=${userId}`, `time=${time}`, `post_id=${postId}`].filter((a) => !a.endsWith('='));
        const quote = `[quote="${username}" ${attributes.join(' ')}]\n${text}\n[/quote]`;

        // Where the cursor was in the text, or else after the quotes already on top. On a line of its
        // own with an empty line after it, as the forum's own quote button leaves it, and the cursor
        // goes on the line after that
        const textarea = getTextarea();
        const at = caret !== null ? Math.min(caret, textarea.value.length) : endOfQuotesOnTop(textarea.value);
        const before = textarea.value.slice(0, at);
        const after = textarea.value.slice(at);
        const lead = before && !before.endsWith('\n') ? '\n' : '';
        const trail = '\n\n'.slice(after.match(/^\n{0,2}/)[0].length);
        textarea.setRangeText(lead + quote + trail, at, at, 'end');
        const cursor = at + lead.length + quote.length + 2;
        if (caret !== null) caret = cursor;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return cursor;
    }

    // Down to the reply box, ready to type under the quote that was just added
    // (the "quoteJumpToReply" setting)
    function goToReply(at) {
        const textarea = getTextarea();
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(at, at);
        caret = at;
        textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function endOfQuotesOnTop(text) {
        const tag = /\[(\/?)quote\b[^\]]*\]/gi;
        let end = 0;
        let depth = 0;
        let match;

        while ((match = tag.exec(text))) {
            const closing = match[1] === '/';
            if (depth === 0 && (closing || text.slice(end, match.index).trim()))
                break;

            depth += closing ? -1 : 1;
            if (depth === 0)
                end = tag.lastIndex;
        }

        return end;
    }

    init();
})();
