// The link button in the post editor, on a phone or tablet
//
// The forum's ABBC3 toolbar opens a small window for the link (the address, and words to show
// instead of it) only on a computer: bbspecial('url') checks phpbb.isTouch and on a touch screen
// just adds an empty [url][/url], so tapping the button looks like it does nothing. ABBC3 turned
// the window off there because it's 500px wide and doesn't fit a phone; css/mobileLinkButton.css
// makes it fit, and this opens it on a touch screen too. Words that were selected become the
// link's words, and the link replaces them.
//
// Runs in the page (a MAIN world content script) to reach the forum's bbspecial and bbwizard.

(function () {
    'use strict';

    // Where ABBC3 itself loads the window from, next to posting.php / ucp.php
    const WIZARD_URL = location.pathname.replace(/[^/]*$/, '') + 'app.php/wizard/bbcode/url';
    const WAIT_MS = 10000;

    // The words selected in the reply box when the window was opened: { textarea, start, end, text }
    let pending = null;

    function getTextarea() {
        try {
            return document.forms[window.form_name].elements[window.text_name];
        } catch (e) {
            return null;
        }
    }

    function isTouch() {
        return !!(window.phpbb && window.phpbb.isTouch);
    }

    function install() {
        const original = window.bbspecial;
        if (typeof original !== 'function' || typeof window.bbwizard !== 'function') return;
        if (original.ivhLinkButton || !document.getElementById('bbcode_wizard')) return;

        const wrapped = function (bbcode) {
            if (bbcode === 'url' && isTouch() && getTextarea()) {
                openLinkWindow();
                return;
            }
            return original.apply(this, arguments);
        };
        wrapped.ivhLinkButton = true;
        window.bbspecial = wrapped;

        // Before ABBC3's own handler: with selected words, put the link in their place ourselves
        // (ABBC3 would add it before them and keep them)
        document.addEventListener('click', onSubmit, true);
    }

    function openLinkWindow() {
        const textarea = getTextarea();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value.slice(start, end);
        pending = text ? { textarea, start, end, text } : null;

        window.bbwizard(WIZARD_URL, 'url');
        whenLoaded((link, description) => {
            if (pending && !description.value) description.value = pending.text;
            link.focus();
        });
    }

    // ABBC3 loads the window's fields with AJAX
    function whenLoaded(callback) {
        const wizard = document.getElementById('bbcode_wizard');
        const find = () => {
            const link = document.getElementById('bbcode_wizard_link');
            const description = document.getElementById('bbcode_wizard_description');
            return link && description ? [link, description] : null;
        };
        const found = find();
        if (found) {
            callback(...found);
            return;
        }
        const observer = new MutationObserver(() => {
            const fields = find();
            if (!fields) return;
            observer.disconnect();
            callback(...fields);
        });
        observer.observe(wizard, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), WAIT_MS);
    }

    function onSubmit(event) {
        const button = event.target.closest && event.target.closest('#bbcode_wizard_submit');
        if (!button || !pending) return;

        const { textarea, start, end, text } = pending;
        pending = null;
        // Only if the selected words are still there as they were
        if (textarea.value.slice(start, end) !== text) return;

        const link = document.getElementById('bbcode_wizard_link').value;
        const description = document.getElementById('bbcode_wizard_description').value;
        // The same BBCode ABBC3 makes
        const bbcode = description ? '[url=' + link + ']' + description + '[/url]' : '[url]' + link + '[/url]';

        event.preventDefault();
        event.stopPropagation();
        textarea.focus();
        textarea.setRangeText(bbcode, start, end, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        // Close it the way ABBC3 does
        const cancel = document.getElementById('bbcode_wizard_cancel');
        if (cancel) cancel.click();
        textarea.focus();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', install);
    } else {
        install();
    }
})();
