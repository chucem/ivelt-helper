// Resolve opaque upload links only when a reader uses a media filter. Public
// previews need no Drive/Dropbox account or API token, and no file is downloaded.
(function () {
    'use strict';
    const types = globalThis.iveltMediaTypes;
    const cache = new Map(), pending = new Map();
    const queue = [];
    let active = 0;
    const MAX_HTML = 1024 * 1024;

    async function readPreview(url) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let reader, response;
        try {
            response = await fetch(url, {
                credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal
            });
            if (!response.ok) return 'unknown';
            const contentType = response.headers.get('content-type') || '';
            const kind = types.mimeType(contentType);
            if (kind) return kind;
            if (!/\btext\/html\b/i.test(contentType)) return 'unknown';
            reader = response.body.getReader();
            const decoder = new TextDecoder();
            let html = '', bytes = 0;
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > MAX_HTML) return 'unknown';
                html += decoder.decode(chunk.value, { stream: true });
                // The preview's filename/type is usually in its head. Stop as
                // soon as it is known instead of reading the entire viewer app.
                const type = types.metadataType(html, url);
                if (type !== 'unknown') return type;
            }
            html += decoder.decode();
            return types.metadataType(html, url);
        } catch (e) {
            return 'unknown'; // Removed, private, offline or blocked stays unknown.
        } finally {
            if (reader) await reader.cancel().catch(() => {});
            else await response?.body?.cancel().catch(() => {});
            clearTimeout(timeout);
        }
    }

    function drain() {
        while (active < 3 && queue.length) {
            const { url, resolve } = queue.shift();
            active++;
            readPreview(url).then(kind => {
                if (cache.size >= 300) cache.delete(cache.keys().next().value);
                cache.set(url, { kind, until: Date.now() + (kind === 'unknown' ? 30000 : 600000) });
                resolve({ kind });
            }).finally(() => { pending.delete(url); active--; drain(); });
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.type !== 'mediaLinkType') return;
        const url = types.previewUrl(request.url);
        if (!url) { sendResponse({ kind: 'unknown' }); return; }
        const cached = cache.get(url);
        if (!request.refresh && cached?.until > Date.now()) { sendResponse({ kind: cached.kind }); return; }
        if (!pending.has(url)) pending.set(url, new Promise(resolve => { queue.push({ url, resolve }); }));
        pending.get(url).then(sendResponse);
        drain();
        return true;
    });
}());
