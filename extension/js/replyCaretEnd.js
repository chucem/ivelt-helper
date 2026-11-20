// Reply with a quote: the text cursor starts after the quote, not before it.
//
// The forum fills the reply box with the quoted post but leaves the cursor at
// the very start. Anything put in before the user clicks into the box, like a
// file link from the uploader, "place inline" for an attachment, a smiley or a
// BBCode button, then lands above the quote. Moving the cursor to the end
// (without focusing the box, so the page doesn't jump) puts it after the quote.

(function () {
    'use strict';
    const textarea = document.querySelector('#message-box textarea');
    if (!textarea || !textarea.value.trim()) return;
    // the user (or the forum) already put the cursor somewhere
    if (textarea.selectionStart !== 0 || textarea.selectionEnd !== 0) return;

    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
})();
