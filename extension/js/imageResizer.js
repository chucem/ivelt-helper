// Image Resizer
//
// Hooks into the post editor's own attachment flow, so an image that is too big for
// the forum (or in a format it doesn't take) is shrunk before it is uploaded - no
// matter how it arrives:
//   - picked with the forum's own "add file" button
//   - dropped on the editor or on the attachments tab
//   - pasted straight into the post, like in Gmail: the image is attached and placed
//     inline at the spot it was pasted
// A dropped folder, or one picked with the "Folder → ZIP" button next to the forum's
// "add file" button, is packed into a single ZIP attachment. Everything runs locally
// in the browser - no file ever leaves the page except through the forum's own upload.
//
// Runs as a content script (isolated world) and is controlled by two settings,
// which can be switched on and off without a reload:
//   "imageResizer" - the automatic shrinking, the ZIP offer and Folder -> ZIP
//   "pasteImages"  - pasting images into the post
// A third one, "openAttachmentsTab", opens the attachments tab instead of the
// options tab when the editor loads, so "add file" is right there.

(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const RESIZE_KEY = 'imageResizer';
    const PASTE_KEY = 'pasteImages';
    const ATTACH_TAB_KEY = 'openAttachmentsTab';

    const MAX_ATTACHMENTS = 3;
    const MAX_BYTES = 399 * 1024;          // the image attachment limit (400 KB), just under it
    const ZIP_MAX_BYTES = 250 * 1024;      // archives have a lower limit (256 KB)
    const ZIP_SOURCE_LIMIT = 100 * 1024 * 1024; // refuse folders bigger than this - they can never fit anyway
    const ZIP_MIN_IMAGE_BYTES = 20 * 1024;  // never squeeze a single image below this inside a ZIP
    const ZIP_MAX_IMAGE_BYTES = 400 * 1024;
    // Shrinking keeps as much of the image as fits: the largest of these sizes
    // (longest side, px) at the best quality that fits under the limit
    const PNG_SIZES = [2560, 2048, 1800, 1600];
    const JPEG_SIZES = [2560, 2048, 1800, 1600, 1440, 1280, 1024, 800, 640, 480];
    const JPEG_TOP_QUALITY = 0.92;
    const JPEG_GOOD_QUALITY = 0.7;
    const JPEG_LOWEST_QUALITY = 0.4;
    const HOLD_STATUS_MS = 4000;
    const INPUT_WAIT_MS = 3000;            // how long the forum may take to build its uploader
    const ROW_WAIT_MS = 15 * 1000;         // a file that never shows up in the list was refused
    const UPLOAD_WAIT_MS = 3 * 60 * 1000;

    // Formats the forum accepts as they are. Anything else has to be converted;
    // anything on this list is only touched when it is over the size limit.
    const FORUM_SAFE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
    const SKIP_NAMES = ['.ds_store', 'thumbs.db', 'desktop.ini'];
    const SKIP_FOLDERS = ['__macosx'];

    let hooks = null;
    const enabled = { resize: false, paste: false };

    // ---------------------------------------------------------------------
    // Setting handling: each part is on unless the user explicitly turned it off
    // ---------------------------------------------------------------------

    function init() {
        if (!chrome.storage || !chrome.storage.local) return;

        chrome.storage.local.get([RESIZE_KEY, PASTE_KEY, ATTACH_TAB_KEY], (items) => {
            enabled.resize = items[RESIZE_KEY] !== false;
            enabled.paste = items[PASTE_KEY] !== false;
            if (items[ATTACH_TAB_KEY] !== false) openAttachmentsTab();
            apply();
        });

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || (!changes[RESIZE_KEY] && !changes[PASTE_KEY])) return;
            if (changes[RESIZE_KEY]) enabled.resize = changes[RESIZE_KEY].newValue !== false;
            if (changes[PASTE_KEY]) enabled.paste = changes[PASTE_KEY].newValue !== false;
            apply();
        });
    }

    function apply() {
        if (!enabled.resize && !enabled.paste) {
            unmount();
            return;
        }
        if (!hooks && getTextarea()) hooks = createHooks();
        if (hooks) hooks.refresh();
    }

    function unmount() {
        if (!hooks) return;
        hooks.destroy();
        hooks = null;
    }

    // Only when the page loads - flipping the setting later shouldn't switch tabs under the user
    function openAttachmentsTab() {
        const tab = document.querySelector('a[data-subpanel="attach-panel"]');
        if (tab && !tab.closest('.activetab')) tab.click();
    }

    // ---------------------------------------------------------------------
    // Small helpers
    // ---------------------------------------------------------------------

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getTextarea() {
        return document.getElementById('message') || document.querySelector('textarea[name="message"]');
    }

    // The forum's uploader (plupload) puts its own hidden file input over the "add file"
    // button, but only once the attachments tab has been opened
    function findAttachmentInput() {
        return document.querySelector('#attach-panel-multi .moxie-shim input[type="file"]') ||
            document.querySelector('.moxie-shim input[type="file"]');
    }

    function isAttachmentInput(node) {
        return node instanceof HTMLInputElement && node.type === 'file' && !!node.closest('.moxie-shim');
    }

    function attachmentRows() {
        return Array.from(document.querySelectorAll('#file-list .attach-row'));
    }

    // Rows that don't carry an error are attached or still uploading
    function getAttachedFilesCount() {
        return attachmentRows().filter(row => !row.querySelector('.file-error')).length;
    }

    function slotsLeft() {
        return Math.max(0, MAX_ATTACHMENTS - getAttachedFilesCount());
    }

    function isImageFile(file) {
        return (file.type || '').startsWith('image/') || (!file.type && IMAGE_EXTENSION.test(file.name));
    }

    function hasFiles(event) {
        return !!event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
    }

    function plural(n, one, many) {
        return n + ' ' + (n === 1 ? one : many);
    }

    // A pasted screenshot is always called "image.png" - give it a name that can
    // be told apart in the attachment list and inside the post
    function pastedName(file, index) {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
        const ext = ((file.type || '').split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
        return `pasted-${stamp}${index ? '-' + (index + 1) : ''}.${ext}`;
    }

    // ---------------------------------------------------------------------
    // Hooks into the post editor
    // ---------------------------------------------------------------------

    function createHooks() {
        const cleanups = [];
        const textarea = getTextarea();

        let busy = false;
        let passThrough = false;   // set while we hand our own files to the forum's uploader
        let statusTimer = null;

        // --- Status line under the editor ---
        const status = el('div', 'ivr-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        textarea.insertAdjacentElement('afterend', status);

        function showStatus(text, kind, holdMs) {
            clearTimeout(statusTimer);
            status.textContent = text || '';
            status.className = 'ivr-status' + (text ? ' ivr-show' : '') + (kind ? ' ivr-' + kind : '');
            if (text && holdMs) {
                statusTimer = setTimeout(() => showStatus(''), holdMs);
            }
        }

        function on(target, type, handler, capture) {
            target.addEventListener(type, handler, capture);
            cleanups.push(() => target.removeEventListener(type, handler, capture));
        }

        const fullMessage = `עס מעג זיין מאקסימום ${MAX_ATTACHMENTS} אטעטשמענטס. מעקט אויס איינס איידער איר לייגט צו נאך.`;

        // Opens the attachments tab when the uploader isn't there yet, and waits for it
        async function ensureAttachmentInput() {
            let input = findAttachmentInput();
            if (input) return input;

            const tab = document.querySelector('a[data-subpanel="attach-panel"]');
            if (tab) tab.click();

            const until = Date.now() + INPUT_WAIT_MS;
            while (!(input = findAttachmentInput()) && Date.now() < until) await delay(100);
            if (!input) throw new Error('קען נישט געפינען וואו מען לייגט צו אטעטשמענטס.');
            return input;
        }

        // Hand files to the forum's uploader as if the user had picked them there
        function attach(files, input) {
            const dt = new DataTransfer();
            files.forEach(f => dt.items.add(f));
            input.files = dt.files;
            passThrough = true;
            try {
                input.dispatchEvent(new Event('change', { bubbles: true }));
            } finally {
                passThrough = false;
            }
        }

        // Shrinks whatever needs it and attaches everything. Files that aren't images are
        // passed on untouched - the forum decides about those. With the resizer turned
        // off (only pasting is on) nothing is shrunk or zipped, just attached.
        // Returns a Map from each original file to what was attached for it
        // (missing = skipped or unreadable).
        async function processAndAttach(fileList) {
            const resize = enabled.resize;
            const result = new Map();
            if (busy) {
                showStatus('⏳ ווארט ביז די פריערדיגע בילדער זענען גרייט…', 'warn', HOLD_STATUS_MS);
                return result;
            }

            let files = Array.from(fileList);
            const slots = slotsLeft();
            if (slots === 0) {
                showStatus(fullMessage, 'error', HOLD_STATUS_MS * 2);
                return result;
            }

            // More files than the forum lets us attach - offer to pack them all into one ZIP.
            // The dialog picks each line's direction from its first letter, so every line
            // has to start with Yiddish - a line starting with "OK" comes out scrambled.
            if (resize && files.length > slots) {
                const zip = confirm(
                    `איר האט אויסגעקליבן ${files.length} פיילס, אבער עס איז נאר דא פלאץ פאר ${plural(slots, 'אטעטשמענט', 'אטעטשמענטס')}.\n\n` +
                    `• דרוקט OK צו לייגן זיי אלע אריין אין איין ZIP פייל (די בילדער ווערן פארקלענערט אז עס זאל אריינפאסן)\n` +
                    `• דרוקט Cancel צו צולייגן נאר די ערשטע ${slots}`
                );
                if (zip) {
                    await zipAndAttach(files.map(f => ({ path: f.name, file: f })), 'files-' + new Date().toLocaleDateString('sv'));
                    return result;
                }
            }

            let note = '';
            if (files.length > slots) {
                note = `עס איז נאר געווען פלאץ פאר ${slots}. `;
                files = files.slice(0, slots);
            }

            // An oversized animated image can only be shrunk by flattening it to a
            // still, so let the user decide before the animation is destroyed
            const animated = [];
            for (const file of resize ? files : []) {
                if (isImageFile(file) && needsWork(file, MAX_BYTES) && await isAnimated(file)) animated.push(file);
            }
            if (animated.length) {
                const ok = confirm(
                    `${plural(animated.length, 'רוקעדיגע בילד (GIF) איז', 'רוקעדיגע בילדער (GIF) זענען')} צו גרויס, אדער אין א פארמאט וואס דער פארום נעמט נישט.\n\n` +
                    `נאכן פארקלענערן רוקט עס זיך מער נישט.\n\n` +
                    `פארקלענערן סיי ווי? (Cancel לאזט עס אויס)`
                );
                if (!ok) files = files.filter(f => !animated.includes(f));
            }

            const work = resize ? files.filter(f => isImageFile(f) && needsWork(f, MAX_BYTES)) : [];
            const failed = [];
            const stillTooBig = [];
            busy = true;

            try {
                let n = 0;
                for (const file of files) {
                    if (!work.includes(file)) {
                        result.set(file, file);
                        continue;
                    }
                    n++;
                    showStatus(`⏳ פארקלענערט ${work.length > 1 ? `בילד ${n} פון ${work.length}` : 'דאס בילד'}…`);
                    try {
                        const prepared = await prepareForUpload(file);
                        if (prepared.size > MAX_BYTES) stillTooBig.push(prepared.name);
                        result.set(file, prepared);
                    } catch (err) {
                        console.warn('Image Resizer: could not process ' + file.name, err);
                        failed.push(file.name);
                    }
                }

                if (result.size) attach(Array.from(result.values()), await ensureAttachmentInput());
            } catch (err) {
                console.error(err);
                showStatus('❌ ' + err.message, 'error', HOLD_STATUS_MS * 2);
                result.clear();
                return result;
            } finally {
                busy = false;
            }

            const problems = [];
            if (failed.length) problems.push('קען נישט עפענען: ' + failed.join(', '));
            if (stillTooBig.length) problems.push(`נאך אלץ גרעסער פון ${formatSize(MAX_BYTES)}: ` + stillTooBig.join(', '));

            if (problems.length) {
                showStatus('⚠️ ' + note + problems.join('; '), 'warn', HOLD_STATUS_MS * 3);
            } else if (work.length) {
                const shrunk = work.filter(f => result.has(f)).map(f => formatSize(result.get(f).size));
                showStatus(`✅ ${note}${plural(shrunk.length, 'בילד', 'בילדער')} פארקלענערט (${shrunk.join(', ')})`, 'ok', HOLD_STATUS_MS);
            } else if (note) {
                showStatus('⚠️ ' + note, 'warn', HOLD_STATUS_MS);
            }
            return result;
        }

        // --- The forum's own "add file" button ---
        // Catch the pick before the uploader sees it. Picks that need no work go
        // straight through untouched.
        on(document, 'change', (e) => {
            const input = e.target;
            if (passThrough || !enabled.resize || !isAttachmentInput(input)) return;
            const files = Array.from(input.files || []);
            const tooMany = files.length > slotsLeft();
            if (!tooMany && !files.some(f => isImageFile(f) && needsWork(f, MAX_BYTES))) return;

            e.stopImmediatePropagation();
            processAndAttach(files);
        }, true);

        // --- Paste, like in Gmail ---
        // The image is attached, and a placeholder holds its spot in the post until the
        // upload is done; then the forum's own "place inline" puts it right there.
        on(document, 'paste', (e) => {
            if (!enabled.paste || e.target !== textarea || !e.clipboardData) return;
            const images = Array.from(e.clipboardData.files || []).filter(isImageFile);
            if (!images.length) return;

            e.preventDefault();
            e.stopPropagation();
            pasteImages(images);
        }, true);

        async function pasteImages(images) {
            if (busy) {
                showStatus('⏳ ווארט ביז די פריערדיגע בילדער זענען גרייט…', 'warn', HOLD_STATUS_MS);
                return;
            }
            if (slotsLeft() === 0) {
                showStatus(fullMessage, 'error', HOLD_STATUS_MS * 2);
                return;
            }

            const pasted = images.map((file, i) => {
                const named = new File([file], pastedName(file, images.length > 1 ? i : 0), { type: file.type, lastModified: Date.now() });
                return { file: named, marker: `[⏳ ${named.name}]` };
            });
            insertAtCursor(pasted.map(p => p.marker).join('\n'));

            const before = new Set(attachmentRows());
            const attached = await processAndAttach(pasted.map(p => p.file));

            await Promise.all(pasted.map(async (p) => {
                const file = attached.get(p.file);
                if (!file) {
                    removeMarker(p.marker);
                    return;
                }
                try {
                    const row = await waitForUpload(file.name, before);
                    if (!placeInline(row, p.marker)) removeMarker(p.marker);
                } catch (err) {
                    removeMarker(p.marker);
                    showStatus(`❌ ${file.name}: ${err.message}`, 'error', HOLD_STATUS_MS * 2);
                }
            }));
        }

        // Like typing it: replaces the selection and keeps the undo history
        function insertAtCursor(text) {
            textarea.focus();
            if (!document.execCommand('insertText', false, text)) {
                textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
            }
        }

        // Swaps a stretch of the post for other text, keeping the user's caret and
        // scroll position where they were
        function replaceRange(start, end, apply) {
            const active = document.activeElement;
            const selStart = textarea.selectionStart;
            const selEnd = textarea.selectionEnd;
            const scrollTop = textarea.scrollTop;
            const lengthBefore = textarea.value.length;

            apply();

            const shift = textarea.value.length - lengthBefore;
            const moved = pos => pos <= start ? pos : pos >= end ? pos + shift : end + shift;
            if (active && active !== textarea && active.focus) active.focus();
            textarea.setSelectionRange(moved(selStart), moved(selEnd));
            textarea.scrollTop = scrollTop;
        }

        function removeMarker(marker) {
            const at = textarea.value.indexOf(marker);
            if (at === -1) return;
            replaceRange(at, at + marker.length, () => {
                textarea.value = textarea.value.slice(0, at) + textarea.value.slice(at + marker.length);
            });
        }

        // The forum numbers inline attachments itself (and renumbers them when one is
        // deleted), so let its own "place inline" button write the BBCode
        function placeInline(row, marker) {
            const button = row.querySelector('.file-inline-bbcode');
            const at = textarea.value.indexOf(marker);
            if (!button || at === -1) return false;

            replaceRange(at, at + marker.length, () => {
                textarea.value = textarea.value.slice(0, at) + textarea.value.slice(at + marker.length);
                textarea.setSelectionRange(at, at);
                button.click();
            });
            return true;
        }

        // Find the new row for this file and wait for its upload to end
        async function waitForUpload(name, before) {
            const started = Date.now();
            while (Date.now() - started < UPLOAD_WAIT_MS) {
                const row = attachmentRows().find(r => !before.has(r) &&
                    (r.querySelector('.file-name') || r).textContent.trim() === name);

                if (!row && Date.now() - started > ROW_WAIT_MS) {
                    throw new Error('דער פארום האט נישט אנגענומען דעם פייל.');
                }
                if (row) {
                    const fileStatus = row.querySelector('.file-status');
                    if (fileStatus && fileStatus.classList.contains('file-error')) {
                        throw new Error(fileStatus.title || 'עס איז נישט ארויפגעגאנגען.');
                    }
                    if (row.getAttribute('data-attach-id') || (fileStatus && fileStatus.classList.contains('file-uploaded'))) {
                        return row;
                    }
                }
                await delay(300);
            }
            throw new Error('עס האט צו לאנג גענומען.');
        }

        // --- Drag and drop ---
        // Files dropped on the editor or the attachments tab are attached; anywhere else
        // the drop is swallowed, since the browser would otherwise navigate away from
        // the post being written.
        on(document, 'dragover', (e) => { if (enabled.resize && hasFiles(e)) e.preventDefault(); });

        on(document, 'drop', (e) => {
            if (!enabled.resize || !hasFiles(e)) return;
            e.preventDefault();

            const target = e.target instanceof Element ? e.target : null;
            if (!target || !target.closest('#message, #attach-panel')) return;
            e.stopImmediatePropagation();
            for (const node of document.querySelectorAll('.drag-n-drop-highlight')) {
                node.classList.remove('drag-n-drop-highlight');
            }

            // The item list is only readable inside this handler, so grab the entries now
            const fsEntries = [];
            for (const item of e.dataTransfer.items || []) {
                if (item.kind !== 'file' || !item.webkitGetAsEntry) continue;
                const entry = item.webkitGetAsEntry();
                if (entry) fsEntries.push(entry);
            }

            if (fsEntries.some(en => en.isDirectory)) handleDroppedEntries(fsEntries);
            else processAndAttach(e.dataTransfer.files);
        }, true);

        // --- Folder -> ZIP ---
        const folderInput = el('input');
        folderInput.type = 'file';
        folderInput.multiple = true;
        folderInput.setAttribute('webkitdirectory', '');
        folderInput.hidden = true;
        document.body.append(folderInput);

        const zipButton = el('input', 'button2 ivr-zip');
        zipButton.type = 'button';
        // The page is right-to-left, so the arrow has to point left to read "folder to ZIP"
        zipButton.value = '🗂️ פאלדער ← ZIP';
        zipButton.title = 'קלייבט אויס א פאלדער, און ער ווערט צוגעלייגט אלס איין ZIP פייל';

        // Without the old floating button nothing shows that big images are fine to add,
        // so say so right after the forum's own "...ביז: 400 KiB." line. The limit itself
        // stays: it still applies to every file that isn't an image.
        const resizeHint = el('span', 'ivr-hint', '📷 גרעסערע בילדער ווערן אויטאמאטיש פארקלענערט');

        // The forum's size-limit paragraph ("...ביז: 400 KiB.") is the last one before
        // the row of attachment buttons. (The basic upload form sits in between until
        // the forum's uploader starts and removes it, so skip anything that isn't a <p>.)
        function findLimitLine() {
            let node = document.getElementById('attach-panel-multi');
            while (node && (node = node.previousElementSibling)) {
                if (node.tagName === 'P') return node;
            }
            return null;
        }

        function placeZipButton() {
            const addFiles = document.getElementById('add_files');
            if (!addFiles || zipButton.isConnected) return !!addFiles;
            addFiles.insertAdjacentElement('afterend', zipButton);
            const limitLine = findLimitLine();
            if (limitLine) limitLine.append(' ', resizeHint);
            else zipButton.insertAdjacentElement('afterend', resizeHint);
            return true;
        }

        if (!placeZipButton()) {
            const observer = new MutationObserver(() => { if (placeZipButton()) observer.disconnect(); });
            observer.observe(document.body, { childList: true, subtree: true });
            cleanups.push(() => observer.disconnect());
        }

        zipButton.addEventListener('click', () => {
            if (busy) return;
            if (slotsLeft() === 0) {
                showStatus(fullMessage, 'error', HOLD_STATUS_MS * 2);
                return;
            }
            folderInput.value = '';
            folderInput.click();
        });

        function isSkipped(path) {
            const parts = path.toLowerCase().split('/');
            return SKIP_NAMES.includes(parts[parts.length - 1]) || parts.some(p => SKIP_FOLDERS.includes(p));
        }

        // Files picked through the folder input already carry webkitRelativePath
        folderInput.addEventListener('change', () => {
            const picked = Array.from(folderInput.files || []);
            if (!picked.length) return;

            const entries = picked
                .map(f => ({ path: f.webkitRelativePath || f.name, file: f }))
                .filter(e => !isSkipped(e.path));

            const first = entries[0];
            const root = first && first.path.includes('/') ? first.path.split('/')[0] : 'files';
            zipAndAttach(stripCommonRoot(entries), root);
        });

        // Dropping a real folder gives us filesystem entries instead of files
        async function handleDroppedEntries(fsEntries) {
            if (busy) return;
            const collected = [];

            busy = true;
            showStatus('⏳ ליינט דעם פאלדער…');
            try {
                for (const entry of fsEntries) {
                    await readEntryRecursive(entry, '', collected);
                }
            } catch (err) {
                console.error(err);
                showStatus('❌ קען נישט ליינען דעם פאלדער: ' + err.message, 'error', HOLD_STATUS_MS * 2);
                return;
            } finally {
                busy = false;
            }
            showStatus('');

            const usable = collected.filter(e => !isSkipped(e.path));
            const dir = fsEntries.find(e => e.isDirectory);
            zipAndAttach(stripCommonRoot(usable), dir ? dir.name : 'files');
        }

        async function zipAndAttach(entries, zipBaseName) {
            if (busy) return;

            if (slotsLeft() === 0) {
                showStatus(fullMessage, 'error', HOLD_STATUS_MS * 2);
                return;
            }
            if (!entries.length) {
                showStatus('דער פאלדער איז ליידיג.', 'warn', HOLD_STATUS_MS);
                return;
            }

            const sourceBytes = entries.reduce((sum, e) => sum + e.file.size, 0);
            if (sourceBytes > ZIP_SOURCE_LIMIT) {
                showStatus(`דער פאלדער איז ${formatSize(sourceBytes)} - פיל צו גרויס פאר איין אטעטשמענט.`, 'error', HOLD_STATUS_MS * 2);
                return;
            }

            busy = true;
            try {
                let list = entries;

                // Only touch the images when the archive would not fit as it is
                if (sourceBytes > ZIP_MAX_BYTES) {
                    list = await shrinkEntriesForZip(list, ZIP_MAX_BYTES, (n, total) => showStatus(`⏳ פארקלענערט בילד ${n} פון ${total}…`));
                }

                const blob = await buildZip(list, (done, total) => showStatus(`🗂️ מאכט ZIP ${done}/${total}…`));

                const zipFile = new File([blob], sanitizeName(zipBaseName) + '.zip', {
                    type: 'application/zip',
                    lastModified: Date.now()
                });

                if (zipFile.size > ZIP_MAX_BYTES) {
                    showStatus('');
                    const ok = confirm(
                        `דער ZIP איז ${formatSize(zipFile.size)} (${plural(list.length, 'פייל', 'פיילס')}).\n\n` +
                        `אייוועלט נעמט געווענליך נישט אן ZIP פיילס גרעסער פון ${formatSize(256 * 1024)}, און עס קען זיין אז עס וועט נישט ארויפגיין.\n\n` +
                        `צולייגן סיי ווי?`
                    );
                    if (!ok) return;
                }

                attach([zipFile], await ensureAttachmentInput());
                showStatus(`✅ ZIP פון ${formatSize(zipFile.size)} צוגעלייגט`, 'ok', HOLD_STATUS_MS);
            } catch (err) {
                console.error(err);
                showStatus('❌ קען נישט מאכן דעם ZIP: ' + err.message, 'error', HOLD_STATUS_MS * 2);
            } finally {
                busy = false;
            }
        }

        return {
            // Folder -> ZIP and the hint belong to the resizer, so they only show while that is on
            refresh() {
                zipButton.hidden = !enabled.resize;
                resizeHint.hidden = !enabled.resize;
            },
            destroy() {
                clearTimeout(statusTimer);
                cleanups.forEach(fn => fn());
                status.remove();
                zipButton.remove();
                resizeHint.remove();
                folderInput.remove();
            }
        };
    }

    // ---------------------------------------------------------------------
    // Image handling
    //
    // A file is only touched when the forum would actually refuse it: an unknown
    // format, or a file over the size limit. A small PNG or GIF is attached exactly
    // as it is - no needless re-encoding, no lost transparency, no lost animation.
    // ---------------------------------------------------------------------

    function isForumSafe(file) {
        return FORUM_SAFE_TYPES.includes((file.type || '').toLowerCase());
    }

    function needsWork(file, maxBytes) {
        return !isForumSafe(file) || file.size > maxBytes;
    }

    // A GIF holds one graphic control block per frame - two of them means animation;
    // an animated WebP carries an ANIM chunk in its header
    async function isAnimated(file) {
        const type = (file.type || '').toLowerCase();
        try {
            if (type === 'image/gif') {
                const bytes = new Uint8Array(await file.arrayBuffer());
                let frames = 0;
                for (let i = 0; i < bytes.length - 3; i++) {
                    if (bytes[i] === 0x21 && bytes[i + 1] === 0xF9 && bytes[i + 2] === 0x04 && ++frames > 1) return true;
                }
            } else if (type === 'image/webp') {
                const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
                const text = String.fromCharCode(...head);
                return text.includes('ANIM');
            }
        } catch (e) {
            console.warn('Image Resizer: could not inspect ' + file.name, e);
        }
        return false;
    }

    // Decode without a detour through a base64 data URL
    async function decodeImage(file) {
        if (typeof createImageBitmap === 'function') {
            try {
                return { source: await createImageBitmap(file), release() { this.source.close(); } };
            } catch (e) {
                // fall through to the <img> route
            }
        }

        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => resolve(image);
                image.onerror = () => reject(new Error('Could not open ' + file.name + ' as an image'));
                image.src = url;
            });
            return { source: img, release() {} };
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    // Draw onto a canvas whose longest side is at most `max` (never enlarges)
    function drawScaled(source, max, opaque) {
        let w = source.width, h = source.height;
        const longest = Math.max(w, h);
        if (longest > max) {
            const ratio = max / longest;
            w = Math.max(1, Math.round(w * ratio));
            h = Math.max(1, Math.round(h * ratio));
        }

        const cvs = document.createElement('canvas');
        cvs.width = w;
        cvs.height = h;
        const ctx = cvs.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // JPG has no alpha channel, so transparent areas need a white backdrop
        if (opaque) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(source, 0, 0, w, h);
        return cvs;
    }

    function canvasToBlob(cvs, type, quality) {
        return new Promise(resolve => cvs.toBlob(resolve, type, quality));
    }

    function freeCanvas(cvs) {
        cvs.width = 0;
        cvs.height = 0;
    }

    function withExtension(blob, originalName, ext, type) {
        const dot = originalName.lastIndexOf('.');
        const stem = dot > 0 ? originalName.substring(0, dot) : originalName;
        return new File([blob], stem + ext, { type, lastModified: Date.now() });
    }

    // Candidate sizes from `top` downwards, skipping ones that would not change anything
    function sizeLadder(longest, top, steps) {
        const first = Math.min(longest, top);
        return [first, ...steps.filter(s => s < first)];
    }

    // Best JPEG for one canvas size: the highest quality between minQuality and
    // JPEG_TOP_QUALITY that still fits. `fits` is false when even minQuality is too big.
    async function jpegAtSize(source, size, maxBytes, minQuality) {
        const cvs = drawScaled(source, size, true);
        try {
            const top = await canvasToBlob(cvs, 'image/jpeg', JPEG_TOP_QUALITY);
            if (!top) return { blob: null, fits: false };
            if (top.size <= maxBytes) return { blob: top, fits: true };

            const floor = await canvasToBlob(cvs, 'image/jpeg', minQuality);
            if (!floor) return { blob: top, fits: false };
            if (floor.size > maxBytes) return { blob: floor, fits: false };

            // somewhere in between - home in on the best quality that fits
            let best = floor, lo = minQuality, hi = JPEG_TOP_QUALITY;
            for (let i = 0; i < 5; i++) {
                const mid = (lo + hi) / 2;
                const candidate = await canvasToBlob(cvs, 'image/jpeg', mid);
                if (candidate && candidate.size <= maxBytes) { best = candidate; lo = mid; }
                else hi = mid;
            }
            return { blob: best, fits: true };
        } finally {
            freeCanvas(cvs);
        }
    }

    // Bring a file under maxBytes while keeping as much of it as fits: the largest
    // size and the highest quality the limit allows, so text in a screenshot stays
    // readable. A PNG stays PNG when that fits at (close to) full size - transparency
    // survives; otherwise we land on JPG.
    // If nothing fits, the smallest attempt is returned and the caller can tell by its size.
    async function shrinkImage(file, maxBytes) {
        const decoded = await decodeImage(file);
        try {
            const source = decoded.source;
            const longest = Math.max(source.width, source.height);

            if ((file.type || '').toLowerCase() === 'image/png') {
                for (const size of sizeLadder(longest, longest, PNG_SIZES)) {
                    const cvs = drawScaled(source, size, false);
                    const blob = await canvasToBlob(cvs, 'image/png');
                    freeCanvas(cvs);
                    if (!blob) break;
                    if (blob.size <= maxBytes) return withExtension(blob, file.name, '.png', 'image/png');
                    // a photo saved as PNG will never get close - stop wasting time on it
                    if (size === longest && blob.size > maxBytes * 3) break;
                }
            }

            // First look for the largest size that still fits at a good quality; only
            // when nothing does (a tiny budget inside a ZIP) accept a lower quality
            let smallest = null;
            for (const minQuality of [JPEG_GOOD_QUALITY, JPEG_LOWEST_QUALITY]) {
                for (const size of sizeLadder(longest, JPEG_SIZES[0], JPEG_SIZES)) {
                    const result = await jpegAtSize(source, size, maxBytes, minQuality);
                    if (result.blob && (!smallest || result.blob.size < smallest.size)) smallest = result.blob;
                    if (result.fits) return withExtension(result.blob, file.name, '.jpg', 'image/jpeg');
                }
            }

            if (!smallest) throw new Error('Could not re-encode ' + file.name);
            return withExtension(smallest, file.name, '.jpg', 'image/jpeg');
        } finally {
            decoded.release();
        }
    }

    // Convert only what the forum would not take, otherwise hand the file back untouched
    async function prepareForUpload(file) {
        if (!needsWork(file, MAX_BYTES)) return file;
        const smaller = await shrinkImage(file, MAX_BYTES);
        // never hand back something bigger than what we started with
        return (isForumSafe(file) && smaller.size >= file.size) ? file : smaller;
    }

    // Inside a ZIP the image format doesn't matter to the forum. The images share
    // whatever room the rest of the archive leaves, so a folder with two photos gets
    // more per photo than a folder with twenty.
    async function shrinkEntriesForZip(entries, maxBytes, onProgress) {
        const images = [];
        let otherBytes = 0;

        for (const item of entries) {
            if (isImageFile(item.file) && !(await isAnimated(item.file))) images.push(item);
            else otherBytes += item.file.size;
        }
        if (!images.length) return entries;

        const share = (maxBytes * 0.92 - otherBytes) / images.length;
        const budget = Math.min(ZIP_MAX_IMAGE_BYTES, Math.max(ZIP_MIN_IMAGE_BYTES, share));

        const replaced = new Map();
        let n = 0;
        for (const item of images) {
            n++;
            onProgress(n, images.length);
            if (item.file.size <= budget) continue;
            try {
                const smaller = await shrinkImage(item.file, budget);
                if (smaller.size < item.file.size) {
                    const dir = item.path.includes('/') ? item.path.substring(0, item.path.lastIndexOf('/') + 1) : '';
                    replaced.set(item, { path: dir + smaller.name, file: smaller });
                }
            } catch (e) {
                console.warn('Image Resizer: could not shrink ' + item.path + ', keeping original', e);
            }
        }

        return entries.map(item => replaced.get(item) || item);
    }

    // ---------------------------------------------------------------------
    // Folder reading + ZIP writer (no external library - everything runs locally)
    // ---------------------------------------------------------------------

    function sanitizeName(name) {
        const clean = String(name || 'files').replace(/[\\/:*?"<>|]+/g, '_').trim();
        return clean.length ? clean : 'files';
    }

    // Everything picked sits under the folder that was picked, and the ZIP already
    // carries that name - so drop the wrapper and let the archive open straight
    // onto its files. A ZIP of an extension folder is only installable that way.
    // If several items were dropped at once the roots differ and we leave them be.
    function stripCommonRoot(entries) {
        if (!entries.length) return entries;

        const slash = entries[0].path.indexOf('/');
        if (slash === -1) return entries;

        const root = entries[0].path.substring(0, slash + 1);
        if (!entries.every(e => e.path.startsWith(root))) return entries;

        return entries.map(e => ({ path: e.path.substring(root.length), file: e.file }));
    }

    // Walk a dropped FileSystemEntry tree into a flat [{ path, file }] list
    async function readEntryRecursive(entry, basePath, out) {
        if (entry.isFile) {
            const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
            out.push({ path: basePath + entry.name, file });
            return;
        }

        if (!entry.isDirectory) return;

        const reader = entry.createReader();
        const children = [];
        // readEntries hands back at most ~100 entries per call, so keep asking until it's empty
        while (true) {
            const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
            if (!batch.length) break;
            children.push(...batch);
        }

        for (const child of children) {
            await readEntryRecursive(child, basePath + entry.name + '/', out);
        }
    }

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) {
                c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            }
            table[i] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) {
            c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        }
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    async function deflateRaw(bytes) {
        if (typeof CompressionStream === 'undefined') return null;
        try {
            const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (e) {
            return null; // fall back to storing the file uncompressed
        }
    }

    function dosDateTime(ms) {
        const d = new Date(ms || Date.now());
        if (d.getFullYear() < 1980) return { time: 0, date: 33 }; // 1980-01-01
        return {
            time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
            date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
        };
    }

    // Minimal ZIP writer: deflate when it helps, store otherwise, UTF-8 file names
    async function buildZip(entries, onProgress) {
        if (entries.length > 0xFFFF) {
            throw new Error('Too many files in that folder (max 65535).');
        }

        const encoder = new TextEncoder();
        const parts = [];
        const central = [];
        const seen = new Set();
        let offset = 0;
        let done = 0;

        for (const entry of entries) {
            // Shrinking can turn a.png and a.jpg into the same a.jpg - keep names unique
            let path = entry.path;
            if (seen.has(path)) {
                const dot = path.lastIndexOf('.');
                const hasExt = dot > path.lastIndexOf('/');
                const stem = hasExt ? path.substring(0, dot) : path;
                const ext = hasExt ? path.substring(dot) : '';
                let n = 2;
                while (seen.has(stem + ' (' + n + ')' + ext)) n++;
                path = stem + ' (' + n + ')' + ext;
            }
            seen.add(path);

            const nameBytes = encoder.encode(path);
            const raw = new Uint8Array(await entry.file.arrayBuffer());
            const crc = crc32(raw);

            let method = 0;
            let data = raw;
            const deflated = await deflateRaw(raw);
            if (deflated && deflated.length < raw.length) {
                method = 8;
                data = deflated;
            }

            const { time, date } = dosDateTime(entry.file.lastModified);

            const local = new Uint8Array(30 + nameBytes.length);
            const lv = new DataView(local.buffer);
            lv.setUint32(0, 0x04034b50, true);  // local file header signature
            lv.setUint16(4, 20, true);          // version needed
            lv.setUint16(6, 0x0800, true);      // flags: UTF-8 file name
            lv.setUint16(8, method, true);
            lv.setUint16(10, time, true);
            lv.setUint16(12, date, true);
            lv.setUint32(14, crc, true);
            lv.setUint32(18, data.length, true);
            lv.setUint32(22, raw.length, true);
            lv.setUint16(26, nameBytes.length, true);
            lv.setUint16(28, 0, true);          // extra field length
            local.set(nameBytes, 30);

            parts.push(local, data);

            const cd = new Uint8Array(46 + nameBytes.length);
            const cv = new DataView(cd.buffer);
            cv.setUint32(0, 0x02014b50, true);  // central directory signature
            cv.setUint16(4, 20, true);          // version made by
            cv.setUint16(6, 20, true);          // version needed
            cv.setUint16(8, 0x0800, true);
            cv.setUint16(10, method, true);
            cv.setUint16(12, time, true);
            cv.setUint16(14, date, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, data.length, true);
            cv.setUint32(24, raw.length, true);
            cv.setUint16(28, nameBytes.length, true);
            cv.setUint32(42, offset, true);     // relative offset of local header
            cd.set(nameBytes, 46);
            central.push(cd);

            offset += local.length + data.length;
            if (offset > 0xFFFFFFFF) {
                throw new Error('That folder is too big to zip (over 4 GB).');
            }

            done++;
            if (onProgress) onProgress(done, entries.length);
        }

        const centralSize = central.reduce((sum, c) => sum + c.length, 0);
        const eocd = new Uint8Array(22);
        const ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true);      // end of central directory
        ev.setUint16(8, entries.length, true);
        ev.setUint16(10, entries.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);

        return new Blob([...parts, ...central, eocd], { type: 'application/zip' });
    }

    init();
})();
