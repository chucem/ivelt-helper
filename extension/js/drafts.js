(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const SETTING_KEY = 'keepDrafts';
    const PREFIX = 'draft:'; // kept two weeks, background.js drops older ones
    const SAVE_DELAY_MS = 800;
    const KEY_PARAMS = ['i', 'mode', 'action', 'f', 't', 'p', 'u'];
    const ATTACHMENT_FIELD = /^attachment_data\[(\d+)\]\[(\w+)\]$/;
    const ATTACHMENT_TAG = /\[attachment=(\d+)\]([\s\S]*?)\[\/attachment\]/g;
    // the files that couldn't come back, shown again after the preview that restores the others
    const MISSING_KEY = 'ih-draft-missing';

    function init() {
        const textarea = document.querySelector('#message-box textarea');
        const form = textarea && textarea.closest('form');
        if (!form || !chrome.storage || !chrome.storage.local) return;

        const key = draftKey(form);
        chrome.storage.local.get([SETTING_KEY, key], (items) => {
            if (items[SETTING_KEY] === false) return;

            dropOldDrafts();
            showMissingAfterPreview(textarea);
            keepDraft(textarea, form, key, items[key]);
        });
    }

    function keepDraft(textarea, form, key, draft) {
        let offered = !!draft && draft.text.trim() !== textarea.value.trim();
        if (offered) offerDraft(textarea, form, key, draft, () => { offered = false; });

        let saveTimeout;
        let typed = false;
        const save = () => {
            clearTimeout(saveTimeout);
            if (offered && !typed) return;
            const text = textarea.value;
            const attachments = formAttachments(form);
            store(key, text.trim() ? { text, attachments, savedAt: Date.now() } : null);
        };
        const saveSoon = () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(save, SAVE_DELAY_MS);
        };

        textarea.addEventListener('input', () => {
            typed = true;
            saveSoon();
        });
        // a file added or removed changes the hidden attachment fields, not the text
        const fileList = document.getElementById('file-list');
        if (fileList) new MutationObserver(saveSoon).observe(fileList, { childList: true, subtree: true });
        window.addEventListener('pagehide', save);
        form.addEventListener('submit', (event) => {
            if (event.submitter && event.submitter.name !== 'post') {
                save();
                return;
            }
            clearTimeout(saveTimeout);
            window.removeEventListener('pagehide', save);
            store(key, null);
        });
    }

    function draftKey(form) {
        const address = new URL(form.getAttribute('action') || '', location.href);
        if (address.searchParams.has('t') || address.searchParams.has('p')) address.searchParams.delete('f');
        const parts = KEY_PARAMS
            .filter((name) => address.searchParams.has(name))
            .map((name) => name + '=' + address.searchParams.get(name));
        return PREFIX + address.pathname.split('/').pop() + '?' + parts.join('&');
    }

    function offerDraft(textarea, form, key, draft, answered) {
        const bar = document.createElement('div');
        bar.className = 'ih-draft-bar';
        bar.innerHTML = `
            <i class="icon fa-history fa-fw ih-draft-icon" aria-hidden="true"></i>
            <span class="ih-draft-text"><span class="ih-draft-when"></span><span class="ih-draft-words"></span></span>
            <button type="button" class="button ih-draft-restore">צוריקשטעלן</button>
            <button type="button" class="button button-secondary ih-draft-drop">אויסמעקן</button>`;
        bar.querySelector('.ih-draft-when').textContent = 'א נישט-געשיקטע תגובה פון ' + timeAgo(draft.savedAt);
        bar.querySelector('.ih-draft-words').textContent = firstWords(draft.text);

        const restoreButton = bar.querySelector('.ih-draft-restore');
        restoreButton.addEventListener('click', () => {
            answered();
            restoreButton.disabled = true;
            restoreDraft(textarea, form, draft).then(() => bar.remove());
        });
        bar.querySelector('.ih-draft-drop').addEventListener('click', () => {
            answered();
            store(key, null);
            bar.remove();
        });

        textarea.before(bar);
    }

    // The text comes back with its attachments: the files uploaded for it stay on the forum until
    // the post is sent, so their hidden fields are put back. A preview then lets phpBB list them and
    // keep its uploader in step. A file that's gone would make phpBB refuse the whole form, so each
    // one is checked first, and the ones that are gone are listed for the user to add again
    async function restoreDraft(textarea, form, draft) {
        const current = formAttachments(form);
        const saved = draft.attachments || [];
        const back = [];
        const missing = [];

        for (const file of saved) {
            if (current.some((c) => c.attach_id === file.attach_id)) continue;
            if (await fileExists(file.attach_id)) back.push(file);
            else missing.push(file.real_filename);
        }

        const all = current.concat(back);
        const text = draft.text.replace(ATTACHMENT_TAG, (tag, index, name) => {
            // older drafts kept no attachment list, so their tags are matched by the file name
            const file = saved[index] || current.find((c) => c.real_filename === name);
            const newIndex = file ? all.findIndex((a) => a.attach_id === file.attach_id) : -1;
            if (newIndex === -1) {
                if (!missing.includes(name)) missing.push(name);
                return '';
            }
            return `[attachment=${newIndex}]${name}[/attachment]`;
        });

        textarea.value = text;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));

        if (!back.length) {
            if (missing.length) showMissing(textarea, missing);
            return;
        }

        back.forEach((file, i) => addAttachmentFields(form, current.length + i, file));
        try {
            if (missing.length) sessionStorage.setItem(MISSING_KEY, JSON.stringify(missing));
        } catch (e) {}
        const preview = form.querySelector('input[name="preview"]');
        if (preview) form.requestSubmit(preview);
    }

    function formAttachments(form) {
        const files = [];
        form.querySelectorAll('input[name^="attachment_data["]').forEach((input) => {
            const match = input.name.match(ATTACHMENT_FIELD);
            if (!match) return;
            const file = files[match[1]] || (files[match[1]] = {});
            file[match[2]] = input.value;
        });
        return files.filter((file) => file && file.attach_id);
    }

    function addAttachmentFields(form, index, file) {
        Object.keys(file).forEach((field) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = `attachment_data[${index}][${field}]`;
            input.value = file[field];
            form.appendChild(input);
        });
    }

    // the forum serves a file uploaded for an unsent post only to its owner, and refuses one that's gone
    async function fileExists(attachId) {
        const controller = new AbortController();
        try {
            const response = await fetch(new URL('./download/file.php?id=' + encodeURIComponent(attachId), location.href), {
                credentials: 'same-origin',
                signal: controller.signal
            });
            return response.ok;
        } catch (e) {
            return false;
        } finally {
            controller.abort(); // only the answer is needed, not the file
        }
    }

    function showMissingAfterPreview(textarea) {
        let missing;
        try {
            missing = JSON.parse(sessionStorage.getItem(MISSING_KEY) || 'null');
            sessionStorage.removeItem(MISSING_KEY);
        } catch (e) {}
        if (missing && missing.length) showMissing(textarea, missing);
    }

    function showMissing(textarea, names) {
        const bar = document.createElement('div');
        bar.className = 'ih-draft-bar ih-draft-missing';
        bar.innerHTML = `
            <i class="icon fa-paperclip fa-fw ih-draft-icon" aria-hidden="true"></i>
            <span class="ih-draft-text">די עטעטשמענטס זענען שוין נישט דא, לייגט זיי צו נאכאמאל:<span class="ih-draft-words"></span></span>
            <button type="button" class="button button-secondary ih-draft-drop">אקעי</button>`;
        bar.querySelector('.ih-draft-words').textContent = names.join(', ');
        bar.querySelector('.ih-draft-drop').addEventListener('click', () => bar.remove());
        textarea.before(bar);
    }

    function timeAgo(savedAt) {
        const minutes = Math.round((Date.now() - savedAt) / 60000);
        if (minutes < 1) return 'פאר א רגע';
        if (minutes < 60) return `פאר ${minutes} מינוט`;
        const hours = Math.round(minutes / 60);
        if (hours < 24) return `פאר ${hours} שעה`;
        const days = Math.round(hours / 24);
        return days === 1 ? 'פאר א טאג' : `פאר ${days} טעג`;
    }

    function firstWords(text) {
        return text.replace(/\[[^\]]*\]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, 300);
    }

    // The background does it: finding the drafts means reading all of the extension's storage, which
    // has the saved accounts' sign-in cookies (background.accounts.js), and those stay out of the forum's pages
    function dropOldDrafts() {
        try {
            chrome.runtime.sendMessage({ type: 'dropOldDrafts' });
        } catch (e) {}
    }

    function store(key, draft) {
        try {
            if (draft) chrome.storage.local.set({ [key]: draft });
            else chrome.storage.local.remove(key);
        } catch (e) {}
    }

    init();
})();
