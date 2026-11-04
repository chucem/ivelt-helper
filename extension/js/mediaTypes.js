// Shared by the topic filter and the background file-preview reader.
(function () {
    'use strict';

    function filenameType(name) {
        if (/\.(mp4|m4v|mov|webm|mkv|avi|wmv|3gp|flv|mpe?g|ogv|ts)$/i.test(name.trim())) return 'video';
        if (/\.(jpe?g|png|gif|webp|avif|bmp|svg|heic|tiff?)$/i.test(name.trim())) return 'image';
        if (/\.[a-z0-9]{1,10}$/i.test(name.trim())) return 'other';
        return null;
    }

    function httpUrl(value) {
        try {
            const url = new URL(value);
            return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url : null;
        } catch (e) { return null; }
    }

    function knownType(value) {
        const url = httpUrl(value);
        if (!url) return null;
        let path;
        try { path = decodeURIComponent(url.pathname); } catch (e) { path = url.pathname; }
        const type = filenameType(path);
        if (type === 'video' || type === 'image') return type;
        if ((/^(www\.|m\.)?youtube\.com$/.test(url.hostname) &&
            ((url.pathname === '/watch' && url.searchParams.has('v')) || /^\/(embed|shorts|live)\/[^/]+/.test(path))) ||
            (url.hostname === 'www.youtube-nocookie.com' && /^\/embed\/[^/]+/.test(path)) ||
            (url.hostname === 'youtu.be' && /^\/[^/]+/.test(path)) ||
            (/^(www\.|player\.)?vimeo\.com$/.test(url.hostname) && /^\/(video\/)?\d+/.test(path))) return 'video';
        return null;
    }

    function driveFileId(url) {
        const id = /^\/file\/d\/([\w-]+)(?:\/|$)/.exec(url.pathname)?.[1] ||
            (/^\/(open|uc)$/.test(url.pathname) ? url.searchParams.get('id') : null);
        return id && /^[\w-]{10,200}$/.test(id) ? id : null;
    }

    function isNetFreeLink(value) {
        const url = httpUrl(value);
        // Recognize digits inserted between the letters of "drive", e.g.
        // dri123ve or dr123ive. Recognition must never repair or fetch the URL.
        return !!url && !url.port && url.hostname !== 'drive.google.com' &&
            /^d\d*r\d*i\d*v\d*e\.google\.com$/.test(url.hostname) && !!driveFileId(url);
    }

    // Canonical public preview pages only, never arbitrary URLs supplied by a page.
    function previewUrl(value) {
        const url = httpUrl(value);
        if (!url || url.protocol !== 'https:') return null;
        if (url.hostname === 'drive.google.com') {
            const id = driveFileId(url);
            if (!id) return null;
            const clean = new URL('https://drive.google.com/file/d/' + id + '/view');
            const resourceKey = url.searchParams.get('resourcekey');
            if (resourceKey && /^[\w-]{1,200}$/.test(resourceKey)) clean.searchParams.set('resourcekey', resourceKey);
            return clean.href;
        }
        if (/^(www\.)?dropbox\.com$/.test(url.hostname) && /^\/(s\/[^/]+\/[^/]+|scl\/fi\/[^/]+\/[^/]+)$/.test(url.pathname)) {
            const clean = new URL(url.pathname, 'https://www.dropbox.com');
            const key = url.searchParams.get('rlkey');
            if (key && /^[\w-]{1,200}$/.test(key)) clean.searchParams.set('rlkey', key);
            clean.searchParams.set('dl', '0');
            return clean.href;
        }
        return null;
    }

    function mimeType(value) {
        if (/^video\//i.test(value)) return 'video';
        if (/^image\//i.test(value)) return 'image';
        return null;
    }

    function decode(value) {
        return value.replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([a-f\d]+));/gi, (match, dec, hex) => {
            if (dec || hex) {
                const code = parseInt(dec || hex, hex ? 16 : 10);
                return code <= 0x10ffff ? String.fromCodePoint(code) : '';
            }
            return ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[match.toLowerCase()];
        });
    }

    function metadataType(html, url) {
        // Never execute preview scripts or infer image type from og:image: video
        // previews have thumbnails too. Only file metadata and filenames count.
        const host = new URL(url).hostname;
        // Drive's server-rendered preview declares the actual document MIME
        // type here, including files whose owner removed the filename suffix.
        if (host === 'drive.google.com') {
            const declared = /"docs-dm"\s*:\s*("(?:\\.|[^"\\])*")/.exec(html)?.[1];
            if (declared) {
                try {
                    const mime = JSON.parse(declared);
                    const kind = mimeType(mime);
                    if (kind) return kind;
                    if (/^[a-z][a-z\d.+-]*\/[a-z\d.+-]+$/i.test(mime)) return 'other';
                } catch (e) { /* Continue with standard preview metadata. */ }
            }
        }
        const meta = new Map();
        for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
            const attrs = new Map();
            for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
                attrs.set(match[1].toLowerCase(), decode(match[2] ?? match[3]));
            const key = attrs.get('property') || attrs.get('itemprop') || attrs.get('name');
            if (key) meta.set(key.toLowerCase(), attrs.get('content') || '');
        }
        for (const key of ['og:video:type', 'og:audio:type', 'encodingformat']) {
            const mime = meta.get(key);
            if (!mime) continue;
            const kind = mimeType(mime);
            if (kind) return kind;
            if (key === 'encodingformat' || key === 'og:audio:type') return 'other';
        }
        if (/^video(?:\.|$)/i.test(meta.get('og:type') || '') || meta.get('og:video') || meta.get('og:video:url')) return 'video';
        const title = decode(/<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || '');
        const names = [meta.get('og:title'), meta.get('name'), title].filter(Boolean);
        for (let name of names) {
            name = name.replace(host === 'drive.google.com' ? /\s*-\s*Google Drive\s*$/i : /\s*[-|]\s*Dropbox\s*$/i, '');
            const kind = filenameType(name);
            if (kind) return kind;
        }
        return 'unknown';
    }

    globalThis.iveltMediaTypes = { filenameType, knownType, previewUrl, mimeType, metadataType, isNetFreeLink };
}());
