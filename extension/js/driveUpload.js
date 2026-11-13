// Cloud Upload (Google Drive and Dropbox)
//
// Adds an upload button to the attachments panel (or, if chosen in the settings,
// to the post editor toolbar). It opens a small popup that always shows which
// account the files will go to, so nobody uploads to their own account by
// mistake; when both services are on, a switch at the top picks one. Picked
// files are uploaded (Google Drive: a folder named in the settings; Dropbox: the
// app's own folder), shared as "anyone with the link can view", and a link to
// each one is inserted into the post. When a regular attachment is rejected for
// being too big, it offers to upload that file instead.
//
// Files can also be dragged onto the button or the open popup. A video dropped on
// the post itself never reaches the forum's attachments (it could never fit): the
// popup opens with it waiting, so the service and account can be checked first.
// In a private message, where there are no attachments, dropped images go there too.
//
// Sign-in happens in the background (background.drive.js, background.dropbox.js);
// the upload itself runs here so the file never has to pass through messaging.
//
// Runs as a content script (isolated world) and is controlled by the
// "driveUpload", "dropboxUpload", "driveButtonPlace" and "cloudDropVideos"
// settings, which apply without a reload. The last service used is remembered in "cloudProvider".

(function () {
    'use strict';
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const PLACE_KEY = 'driveButtonPlace'; // 'attachments' (default) or 'toolbar'
    const PROVIDER_KEY = 'cloudProvider';  // the service picked last time
    const PMS_KEY = 'cloudUploadInPms';    // also when writing a private message
    const VIDEO_DROP_KEY = 'cloudDropVideos'; // videos dropped on the post go to the cloud
    const DRIVE_API = 'https://www.googleapis.com/drive/v3';
    const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
    const DROPBOX_API = 'https://api.dropboxapi.com/2';
    const DROPBOX_CONTENT = 'https://content.dropboxapi.com/2';
    // Uploads go up in chunks (Google wants multiples of 256 KB); a small first
    // one, so the speed is known early. After that each chunk is sized to take
    // about CHUNK_MS at the measured speed: every chunk waits for the server's
    // answer before the next one goes, so on fast internet small chunks would
    // spend much of the time waiting.
    const FIRST_CHUNK = 1024 * 1024;
    const MIN_CHUNK = 4 * 1024 * 1024;
    const MAX_CHUNK = 64 * 1024 * 1024; // well under Dropbox's 150 MB per request
    const CHUNK_PIECE = 256 * 1024;
    const CHUNK_MS = 4000;
    const STALL_MS = 60000; // nothing moving this long: the connection is gone
    const RESUME_MAX_MS = 5 * 60 * 1000; // keep trying to resume this long
    const HOLD_STATUS_MS = 4000;
    const TOO_BIG_WINDOW_MS = 30000; // how long after picking a file a failure is blamed on its size
    const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|mkv|avi|wmv|3gp|flv|mpe?g)$/i;
    const IMAGE_EXTENSION = /\.(jpe?g|png|gif|webp|bmp|avif|heic)$/i;
    const IN_PMS = /\/ucp\.php$/.test(location.pathname);

    // Single color, so it sits quietly next to the forum's own grey icons
    const DRIVE_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
        + '<path fill="currentColor" d="M7.71 3.5 1.15 15l3.43 6 6.55-11.5M9.73 15 6.3 21h13.12l3.43-6M22.28 14 15.42 2H8.58l6.85 12z"/>'
        + '</svg>';

    const DROPBOX_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
        + '<path fill="currentColor" d="M6 1.807 0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z"/>'
        + '</svg>';

    // Shown on the button when both services are on
    const CLOUD_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
        + '<path fill="currentColor" d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z"/>'
        + '</svg>';

    let widget = null;
    let enabledProviders = [];
    let place = 'attachments';
    let dropVideos = true;

    // ---------------------------------------------------------------------
    // Setting handling: on unless the user explicitly turned it off
    // ---------------------------------------------------------------------

    function init() {
        if (!chrome.storage || !chrome.storage.local) return;

        // On the private messages page (ucp.php) it also needs its own setting
        const settingKeys = [...PROVIDER_ORDER.map(key => PROVIDERS[key].settingKey), PMS_KEY, VIDEO_DROP_KEY];
        const apply = (items) => {
            enabledProviders = IN_PMS && items[PMS_KEY] === false ? []
                : PROVIDER_ORDER.filter(key => items[PROVIDERS[key].settingKey] !== false);
            place = items[PLACE_KEY] === 'toolbar' ? 'toolbar' : 'attachments';
            dropVideos = items[VIDEO_DROP_KEY] !== false;
            unmount();
            if (enabledProviders.length) mount();
        };

        chrome.storage.local.get([...settingKeys, PLACE_KEY], apply);

        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || ![...settingKeys, PLACE_KEY].some(key => changes[key])) return;
            chrome.storage.local.get([...settingKeys, PLACE_KEY], apply);
        });
    }

    function mount() {
        if (widget || !findTextarea()) return;
        widget = createWidget();
    }

    function unmount() {
        if (!widget) return;
        widget.destroy();
        widget = null;
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function findTextarea() {
        return document.querySelector('textarea[name="message"]');
    }

    // The forum uses the ABBC3 toolbar and hides phpBB's own #format-buttons,
    // so prefer the last visible ABBC3 row and only fall back to the stock toolbar
    function findToolbar() {
        // a row on a phone has no box of its own (display:contents, css/editorToolbar.css): its buttons do
        const isVisible = (node) => node && (node.getClientRects().length > 0 ||
            Array.from(node.children).some((child) => child.getClientRects().length > 0));
        const rows = Array.from(document.querySelectorAll('#abbc3_buttons .abbc3_buttons_row')).filter(isVisible);
        if (rows.length) return rows[rows.length - 1];
        const stock = document.getElementById('format-buttons');
        return isVisible(stock) ? stock : null;
    }

    // The row with phpBB's "add files" button; missing when the user can't attach here
    function findAttachButtons() {
        return document.getElementById('attach-panel-multi');
    }

    // The forum's limit as printed in the attachments panel, e.g. "... 400 KiB."
    function readAttachLimit() {
        const panel = document.getElementById('attach-panel');
        const match = panel && panel.textContent.match(/(\d+(?:[.,]\d+)?)\s*(KiB|MiB|GiB|KB|MB|GB)\b/i);
        if (!match) return null;
        const power = { k: 1, m: 2, g: 3 }[match[2][0].toLowerCase()];
        return parseFloat(match[1].replace(',', '.')) * Math.pow(1024, power);
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function formatSize(bytes) {
        if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
    }

    // Some systems leave a dragged file's type empty, so fall back to the name
    function isVideoFile(file) {
        return (file.type || '').startsWith('video/') || VIDEO_EXTENSION.test(file.name);
    }

    function isImageFile(file) {
        return (file.type || '').startsWith('image/') || IMAGE_EXTENSION.test(file.name);
    }

    // What a drop on the post sends to the cloud: videos, and in a private message
    // (no attachments there) images as well
    function isCloudFile(file) {
        return isVideoFile(file) || (IN_PMS && isImageFile(file));
    }

    function hasFiles(event) {
        return !!event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files');
    }

    function sendToBackground(type, extra) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ type, ...extra }, (response) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                if (!response || response.error) {
                    const error = new Error((response && response.error) || 'No response');
                    error.code = response && response.code;
                    return reject(error);
                }
                resolve(response);
            });
        });
    }

    // The service's own explanation, e.g. Dropbox's "path/malformed_path/" or
    // Google's "File not found", so a failure says more than just a number
    function errorDetail(text) {
        if (!text) return '';
        try {
            const body = JSON.parse(text);
            const detail = body.error_summary || (body.error && (body.error.message || body.error_description)) || body.error;
            if (typeof detail === 'string') return detail;
        } catch (err) {
            // not JSON - use the text as it is
        }
        return String(text).slice(0, 200);
    }

    function httpError(status, what, text) {
        const detail = errorDetail(text);
        const error = new Error(`${what} failed (${status})` + (detail ? ': ' + detail : ''));
        error.status = status;
        return error;
    }

    // Upload progress that follows what the server confirmed. XHR upload progress
    // counts what the browser has handed to the network, not what the server got,
    // so it reaches 100% long before the upload is done. So files go up in chunks,
    // each counted once the server answers; between answers the percent moves on
    // by the speed measured so far, so it goes up smoothly instead of waiting and
    // then jumping. It never runs past the chunk being sent, never goes back, and
    // shows 100% only when the file is there.
    // onProgress(p, waiting): waiting is true while the connection is down.
    function chunkProgress(total, onProgress) {
        const began = performance.now();
        let confirmed = 0, confirmedAt = began, rate = 0, chunkEnd = 0, shown = 0;
        let waitingSince = 0, waitedMs = 0; // time without a connection doesn't count for the speed
        const show = (bytes) => {
            const p = total ? Math.min(bytes / total, 0.99) : 0;
            if (p > shown) onProgress(shown = p, false);
        };
        const tick = setInterval(() => {
            if (!rate || waitingSince) return;
            const guess = confirmed + rate * (performance.now() - confirmedAt);
            show(Math.min(guess, confirmed + (chunkEnd - confirmed) * 0.95));
        }, 200);
        return {
            // The end of the next chunk to send, from what's confirmed so far
            next(offset) {
                let size = FIRST_CHUNK;
                if (offset) {
                    const bySpeed = Math.floor(rate * CHUNK_MS / CHUNK_PIECE) * CHUNK_PIECE;
                    size = Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, bySpeed));
                }
                chunkEnd = Math.min(offset + size, total);
                return chunkEnd;
            },
            confirm(offset) {
                confirmedAt = performance.now();
                confirmed = offset;
                rate = offset / Math.max(1, confirmedAt - began - waitedMs);
                show(offset);
            },
            waiting(on) {
                if (on === !!waitingSince) return;
                const now = performance.now();
                if (on) {
                    waitingSince = now;
                } else {
                    waitedMs += now - waitingSince;
                    waitingSince = 0;
                    confirmedAt = now; // the guess goes on from here, not from before the drop
                }
                onProgress(shown, on);
            },
            done() {
                clearInterval(tick);
                onProgress(1, false);
            },
            stop() {
                clearInterval(tick);
            }
        };
    }

    // Cancelling: the signal aborts the request that's running
    function abortError() {
        const error = new Error('Upload cancelled');
        error.name = 'AbortError';
        return error;
    }

    function networkError() {
        const error = new Error('Network error while uploading');
        error.retriable = true;
        return error;
    }

    function sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal && signal.aborted) return reject(abortError());
            const onAbort = () => {
                clearTimeout(timer);
                reject(abortError());
            };
            const timer = setTimeout(() => {
                if (signal) signal.removeEventListener('abort', onAbort);
                resolve();
            }, ms);
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    // Sends an XHR and resolves with it once the server answers (any status).
    // Rejects with an AbortError when cancelled, and with a retriable network
    // error when the connection fails or nothing moves for STALL_MS (a dropped
    // Wi-Fi can leave a request hanging without an error).
    function sendXhr(xhr, body, signal) {
        return new Promise((resolve, reject) => {
            if (signal && signal.aborted) return reject(abortError());
            let stalled = false;
            let timer = null;
            const arm = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    stalled = true;
                    xhr.abort();
                }, STALL_MS);
            };
            const onAbort = () => xhr.abort();
            xhr.upload.onprogress = arm;
            xhr.onprogress = arm;
            xhr.onload = () => resolve(xhr);
            xhr.onerror = () => reject(networkError());
            xhr.onabort = () => reject(stalled ? networkError() : abortError());
            xhr.onloadend = () => {
                clearTimeout(timer);
                if (signal) signal.removeEventListener('abort', onAbort);
            };
            if (signal) signal.addEventListener('abort', onAbort, { once: true });
            arm();
            xhr.send(body);
        });
    }

    // A failure worth trying again: no connection, or the server busy for a moment
    function isRetriable(err) {
        return !!err.retriable || err.status === 408 || err.status === 429 || err.status >= 500;
    }

    // Resuming after a dropped connection: wait() waits a little longer each time
    // (1, 2, 4… up to 30 seconds) and gives up after RESUME_MAX_MS without a
    // single success; anything that isn't a connection problem is thrown at once.
    // ok() after every success starts the count again.
    function resumer(progress, signal) {
        let failingSince = 0;
        let delay = 1000;
        return {
            async wait(err) {
                if (!isRetriable(err)) throw err;
                const now = performance.now();
                if (!failingSince) failingSince = now;
                if (now - failingSince > RESUME_MAX_MS) throw err;
                progress.waiting(true);
                await sleep(delay, signal);
                delay = Math.min(delay * 2, 30000);
            },
            ok() {
                failingSince = 0;
                delay = 1000;
                progress.waiting(false);
            }
        };
    }

    // Resumable upload: one request to create the file, then the bytes in chunks.
    // When the connection drops, it asks Google how much it has and goes on from there.
    async function uploadFile(file, token, folderId, onProgress, signal) {
        const progress = chunkProgress(file.size, onProgress);
        const retry = resumer(progress, signal);
        let sessionUrl = null;
        try {
            while (!sessionUrl) {
                try {
                    sessionUrl = await driveStartSession(file, token, folderId, signal);
                    retry.ok();
                } catch (err) {
                    await retry.wait(err);
                }
            }

            let offset = 0;
            let askFirst = false; // after a failure: how much did Google get?
            for (;;) {
                let result;
                try {
                    result = askFirst
                        ? await driveSendChunk(sessionUrl, file, offset, null, signal)
                        : await driveSendChunk(sessionUrl, file, offset, progress.next(offset), signal);
                    retry.ok();
                } catch (err) {
                    await retry.wait(err);
                    askFirst = true;
                    continue;
                }
                askFirst = false;
                if (result.done) {
                    progress.done();
                    return result.file;
                }
                offset = result.received;
                progress.confirm(offset);
            }
        } catch (err) {
            // Cancelled: tell Google to drop what it got so far
            if (err.name === 'AbortError' && sessionUrl) fetch(sessionUrl, { method: 'DELETE' }).catch(() => {});
            throw err;
        } finally {
            progress.stop();
        }
    }

    async function driveStartSession(file, token, folderId, signal) {
        let start;
        try {
            start = await fetch(`${UPLOAD_API}/files?uploadType=resumable&fields=id,name,webViewLink`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + token,
                    'Content-Type': 'application/json; charset=UTF-8',
                    'X-Upload-Content-Type': file.type || 'application/octet-stream'
                },
                body: JSON.stringify({ name: file.name, parents: [folderId] }),
                signal
            });
        } catch (err) {
            throw err.name === 'AbortError' ? abortError() : networkError();
        }
        if (!start.ok) throw httpError(start.status, 'Upload', await start.text().catch(() => ''));
        const sessionUrl = start.headers.get('Location');
        if (!sessionUrl) throw new Error('Google Drive did not return an upload address');
        return sessionUrl;
    }

    // One PUT of bytes [start, end) of the file, or with end null an empty PUT
    // that only asks how much Google has. Google answers 308 with how much it has
    // so far (Range: bytes=0-N; none means nothing yet), or 200/201 with the file
    // when it's all there.
    async function driveSendChunk(sessionUrl, file, start, end, signal) {
        const total = file.size || 0;
        const asking = end === null;
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sessionUrl);
        xhr.setRequestHeader('Content-Range', asking || !total
            ? `bytes */${total}`
            : `bytes ${start}-${end - 1}/${total}`);
        await sendXhr(xhr, asking || !total ? null : file.slice(start, end), signal);

        if (xhr.status >= 200 && xhr.status < 300) {
            return { done: true, file: JSON.parse(xhr.responseText) };
        }
        if (xhr.status === 308) {
            const header = xhr.getResponseHeader('Range');
            const range = /bytes=0-(\d+)/.exec(header || '');
            if (range) return { done: false, received: Number(range[1]) + 1 };
            // No Range: when asking, Google has nothing yet. After a chunk, Google
            // keeps whole 256 KB pieces, so an unreadable header means the whole
            // chunk is there (going by it avoids resending one forever).
            return { done: false, received: asking ? 0 : end };
        }
        throw httpError(xhr.status, 'Upload', xhr.responseText);
    }

    async function makePublic(fileId, token) {
        const response = await fetch(`${DRIVE_API}/files/${fileId}/permissions`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: 'reader', type: 'anyone' })
        });
        if (!response.ok) throw httpError(response.status, 'Sharing', await response.text().catch(() => ''));
    }

    // Dropbox-API-Arg is an HTTP header, so anything outside ASCII (e.g. a Yiddish
    // file name) has to be written as a \uXXXX escape
    function dropboxArg(value) {
        return JSON.stringify(value).replace(/[\u007f-\uffff]/g,
            c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    }

    // Where Dropbox says an upload session really is, when a chunk was sent at the
    // wrong offset (e.g. it got the chunk before the connection dropped): the
    // error has correct_offset somewhere inside it
    function dropboxCorrectOffset(text) {
        let answer;
        try { answer = JSON.parse(text); } catch (err) { return undefined; }
        const find = (value) => {
            if (!value || typeof value !== 'object') return undefined;
            if (typeof value.correct_offset === 'number') return value.correct_offset;
            for (const key of Object.keys(value)) {
                const found = find(value[key]);
                if (found !== undefined) return found;
            }
            return undefined;
        };
        return find(answer.error);
    }

    // One request to Dropbox's content endpoint
    async function dropboxSend(token, endpoint, arg, body, signal) {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${DROPBOX_CONTENT}/${endpoint}`);
        xhr.setRequestHeader('Authorization', 'Bearer ' + token);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('Dropbox-API-Arg', dropboxArg(arg));
        await sendXhr(xhr, body, signal);
        if (xhr.status >= 200 && xhr.status < 300) return xhr.responseText ? JSON.parse(xhr.responseText) : null;
        const error = httpError(xhr.status, 'Upload', xhr.responseText);
        if (xhr.status === 409) error.correctOffset = dropboxCorrectOffset(xhr.responseText);
        throw error;
    }

    // Into the app's own folder; a name that is already taken gets " (1)" added.
    // A file that fits in the first chunk goes up in one request; anything bigger
    // through an upload session, chunk by chunk, so the percent is real. When the
    // connection drops, the same chunk is sent again; if Dropbox already had it,
    // it answers where the session really is, and the upload goes on from there.
    async function uploadDropboxFile(file, token, onProgress, signal) {
        const commit = { path: '/' + file.name.replace(/[\\/]/g, '_'), mode: 'add', autorename: true };
        const progress = chunkProgress(file.size, onProgress);
        const retry = resumer(progress, signal);
        const send = async (endpoint, arg, body) => {
            for (;;) {
                try {
                    const answer = await dropboxSend(token, endpoint, arg, body, signal);
                    retry.ok();
                    return answer;
                } catch (err) {
                    if (err.correctOffset !== undefined) throw err;
                    await retry.wait(err);
                }
            }
        };
        try {
            let result;
            let end = progress.next(0);
            if (end >= file.size) {
                result = await send('files/upload', commit, file);
            } else {
                const session = await send('files/upload_session/start', { close: false }, file.slice(0, end));
                let offset = end;
                progress.confirm(offset);
                for (;;) {
                    end = progress.next(offset);
                    const cursor = { session_id: session.session_id, offset };
                    try {
                        if (end >= file.size) {
                            result = await send('files/upload_session/finish', { cursor, commit }, file.slice(offset));
                            break;
                        }
                        await send('files/upload_session/append_v2', { cursor, close: false }, file.slice(offset, end));
                        offset = end;
                    } catch (err) {
                        if (err.correctOffset === undefined) throw err;
                        retry.ok();
                        offset = err.correctOffset;
                    }
                    progress.confirm(offset);
                }
            }
            progress.done();
            return result;
        } finally {
            progress.stop();
        }
    }

    // A shared link for the file; reuses the existing one if it was shared before
    async function dropboxLink(path, token) {
        const call = (endpoint, body) => fetch(`${DROPBOX_API}/sharing/${endpoint}`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        let link;
        const created = await call('create_shared_link_with_settings', { path });
        if (created.ok) {
            link = await created.json();
        } else {
            const text = await created.text().catch(() => '');
            let answer = null;
            try { answer = JSON.parse(text); } catch (err) { /* plain-text error */ }
            const tag = answer && answer.error && answer.error['.tag'];
            if (tag !== 'shared_link_already_exists') throw httpError(created.status, 'Sharing', text);
            const listed = await call('list_shared_links', { path, direct_only: true });
            if (!listed.ok) throw httpError(listed.status, 'Sharing', await listed.text().catch(() => ''));
            link = ((await listed.json()).links || [])[0];
            if (!link) throw httpError(409, 'Sharing');
        }

        // Some team accounts only allow links inside the team
        const visibility = link.link_permissions && link.link_permissions.resolved_visibility;
        return { url: link.url, shared: !visibility || visibility['.tag'] === 'public' };
    }

    // Everything that differs between the two services. upload() resolves to
    // { name, url, shared }, where shared is false if the file couldn't be made public.
    const PROVIDERS = {
        drive: {
            name: 'Google Drive',
            accountWord: 'Google',
            settingKey: 'driveUpload',
            icon: DRIVE_ICON,
            async upload(file, target, onProgress, signal) {
                const uploaded = await uploadFile(file, target.token, target.folderId, onProgress, signal);
                let shared = true;
                try {
                    await makePublic(uploaded.id, target.token);
                } catch (err) {
                    shared = false; // e.g. a work account whose admin blocks public sharing
                }
                return {
                    name: uploaded.name || file.name,
                    url: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
                    shared
                };
            }
        },
        dropbox: {
            name: 'Dropbox',
            accountWord: 'Dropbox',
            settingKey: 'dropboxUpload',
            icon: DROPBOX_ICON,
            async upload(file, target, onProgress, signal) {
                const uploaded = await uploadDropboxFile(file, target.token, onProgress, signal);
                const link = await dropboxLink(uploaded.path_lower, target.token);
                return { name: uploaded.name || file.name, url: link.url, shared: link.shared };
            }
        }
    };
    const PROVIDER_ORDER = ['drive', 'dropbox'];

    // Square brackets in the name would break the BBCode
    function linkBBCode(name, url) {
        const label = (name || 'file').replace(/\[/g, '(').replace(/\]/g, ')');
        return `[url=${url}]${label}[/url]`;
    }

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart != null ? textarea.selectionStart : textarea.value.length;
        const end = textarea.selectionEnd != null ? textarea.selectionEnd : start;
        const before = textarea.value.slice(0, start);
        const prefix = before && !before.endsWith('\n') ? '\n' : '';
        textarea.setRangeText(prefix + text + '\n', start, end, 'end');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
    }

    // ---------------------------------------------------------------------
    // The widget
    // ---------------------------------------------------------------------

    function createWidget() {
        const cleanups = [];

        const wrap = el('span');
        wrap.id = 'ivd-wrap';

        // Next to phpBB's "add files" button by default, or with the BBCode buttons.
        // Falls back to whichever exists, and finally to above the textarea.
        const attachButtons = findAttachButtons();
        const toolbar = place === 'toolbar' || !attachButtons ? findToolbar() : null;
        const inToolbar = !!toolbar;

        // Styled like its neighbours: a bare ABBC3 icon, or a phpBB button with a label
        const single = enabledProviders.length === 1 ? PROVIDERS[enabledProviders[0]] : null;
        const buttonLabel = single ? single.name : enabledProviders.map(key => PROVIDERS[key].name).join(' / ');
        const button = el('button', inToolbar ? 'abbc3_button' : 'button2');
        button.id = 'ivd-button';
        button.type = 'button';
        button.title = buttonLabel;
        button.setAttribute('aria-label', buttonLabel);
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-expanded', 'false');
        button.innerHTML = single ? single.icon : CLOUD_ICON;
        if (!inToolbar) button.append(el('span', '', buttonLabel));

        // --- Popup: shows the connected account before anything is uploaded ---
        const popup = el('div', 'ivd-popup');
        popup.setAttribute('role', 'dialog');
        popup.setAttribute('aria-label', buttonLabel);
        popup.dir = 'rtl';
        popup.hidden = true;

        // Which service, when more than one is on
        const switcher = el('div', 'ivd-switch');
        switcher.setAttribute('role', 'tablist');
        const switchTabs = {};
        enabledProviders.forEach(key => {
            const tab = el('button', 'ivd-switch-tab');
            tab.type = 'button';
            tab.setAttribute('role', 'tab');
            tab.innerHTML = PROVIDERS[key].icon;
            tab.append(el('span', '', PROVIDERS[key].name));
            tab.addEventListener('click', () => selectProvider(key));
            switchTabs[key] = tab;
            switcher.append(tab);
        });
        switcher.hidden = enabledProviders.length < 2;

        const heading = el('div', 'ivd-heading');

        const accountBox = el('div', 'ivd-account');
        const avatar = el('img', 'ivd-avatar');
        avatar.alt = '';
        avatar.referrerPolicy = 'no-referrer';
        const accountText = el('div', 'ivd-account-text');
        const accountName = el('div', 'ivd-account-name');
        const accountEmail = el('bdi', 'ivd-account-email');
        accountText.append(accountName, accountEmail);
        accountBox.append(avatar, accountText);

        const quotaBox = el('div', 'ivd-quota');
        const quotaBar = el('div', 'ivd-quota-bar');
        const quotaFill = el('div', 'ivd-quota-fill');
        quotaBar.append(quotaFill);
        const quotaText = el('div', 'ivd-quota-text');
        quotaBox.append(quotaBar, quotaText);

        const pickBtn = el('button', 'ivd-btn ivd-primary');
        pickBtn.type = 'button';
        const connectBtn = el('button', 'ivd-btn ivd-primary');
        connectBtn.type = 'button';
        const switchBtn = el('button', 'ivd-btn', 'טויש אקאונט');
        switchBtn.type = 'button';
        const disconnectBtn = el('button', 'ivd-link', 'ארויסלאגן');
        disconnectBtn.type = 'button';

        const actions = el('div', 'ivd-actions');
        actions.append(pickBtn, connectBtn, switchBtn);


        const status = el('div', 'ivd-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        // Upload progress ring, put before the status text while a file goes up
        // (one element, updated in place, so the arc moves smoothly)
        const ring = el('span', 'ivd-ring');
        ring.setAttribute('aria-hidden', 'true');
        ring.innerHTML = '<svg viewBox="0 0 36 36">'
            + '<circle class="ivd-ring-track" cx="18" cy="18" r="15.5" pathLength="100"/>'
            + '<circle class="ivd-ring-fill" cx="18" cy="18" r="15.5" pathLength="100" stroke-dasharray="0 100"/>'
            + '</svg>';
        const ringFill = ring.querySelector('.ivd-ring-fill');
        const ringText = el('span', 'ivd-ring-text');
        ring.append(ringText);

        // A round grey ✕, like Google Drive's
        const cancelBtn = el('button', 'ivd-cancel');
        cancelBtn.type = 'button';
        cancelBtn.title = 'קענסל';
        cancelBtn.setAttribute('aria-label', 'קענסל');
        cancelBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>';
        cancelBtn.addEventListener('click', () => {
            if (uploadAbort) uploadAbort.abort();
        });

        const statusText = el('span', 'ivd-status-text');
        status.append(ring, statusText, cancelBtn);
        status.hidden = true;

        const input = el('input');
        input.type = 'file';
        input.multiple = true;
        input.hidden = true;

        popup.append(switcher, heading, accountBox, quotaBox, actions, status, disconnectBtn);
        wrap.append(button, popup, input);

        if (inToolbar) toolbar.append(wrap);
        else if (attachButtons) attachButtons.append(wrap);
        else findTextarea().before(wrap);
        wrap.classList.add(inToolbar ? 'ivd-in-toolbar' : 'ivd-in-attach');

        // --- Offer shown when a regular attachment is too big for the forum ---
        const offer = el('div');
        offer.id = 'ivd-offer';
        offer.dir = 'rtl';
        offer.hidden = true;
        const offerText = el('span', 'ivd-offer-text');
        const offerBtn = el('button', 'button2');
        offerBtn.type = 'button';
        offerBtn.innerHTML = single ? single.icon : CLOUD_ICON;
        const offerBtnText = el('span');
        offerBtn.append(offerBtnText);
        const offerClose = el('button', 'ivd-offer-close', '×');
        offerClose.type = 'button';
        offerClose.title = 'פארמאך';
        offerClose.setAttribute('aria-label', 'פארמאך');
        offer.append(offerText, offerBtn, offerClose);
        if (attachButtons) attachButtons.after(offer);
        else wrap.after(offer);

        // --- State ---
        let providerKey = enabledProviders[0];
        let provider = PROVIDERS[providerKey];
        let account = null;
        let quota = null;
        let busy = false;
        let statusTimer = null;
        let uploadAbort = null; // the running upload's AbortController
        let pending = null; // files waiting for a click: too big for an attachment, or dropped
        const message = (action) => providerKey + action; // e.g. "dropboxAccount"

        // progress (0..1) shows a ring with the percent before the text, and a thin
        // ring around the button, so it's seen with the popup closed too
        function showStatus(text, kind, holdMs, progress) {
            clearTimeout(statusTimer);
            // The line is built once (ring, text, ✕) and only updated here: replacing
            // it every 0.2s would swallow a click on the ✕ that lands in between
            // kind 'cancelled' keeps the line as it was, the name struck out and
            // the ring a grey ⊘. The word is
            // only in the tooltip and for screen readers.
            const withRing = typeof progress === 'number';
            const cancelled = kind === 'cancelled';
            const uploading = withRing && !cancelled;
            statusText.textContent = text || '';
            status.title = cancelled ? 'אפגעשטעלט' : '';
            if (cancelled) statusText.append(el('span', 'ivd-sr-only', ' – אפגעשטעלט'));
            status.className = 'ivd-status' + (kind ? ' ivd-' + kind : '') + (withRing ? ' ivd-with-ring' : '');
            status.hidden = !text && !withRing;
            ring.hidden = !withRing;
            cancelBtn.hidden = !(uploading && uploadAbort);
            button.classList.toggle('ivd-uploading', uploading);
            if (withRing) {
                const percent = Math.round(progress * 100);
                // Cancelled: a grey ⊘ (the whole circle with a slash, drawn in CSS).
                // Not a part-filled ring, which would look stuck, not a ✕, which
                // would look like the cancel button, and not a stop square, which
                // suggests it can be started again
                ringFill.setAttribute('stroke-dasharray', cancelled ? '100 0' : `${percent} 100`);
                ringText.textContent = cancelled ? '' : percent + '%';
            }
            if (uploading) {
                button.style.setProperty('--ivd-p', Math.round(progress * 100));
            } else {
                button.style.removeProperty('--ivd-p');
            }
            if (text && holdMs) statusTimer = setTimeout(() => showStatus(''), holdMs);
        }

        // Single place that decides what the popup shows
        function render() {
            const connected = !!account;
            const pendingName = pending && (pending.length > 1 ? `${pending.length} פיילס` : pending[0].name);
            heading.textContent = connected ? `די פיילס וועלן ארויפגיין צו ${provider.name}:` : `ארויפלייגן פיילס אויף ${provider.name}`;
            connectBtn.textContent = `פארבינד א ${provider.accountWord} אקאונט`;
            Object.keys(switchTabs).forEach(key => {
                switchTabs[key].classList.toggle('ivd-active', key === providerKey);
                switchTabs[key].setAttribute('aria-selected', String(key === providerKey));
            });
            accountBox.hidden = !connected;
            renderQuota();
            pickBtn.hidden = !connected;
            switchBtn.hidden = !connected;
            disconnectBtn.hidden = !connected;
            connectBtn.hidden = connected;
            // Files already waiting: the button names them and the service they go to,
            // so a switch above changes it before anything is sent
            pickBtn.classList.toggle('ivd-pending', !!pending);
            if (pending) {
                pickBtn.innerHTML = provider.icon;
                pickBtn.append(el('span', '', `לייג ארויף ${pendingName} אויף ${provider.name}`));
            } else {
                pickBtn.textContent = '⬆ קלייב אויס פיילס, אדער שלעפ זיי אהער';
            }

            if (connected) {
                accountName.textContent = account.name || account.email;
                accountEmail.textContent = account.email;
                avatar.hidden = !account.photo;
                if (account.photo) avatar.src = account.photo;
                button.title = provider.name + ': ' + account.email;
            } else {
                button.title = buttonLabel;
            }

            [pickBtn, connectBtn, switchBtn, disconnectBtn, ...Object.values(switchTabs)].forEach(b => { b.disabled = busy; });
        }

        function freeSpace() {
            return quota && quota.limit != null ? Math.max(0, quota.limit - quota.usage) : null;
        }

        function renderQuota() {
            const free = freeSpace();
            quotaBox.hidden = !account || free === null;
            if (quotaBox.hidden) return;

            const used = Math.min(1, quota.usage / quota.limit);
            quotaFill.style.width = (used * 100).toFixed(1) + '%';
            quotaBox.classList.toggle('ivd-quota-low', used >= 0.9);
            quotaText.textContent = `פריי: ${formatSize(free)} פון ${formatSize(quota.limit)}`;
        }

        // Quietly in the background - if it can't be read, the bar just stays hidden
        async function refreshQuota() {
            if (!account) {
                quota = null;
                renderQuota();
                return;
            }
            try {
                quota = (await sendToBackground(message('Quota'))).quota;
            } catch (err) {
                quota = null;
            }
            renderQuota();
        }

        function setBusy(on) {
            busy = on;
            popup.classList.toggle('ivd-busy', on);
            render();
        }

        async function refreshAccount() {
            const key = providerKey;
            let found = null;
            try {
                found = (await sendToBackground(message('Account'))).account;
            } catch (err) {
                found = null;
            }
            if (key !== providerKey) return; // switched service while waiting
            account = found;
            render();
            refreshQuota();
        }

        function selectProvider(key, remember = true) {
            if (busy || !PROVIDERS[key] || !enabledProviders.includes(key)) return;
            providerKey = key;
            provider = PROVIDERS[key];
            account = null;
            quota = null;
            showStatus('');
            render();
            if (!popup.hidden) refreshAccount();
            if (remember) chrome.storage.local.set({ [PROVIDER_KEY]: key });
        }

        // Start on the service used last time
        chrome.storage.local.get(PROVIDER_KEY, (items) => {
            const saved = items[PROVIDER_KEY];
            if (saved && saved !== providerKey && enabledProviders.includes(saved)) selectProvider(saved, false);
        });

        // Below the button when it fits, otherwise above it, so the popup doesn't run
        // off the bottom of the screen. Checked again whenever its content changes size.
        function placePopup() {
            if (popup.hidden) return;
            popup.classList.remove('ivd-up');
            const anchor = button.getBoundingClientRect();
            const below = window.innerHeight - anchor.bottom;
            if (below < popup.offsetHeight + 12 && anchor.top > below) popup.classList.add('ivd-up');
        }

        const popupSize = new ResizeObserver(placePopup);
        popupSize.observe(popup);
        cleanups.push(() => popupSize.disconnect());

        function setOpen(open) {
            popup.hidden = !open;
            button.setAttribute('aria-expanded', String(open));
            if (open) {
                refreshAccount();
                placePopup();
                popup.scrollIntoView({ block: 'nearest' });
            } else if (pending) {
                pending = null;
                render();
            }
        }

        // Opens the popup with files waiting for a click
        function openWith(files) {
            if (busy) {
                showStatus('⏳ ווארט ביז די פריערדיגע פיילס זענען ארויף…', 'warn', HOLD_STATUS_MS);
                return;
            }
            pending = files;
            showStatus('');
            // The button lives in the attachments tab - bring it into view first
            if (!isVisible(button)) {
                const tab = document.querySelector('#attach-panel-tab a, a[data-subpanel="attach-panel"]');
                if (tab) tab.click();
            }
            if (popup.hidden) setOpen(true);
            render();
        }

        button.addEventListener('click', () => setOpen(popup.hidden));

        // Close on outside click / Escape, but never in the middle of an upload.
        // The click's path is taken when it starts, so a click on something that's
        // gone by now (the ✕, removed once the upload stopped) still counts as inside.
        const onDocClick = (e) => {
            const path = e.composedPath();
            if (!popup.hidden && !busy && !path.includes(wrap) && !path.includes(offer)) setOpen(false);
        };
        const onKeyDown = (e) => {
            if (e.key === 'Escape' && !popup.hidden && !busy) setOpen(false);
        };
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKeyDown);
        cleanups.push(() => {
            document.removeEventListener('click', onDocClick);
            document.removeEventListener('keydown', onKeyDown);
        });

        // Another tab connected / switched / signed out - stay in sync
        const onStorage = (changes, area) => {
            const key = providerKey + 'Account';
            if (area === 'local' && changes[key]) {
                account = changes[key].newValue || null;
                render();
            }
        };
        chrome.storage.onChanged.addListener(onStorage);
        cleanups.push(() => chrome.storage.onChanged.removeListener(onStorage));

        async function chooseAccount(switchAccount) {
            setBusy(true);
            showStatus(`ווארט אויפן ${provider.accountWord} פענצטער…`);
            try {
                account = (await sendToBackground(message('Connect'), { switchAccount })).account;
                quota = null;
                showStatus('');
                refreshQuota();
            } catch (err) {
                showStatus('❌ ' + err.message, 'error', HOLD_STATUS_MS * 2);
            } finally {
                setBusy(false);
            }
        }

        connectBtn.addEventListener('click', () => chooseAccount(false));
        switchBtn.addEventListener('click', () => chooseAccount(true));

        disconnectBtn.addEventListener('click', async () => {
            setBusy(true);
            try {
                await sendToBackground(message('Disconnect'));
                account = null;
                showStatus('');
            } catch (err) {
                showStatus('❌ ' + err.message, 'error', HOLD_STATUS_MS * 2);
            } finally {
                setBusy(false);
            }
        });

        pickBtn.addEventListener('click', () => {
            if (busy || !account) return;
            if (pending) {
                const files = pending;
                pending = null;
                uploadAll(files);
                return;
            }
            input.value = '';
            input.click();
        });

        // --- Too-big attachments: remember what was just picked for the forum's own
        // uploader, and when the forum then reports an error, offer Drive instead ---
        const attachLimit = readAttachLimit();
        let tooBig = [];
        let tooBigAt = 0;
        let errorRowsAtPick = 0;
        let offerFiles = null;
        const countErrorRows = () => document.querySelectorAll('#file-list .file-error').length;

        const notePicked = (files) => {
            const big = Array.from(files || []).filter(f => f.size > attachLimit);
            if (!big.length) return;
            tooBig = big;
            tooBigAt = Date.now();
            errorRowsAtPick = countErrorRows();
        };
        const onPickChange = (e) => {
            const target = e.target;
            if (target.type === 'file' && !wrap.contains(target) && target.closest('#attach-panel')) notePicked(target.files);
        };
        const onDrop = (e) => {
            if (e.dataTransfer) notePicked(e.dataTransfer.files);
        };

        // phpBB reports a size error either in its alert box (checked in the browser)
        // or on the file's row in the attachment list (rejected by the server)
        const isVisible = (node) => node && node.getClientRects().length > 0;
        const onPageChange = () => {
            if (!tooBig.length) return;
            if (Date.now() - tooBigAt > TOO_BIG_WINDOW_MS) {
                tooBig = [];
                return;
            }
            const alertShown = isVisible(document.getElementById('phpbb_alert'));
            const rowFailed = countErrorRows() > errorRowsAtPick;
            if (alertShown || rowFailed) {
                showOffer(tooBig);
                tooBig = [];
            }
        };

        if (attachLimit) {
            document.addEventListener('change', onPickChange, true);
            document.addEventListener('drop', onDrop, true);
            const observer = new MutationObserver(onPageChange);
            observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
            cleanups.push(() => {
                document.removeEventListener('change', onPickChange, true);
                document.removeEventListener('drop', onDrop, true);
                observer.disconnect();
            });
        }

        function showOffer(files) {
            offerFiles = files;
            const what = files.length > 1 ? `${files.length} פיילס זענען` : `"${files[0].name}" איז`;
            offerText.textContent = `⚠️ ${what} צו גרויס פאר אן עטעטשמענט (ביז ${formatSize(attachLimit)}).`;
            offerBtnText.textContent = (files.length > 1 ? 'לייג זיי ארויף אויף ' : 'לייג עס ארויף אויף ') + buttonLabel;
            offer.hidden = false;
        }

        offerBtn.addEventListener('click', () => {
            if (busy || !offerFiles) return;
            offer.hidden = true;
            openWith(offerFiles);
        });

        // --- Drag and drop ---
        // On the button or the open popup: the popup already shows where the files go,
        // so they go up right away (or wait there until an account is connected).
        // A video dropped on the post (or an image, in a private message) waits in the popup.
        // Listening on window, in the capture phase, runs before the image resizer and
        // the forum's own uploader, so these files never become regular attachments.
        const setDragOver = (on) => wrap.classList.toggle('ivd-dragover', on);

        const onWindowDragOver = (e) => {
            if (!hasFiles(e)) return;
            const inWrap = e.target instanceof Node && wrap.contains(e.target);
            setDragOver(inWrap);
            if (inWrap) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
            }
        };
        const onWindowDragLeave = (e) => {
            if (!e.relatedTarget) setDragOver(false); // left the page
        };

        function dropOnPopup(files) {
            if (busy) {
                showStatus('⏳ ווארט ביז די פריערדיגע פיילס זענען ארויף…', 'warn', HOLD_STATUS_MS);
            } else if (popup.hidden) {
                openWith(files);
            } else if (account) {
                pending = null;
                uploadAll(files);
            } else {
                pending = files;
                render();
            }
        }

        const onWindowDrop = (e) => {
            setDragOver(false);
            if (!hasFiles(e)) return;
            const target = e.target instanceof Element ? e.target : null;
            if (!target) return;
            const files = Array.from(e.dataTransfer.files || []);

            if (wrap.contains(target)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (files.length) dropOnPopup(files);
                return;
            }

            if (!dropVideos || !target.closest('#message, textarea[name="message"]')) return;
            // A dropped folder is the image resizer's (it zips it) - leave the whole drop to it
            const entries = Array.from(e.dataTransfer.items || []).map(item => item.webkitGetAsEntry && item.webkitGetAsEntry());
            if (entries.some(entry => entry && entry.isDirectory)) return;
            const cloudFiles = files.filter(isCloudFile);
            if (!cloudFiles.length) return;

            e.preventDefault();
            e.stopImmediatePropagation();
            for (const node of document.querySelectorAll('.drag-n-drop-highlight')) {
                node.classList.remove('drag-n-drop-highlight');
            }
            openWith(cloudFiles);

            // Whatever else came along is attached as usual: hand it on as a drop of its own
            const others = files.filter(f => !isCloudFile(f));
            if (others.length) {
                const rest = new DataTransfer();
                others.forEach(f => rest.items.add(f));
                target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: rest }));
            }
        };

        window.addEventListener('dragover', onWindowDragOver, true);
        window.addEventListener('dragleave', onWindowDragLeave, true);
        window.addEventListener('drop', onWindowDrop, true);
        cleanups.push(() => {
            window.removeEventListener('dragover', onWindowDragOver, true);
            window.removeEventListener('dragleave', onWindowDragLeave, true);
            window.removeEventListener('drop', onWindowDrop, true);
        });

        offerClose.addEventListener('click', () => {
            offer.hidden = true;
        });

        input.addEventListener('change', () => {
            const files = Array.from(input.files || []);
            if (files.length) uploadAll(files);
        });

        async function uploadAll(files) {
            const total = files.reduce((sum, f) => sum + f.size, 0);
            const free = freeSpace();
            if (free !== null && total > free) {
                showStatus(`❌ נישט גענוג פלאץ אויף ${provider.name}: די פיילס זענען ${formatSize(total)}, און עס איז נאר דא ${formatSize(free)}`, 'error', HOLD_STATUS_MS * 3);
                return;
            }

            setBusy(true);
            let shareFailed = false;
            let current = null; // the file going up and its percent, for the cancelled line
            uploadAbort = new AbortController();
            const signal = uploadAbort.signal;

            try {
                showStatus(`פארבינדט מיט ${provider.name}…`);
                const upload = provider.upload;
                let target = await sendToBackground(message('UploadTarget'));

                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    const prefix = files.length > 1 ? `(${i + 1}/${files.length}) ` : '';
                    const onProgress = (p, waiting) => {
                        current = { name: prefix + file.name, p };
                        showStatus(waiting
                            ? `${prefix}ווארט אויף אינטערנעט…`
                            : `${prefix}לייגט ארויף ${file.name}…`, '', 0, p);
                    };
                    onProgress(0);

                    let uploaded;
                    try {
                        uploaded = await upload(file, target, onProgress, signal);
                    } catch (err) {
                        if (err.status !== 401) throw err;
                        // Token expired between files - refresh and retry this one
                        target = await sendToBackground(message('UploadTarget'), { staleToken: target.token });
                        uploaded = await upload(file, target, onProgress, signal);
                    }
                    if (!uploaded.shared) shareFailed = true;

                    // Into the post right away, so a later failure never loses it
                    const textarea = findTextarea();
                    if (textarea) insertAtCursor(textarea, linkBBCode(uploaded.name, uploaded.url));
                }

                if (shareFailed) {
                    showStatus(`⚠️ ארויפגעלייגט, אבער ${provider.accountWord} האט נישט ערלויבט צו מאכן אלע פיילס פובליק`, 'warn', HOLD_STATUS_MS * 2);
                } else {
                    showStatus(`✅ ארויפגעלייגט ${files.length} ${files.length > 1 ? 'פיילס' : 'פייל'}, דער לינק איז אריינגעלייגט אין דער תגובה`, 'ok', HOLD_STATUS_MS);
                }
            } catch (err) {
                if (err.name === 'AbortError') {
                    if (current) showStatus(current.name, 'cancelled', HOLD_STATUS_MS, current.p);
                    else showStatus('');
                    return;
                }
                if (err.code === 'not_connected' || err.code === 'account_mismatch') await refreshAccount();
                if (/missing_scope/.test(err.message)) {
                    // Connected before a permission was added - only a fresh connect picks it up
                    showStatus(`❌ די ${provider.accountWord} פארבינדונג האט נישט קיין פערמישן. דרוק "ארויסלאגן" און פארבינד נאכאמאל.`, 'error', HOLD_STATUS_MS * 4);
                } else {
                    showStatus('❌ ' + err.message, 'error', HOLD_STATUS_MS * 3);
                }
            } finally {
                uploadAbort = null;
                setBusy(false);
                refreshQuota();
            }
        }

        render();

        return {
            destroy() {
                clearTimeout(statusTimer);
                cleanups.forEach(fn => fn());
                wrap.remove();
                offer.remove();
            }
        };
    }

    init();
})();
