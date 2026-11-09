(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const SETTING_KEY = 'spoilerPolish';
    const MAX_LINES = 3;
    const EXPAND_MS = 400;
    const BLOCKS = 'div, p, blockquote, dl, ul, ol, table, pre, hr, iframe, video, audio';

    function init() {
        if (!chrome.storage || !chrome.storage.local) return;

        chrome.storage.local.get([SETTING_KEY], (items) => {
            if (items[SETTING_KEY] !== true) return;

            document.querySelectorAll('.spoilwrapper').forEach(hideSpoiler);
        });
    }

    function hideSpoiler(spoiler) {
        const content = spoiler.querySelector('.spoilcontent');
        if (!content) return;

        coverWords(spoiler, content);
        ownElements(spoiler, content, 'img').forEach(coverPicture);

        spoiler.classList.add('ih-spoiler', 'ih-spoiler-hidden');
        if (!content.querySelector(BLOCKS)) {
            spoiler.classList.add('ih-spoiler-inline');
            if (content.getClientRects().length > MAX_LINES) spoiler.classList.add('ih-spoiler-long');
        } else if (wordsPastLines(spoiler, MAX_LINES)) {
            spoiler.classList.add('ih-spoiler-long');
        }

        spoiler.tabIndex = 0;
        spoiler.setAttribute('role', 'button');
        spoiler.title = 'ספוילער';

        const reveal = (event) => {
            if (!spoiler.classList.contains('ih-spoiler-hidden')) return;
            event.preventDefault();
            event.stopPropagation();
            if (spoiler.classList.contains('ih-spoiler-long')) expand(spoiler);
            spoiler.classList.remove('ih-spoiler-hidden');
            spoiler.removeAttribute('tabindex');
            spoiler.removeAttribute('role');
            spoiler.removeAttribute('title');
        };

        spoiler.addEventListener('click', reveal);
        spoiler.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') reveal(event);
        });
    }

    function ownElements(spoiler, content, selector) {
        return [...content.querySelectorAll(selector)].filter((el) => el.closest('.spoilwrapper') === spoiler);
    }

    function coverWords(spoiler, content) {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        const texts = [];
        while (walker.nextNode()) {
            const text = walker.currentNode;
            if (text.textContent.trim() && text.parentElement.closest('.spoilwrapper') === spoiler) texts.push(text);
        }

        texts.forEach((text) => {
            const words = document.createElement('span');
            words.className = 'ih-spoiler-words';
            text.replaceWith(words);
            words.appendChild(text);
        });
    }

    function wordsPastLines(spoiler, lines) {
        const style = getComputedStyle(spoiler);
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
        const limit = spoiler.getBoundingClientRect().top + lines * lineHeight;
        return [...spoiler.querySelectorAll('.ih-spoiler-words')]
            .some((words) => words.getBoundingClientRect().bottom > limit + 1);
    }

    function coverPicture(img) {
        const picture = document.createElement('span');
        picture.className = 'ih-spoiler-picture';
        img.replaceWith(picture);
        picture.appendChild(img);
    }

    function expand(spoiler) {
        spoiler.style.overflow = 'hidden';
        spoiler.style.maxHeight = spoiler.scrollHeight + 'px';
        setTimeout(() => {
            spoiler.style.maxHeight = '';
            spoiler.style.overflow = '';
        }, EXPAND_MS);
    }

    init();
})();
