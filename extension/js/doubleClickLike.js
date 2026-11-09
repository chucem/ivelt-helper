(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const SETTING_KEY = 'doubleClickLike';
    const IGNORED = 'a, button, input, textarea, select, .post-buttons, .spoilwrapper';

    let hadSelection = false;
    // set at the double-click's second press, when it's on a post's empty space
    let likeAt = null;

    function init() {
        if (!chrome.storage || !chrome.storage.local) return;

        chrome.storage.local.get([SETTING_KEY], (items) => {
            if (items[SETTING_KEY] !== true) return;

            // in the capture phase, before the browser selects anything
            document.addEventListener('mousedown', onMouseDown, true);
            document.addEventListener('dblclick', onDoubleClick);
        });
    }

    // Decided at the presses, before the double-click changes the selection:
    // - at the first, whether words were already selected (then the double-click is about them)
    // - at the second, whether it's on the post's empty space, where the mouse is the arrow and not
    //   the text cursor. Then the browser is kept from selecting a word (it does that even after
    //   the end of a line), so nothing gets selected, and the post is liked on the double-click
    function onMouseDown(event) {
        if (event.detail === 1) {
            hadSelection = !!window.getSelection().toString().trim();
            likeAt = null;
            return;
        }
        if (event.detail !== 2 || event.button !== 0 || hadSelection) return;

        const post = event.target.closest('.post');
        if (!post || event.target.closest(IGNORED)) return;
        if (isOverText(event.target, event.clientX, event.clientY)) return;

        event.preventDefault();
        likeAt = post;
    }

    function onDoubleClick(event) {
        const post = likeAt;
        likeAt = null;
        if (!post || event.target.closest('.post') !== post) return;

        // a post that can't be liked (your own, or when logged out) has a plain <span> with no
        // data-ajax, so there's nothing to click and no thumb to show
        const likeButton = post.querySelector('.postlove-button[data-ajax]');
        if (!likeButton) return;

        // the forum's like button toggles, so a double-click on a liked post takes the like back
        const unliking = !!likeButton.querySelector('.liked');
        likeButton.click();
        showThumb(event.clientX, event.clientY, unliking);
    }

    // Whether the point is on the text in the element under the mouse: inside the boxes its words
    // take up on each line (the spaces between words included, the empty space after a line not),
    // which is where the browser shows the text cursor
    function isOverText(element, x, y) {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const range = document.createRange();
        while (walker.nextNode()) {
            const text = walker.currentNode;
            if (!text.data.trim()) continue;
            range.selectNodeContents(text);
            for (const rect of range.getClientRects()) {
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
            }
        }
        return false;
    }

    function showThumb(x, y, unliking) {
        const thumb = document.createElement('span');
        thumb.className = 'ih-double-click-like' + (unliking ? ' ih-double-click-unlike' : '');
        thumb.textContent = '👍';
        thumb.style.left = x + 'px';
        thumb.style.top = y + 'px';
        thumb.addEventListener('animationend', () => thumb.remove());
        document.body.appendChild(thumb);
    }

    init();
})();
