// set once the settings are on the page, see the end of this file
let TOPIC_MAPPING_EXPIRE, COPY_ATTACHMENTS, CACHE_EXPIRY_MS;
const CACHE_KEY = "topicMappingCache";
const CACHE_TIME_KEY = "topicMappingLastFetchTime";

function createButton(reference, customClass, title, text, onclick, itext="") {
    let li = document.createElement('li');
    let a = document.createElement('a');
    let span = document.createElement('span');
    let i = document.createElement('i');
    //let img = document.createElement('img');
    //img.setAttribute('src', `https://www.ivelt.com/kfmdm/resources/drawable/${icon}`)
    if (reference){
        a.setAttribute('href', reference);
    }
    // A function, so nothing from a post (an image address, a file name) is ever turned into code.
    // A string only for the forum's own onclick code, see addQuoteLastButton
    if (typeof onclick === 'function'){
        a.addEventListener('click', onclick)
    } else if (onclick){
        a.setAttribute('onClick', onclick)
    }
    a.setAttribute('class', 'button button-icon-only custom-btn ');
    // a.setAttribute('style', "width:18px;color:black;text-align:center;user-select:none;");
    a.setAttribute('title',title );
    a.style.background = '#ebeadd';
    i.setAttribute('class', `icon ${customClass} fa-fw`);
    i.setAttribute('aria-hidden', 'true');
    i.style.width = "auto";
    i.style.minWidth = "18px"
    i.innerText = itext;
    span.innerText = text;
    a.appendChild(i);
    a.appendChild(span);
    li.appendChild(a);

    return {li, a, span, i}
}

function getPMHref(id) {
    let pm_button = document.querySelector(`#profile${id.replace("post_content", "")} .pm-icon`)
    if (pm_button){
        return pm_button.parentElement;
    }
    return null;
}

// The post's attached pictures: their alt is the file name. The ones placed in the text sit in
// .inline-attachment and the quoted text has them between [attachment] tags; the ones attached at
// the bottom sit in the .attachbox after .content, and the quoted text doesn't have them at all.
// Not [img] pictures, whose alt is just the word "בילד".
function extractImageUrlsAndNames(postElement) {
    const images = postElement.querySelectorAll(".inline-attachment img.postimage, .attachbox img.postimage");
    const imageUrls = [];

    images.forEach(function(image) {
        // a thumbnail (&t=1) links to the full picture
        const link = image.closest('a[href*="download/file.php"]');
        const url = /[?&]t=1\b/.test(image.src) && link ? link.href : image.src;
        imageUrls.push({url, name:image.alt, inline: !!image.closest('.inline-attachment')});
    });

    return imageUrls;
}

function replaceAttachmentsWithImgBBCode(text, imageData) {
    if (COPY_ATTACHMENTS !== true) {
        return text;
    }

    // In the text's order, each [attachment=N]name[/attachment] becomes the next picture with that
    // name, in the post's order. By name alone two pasted pictures, both "clipboard-image.jpg", would
    // both come out as the first one. A file that isn't a picture keeps just its name.
    const unused = imageData.filter(image => image.inline);
    text = text.replace(/\[attachment=\d+\]([\s\S]*?)\[\/attachment\]/g, (tag, inner) => {
        const name = inner.replace(/<!--.*?-->/g, '').trim();
        const i = unused.findIndex(image => image.name === name);
        return i === -1 ? name : `[img]${unused.splice(i, 1)[0].url}[/img]`;
    });

    // The pictures attached at the bottom go at the end of the quote, the way the post shows them
    const bottom = imageData.filter(image => !image.inline).map(image => `[img]${image.url}[/img]`).join('\n');
    if (!bottom) {
        return text;
    }
    const end = text.lastIndexOf('[/quote]');
    return end === -1
        ? `${text.trimEnd()}\n${bottom}`
        : `${text.slice(0, end).trimEnd()}\n${bottom}\n${text.slice(end)}`;
}
async function addBtn() {
    let onlyLastQuote = window.location.href.includes("last=true");
    if (onlyLastQuote) {
        let messageArea = document.querySelector("#message");
        let text = messageArea.innerHTML;
        if (hasNestedQuotes(text)) {
            text = removeNestedQuotes(text);
            messageArea.innerHTML = text;
        }
    }

    let btns = document.querySelectorAll('.post-buttons');
    let isPosting = (window.location.href.includes("posting.php"));
    let isPM = (window.location.href.includes("ucp.php"));
    var needUpdating = false;
    let topicMapping;

    // with updates off the list is still loaded: from the saved copy, or fetched once when there's none
    topicMapping = await fetchTopicMapping();


    btns.forEach(btn => {
        // Check if custom buttons have been added already, if yes ignore.
        if (btn.getElementsByClassName('custom-btn').length > 0) {
            return;
        }
        needUpdating = true
        btn.querySelectorAll('li.hidden:not(.responsive-menu)').forEach(b => {
            if (b.getAttribute('class') === "hidden") {
                b.removeAttribute('class')
            }
        })

        addUnderlineForQuoteBtn(btn);

        let contentElement = btn.parentElement.getElementsByClassName("content").item(0)

        // the whole post, since the pictures attached at the bottom are outside .content
        const imageData = extractImageUrlsAndNames(btn.parentElement);

        let id = btn.parentElement.getAttribute("id") || ""

        let strippedId = id.replace("post_content", "")
        strippedId = strippedId.replace("pr", "")
        if (!isPosting) {
            addCopyQuoteButton(btn, id.replace("post_content", ""), imageData)
        }
        addSimpleButton(btn, null, 'fa-at', 'דערמאן תגובה', 'דערמאן תגובה', () => ping_user(strippedId))
        addPMQuoteButton(btn, id)
        if (contentElement.innerHTML.includes("blockquote")) {
            addQuoteLastButton(btn, isPosting);
        }

        if (!isPosting && !isPM) {
            if (topicMapping) {
                addQuoteInOtherTopicButton(btn, strippedId, topicMapping, imageData);
            }
        }

        // let responsiveMenu = btn.getElementsByClassName('responsive-menu').item(0);
        try {
            btn.removeChild(btn.getElementsByClassName('responsive-menu').item(0))
        } catch (e) {

        }
    });
    if (needUpdating) {
        let navBar = document.querySelector('#nav-footer');
        navBar.querySelectorAll('li.hidden:not(.responsive-menu)').forEach(si => {
            si.setAttribute('class', si.getAttribute('class').replace('hidden', ''))
        })
        navBar.removeChild(navBar.getElementsByClassName('responsive-menu').item(0))
        parseDocument($('body'));
    }
}

function addSimpleButton(btn, href, customClass, title, text, onclick, itext=""){
    let button = createButton(href, customClass, title, text, onclick, itext);

    let quoteLi = getQuoteElm(btn)?.parentElement;
    if (quoteLi){
        quoteLi.parentNode.insertBefore(button.li, quoteLi.nextSibling)
    }

}

function getQuoteElm(btn){

    const quoteButton = btn.querySelector('i.icon.fa-quote-left.fa-fw');

    if (quoteButton){
        const quoteUrl = quoteButton.parentElement;
        if (quoteUrl){
                return quoteUrl;
        }
    }

    return null;

}

function addUnderlineForQuoteBtn(btn) {
    // posts the user can't quote (a locked topic) have no quote button
    let sourceURL = getQuoteElm(btn);
    if (sourceURL) {
        sourceURL.style.background = '#ebeadd';
    }
}

function addCopyQuoteButton(btn, postID, imageData){
    // the post's text comes from its quote (or PM reply) page, so a post without one gets no button
    let sourceURL = getPMHref(postID) || getQuoteElm(btn)
    if (!sourceURL) {
        return;
    }
    const href = sourceURL.getAttribute("href");
    addSimpleButton(btn, null, 'fa-copy', 'ציטיר אין אנדערע אשכול', 'ציטיר אין אנדערע אשכול',
        () => copyQuote(href, postID, imageData))
}

// A private message to the writer with the post quoted: the link from the profile's contact menu
// (פארבינד זיך), which a phone doesn't show. Only on a phone, see css/appcss.css
function addPMQuoteButton(btn, postID) {
    let pmLink = getPMHref(postID);
    if (!pmLink) {
        return;
    }

    let button = createButton(pmLink.getAttribute('href'), 'fa-envelope', 'שיק א פריוואטע מעסעדזש מיט א ציטאט פון דער תגובה', 'פריוואטע מעסעדזש מיט א ציטאט');
    button.li.classList.add('ih-pm-quote');

    let quoteLi = getQuoteElm(btn)?.parentElement;
    if (quoteLi) {
        quoteLi.parentNode.insertBefore(button.li, quoteLi.nextSibling)
    }
}

function addQuoteLastButton(btn, isPosting) {

    let quoteElm = getQuoteElm(btn)
    if (!quoteElm){
        return;
    }

    // on the reply page this reuses the forum's own addquote(...) onclick as lastaddquote(...)
    addSimpleButton(btn, `${quoteElm.getAttribute('href')}&last=true`, 'fa-quote-left last', 'ציטיר בלויז די לעצטע תגובה', 'ציטיר לעצטע',
        isPosting? `last${quoteElm.getAttribute('onclick')}`: null, '1');
}


function getPostLink(postID){
    // the address the user is on (ivelt.com or www.ivelt.com), where they're signed in
    return `${location.origin}/forum/viewtopic.php?p=${postID}#p${postID}`;
}

function getPostDetails(post_id, prefix = 'p'){
    const usernameElm = document.querySelector(`#${prefix}${post_id} .username`) ||
        document.querySelector(`#${prefix}${post_id} .username-coloured`);

    const username = usernameElm ? usernameElm.innerText : "";
    const usernameLink = usernameElm ? usernameElm.href : "";
    const userId = usernameLink ? usernameLink.split("u=")[1] : "";


    let postTimestampElm = document.querySelector(`#${prefix}${post_id} time`);
    let postTime;

    if (!postTimestampElm){
        // the reply page's topic review has no <time>, the forum's addquote(... {time:N,user_id:N}) onclick has it
        const tsLink = document.querySelector(`#${prefix}${post_id} [href='#postingbox']`);
        const tsMatch = tsLink && (tsLink.getAttribute('onclick') || '').match('(?<=time:)(.*)(?=,user)');
        postTime = tsMatch ? tsMatch[0] : undefined;
    } else {
        postTime = Date.parse(postTimestampElm.dateTime) / 1000
    }

    return {
        "username": username,
        "id": userId,
        "time": postTime
    };
}

function ping_user(post_id){

    if (window.location.href.includes("posting.php")){
        let PostDetails = getPostDetails(post_id,"pr")
        let text = `[quote="${PostDetails.username}" user_id=${PostDetails.id} time=${PostDetails.time} post_id=${post_id}]\n[/quote]`
        insert_text(text)
    } else {
        let PostDetails = getPostDetails(post_id)
        let text = `[quote="${PostDetails.username}" user_id=${PostDetails.id} time=${PostDetails.time} post_id=${post_id}]\n[/quote]`

        if (iveltSetting("alwaysCopyTopic") === true){
            navigator.clipboard.writeText(text)
            iveltNotify("קאפירט צום קליפבאורד")
        } else {
            addText(text)
        }

    }
}

function addText(text){
    var textarea = document.querySelector("#message-box textarea");

    if (!isNaN(textarea.selectionStart)) {
    	var sel_start = textarea.selectionStart;
    	var sel_end = textarea.selectionEnd;
    	mozWrapApp(textarea, text, '');
    	textarea.selectionStart = sel_start + text.length;
    	textarea.selectionEnd = sel_end + text.length;
    } else if (textarea.createTextRange && textarea.caretPos) {
    	if (baseHeight !== textarea.caretPos.boundingHeight) {
    		textarea.focus();
    		storeCaret(textarea);
    	}
    	var caret_pos = textarea.caretPos;
    	caret_pos.text = caret_pos.text.charAt(caret_pos.text.length - 1) === ' ' ? caret_pos.text + text + ' ' : caret_pos.text + text;
    } else {
    	textarea.value = textarea.value + text;
    }
    textarea.focus();
}
function mozWrapApp(txtarea, open, close) {
	var selLength = (typeof(txtarea.textLength) === 'undefined') ? txtarea.value.length : txtarea.textLength;
	var selStart = txtarea.selectionStart;
	var selEnd = txtarea.selectionEnd;
	var scrollTop = txtarea.scrollTop;

	var s1 = (txtarea.value).substring(0,selStart);
	var s2 = (txtarea.value).substring(selStart, selEnd);
	var s3 = (txtarea.value).substring(selEnd, selLength);

	txtarea.value = s1 + open + s2 + close + s3;
	txtarea.selectionStart = selStart + open.length;
	txtarea.selectionEnd = selEnd + open.length;
	txtarea.focus();
	txtarea.scrollTop = scrollTop;

}

function hasNestedQuotes(text) {
    let firstQ = text.indexOf("[quote");
    if (firstQ === -1) {
        return false;
    }
    let secondQ = text.indexOf("[quote", firstQ + 1);
    return secondQ !== -1;

}

function removeNestedQuotes(text) {
    let nestedQuote = text.substring(
        text.lastIndexOf('[quote'),
        text.indexOf("[/quote]", text.lastIndexOf('[quote')) + 9
    );
    let modifiedText = text.replace(nestedQuote, "");

    if (hasNestedQuotes(modifiedText)) {
        return removeNestedQuotes(modifiedText);
    }

    return modifiedText;
}


function lastaddquote(post_id, username) {
    let messageName= 'message_' + post_id;
    let theSelection = '';
    let divArea = document.getElementById(messageName);

    if (divArea.innerHTML) {
        theSelection = divArea.innerHTML.replace(/<br>/ig, '\n');
        theSelection = theSelection.replace(/<br\/>/ig, '\n');
        theSelection = theSelection.replace(/&lt\;/ig, '<');
        theSelection = theSelection.replace(/&gt\;/ig, '>');
        theSelection = theSelection.replace(/&amp\;/ig, '&');
        theSelection = theSelection.replace(/&nbsp\;/ig, ' ');
    }  else if (divArea.textContent) {
        theSelection = divArea.textContent;
    } else if (divArea.firstChild.nodeValue) {
        theSelection = divArea.firstChild.nodeValue;
    }

    if (theSelection) {
        let text = '[quote="' + username + '"]' + theSelection + '[/quote]'
        insert_text(removeNestedQuotes(text));
    }

}

function copyQuote(url, post_id, imageData){
    fetchMsgText(url).then( res => {
        res = withTopicLink(replaceAttachmentsWithImgBBCode(res, imageData), post_id);
            return navigator.clipboard.writeText(res).then(
                () => iveltNotify("קאפירט צום קליפבאורד"),
                () => iveltNotify("קען נישט קאפירן צום קליפבאורד, פרובירט נאכאמאל", 5000)
            )
        }
    ).catch(e => iveltNotify(fetchFailedMessage(e), 5000))
}

// The link to the quoted post, as chosen in the settings (quoteSourceLink): a "קעפל: <topic>" line
// above the quote, the way the forum's own private-message quote page writes it (where most quotes
// come from, so it's the line people know), a "מקור" link below it, both, or none.
// Not on a private message, which has no topic.
function withTopicLink(text, postID) {
    const choice = iveltSetting("quoteSourceLink");
    const topicLine = /^\s*\[url=[^\]]*\]קעפל:[^\n]*?\[\/url\]\s*/;
    const forumLine = text.match(topicLine);
    text = text.replace(topicLine, '');

    const title = document.querySelector('.topic-title a')?.textContent.trim();
    if (!title) {
        // nothing to build our own links from: keep what the forum wrote
        return (forumLine ? forumLine[0] : '') + text;
    }
    const link = getPostLink(postID);
    const above = choice === 'source' || choice === 'none' ? '' :
        (forumLine ? forumLine[0].trim() : `[url=${link}]קעפל: ${title}[/url]`) + '\n\n';
    const below = choice === 'source' || choice === 'both' ? ` [url=${link}]מקור[/url]` : '';
    return above + (below ? text.trimEnd() + below + '\n' : text);
}

function iveltNotify(message, ms = 1500){

    let fadeTarget = document.querySelector('#ivelt-notify');
    if (!fadeTarget) {
        fadeTarget = document.createElement('div');
        fadeTarget.id = 'ivelt-notify'; // styled in css/appcss.css

        const container = document.querySelector('#page-body')
        container.insertBefore(fadeTarget, container.firstChild);
    }

    fadeTarget.style.opacity = "1";
    fadeTarget.textContent = message;
    clearTimeout(fadeTarget.hideTimer);
    fadeTarget.hideTimer = setTimeout(function() {
        fadeTarget.style.opacity = "0";
    }, ms);
}


// topic mapping via google sheet by טעכניש גערעדט
//https://docs.google.com/spreadsheets/d/1bziJ_h6bIRBXFSBJHT3aBsb13-QrEnrSjjy_-IS3FFw/edit?gid=1771705226#gid=1771705226


// the forum's CSP blocks this page from reaching Google Sheets, so the extension fetches the sheet (see js/topicMappingRelay.js)
function requestTopicMappingCsv() {
    return new Promise((resolve, reject) => {
        window.addEventListener('message', function onResult(e) {
            if (e.source !== window || !e.data || e.data.type !== 'ivelt-helper-topic-mapping-result') return;
            window.removeEventListener('message', onResult);
            e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.text);
        });
        window.postMessage({ type: 'ivelt-helper-topic-mapping' }, location.origin);
    });
}

async function fetchTopicMapping() {
    const now = Date.now();

// Check if we have cached data and if it's still valid
const cachedData = localStorage.getItem(CACHE_KEY);
const lastFetchTime = localStorage.getItem(CACHE_TIME_KEY);

const forceRefresh = iveltSetting("forceUpdateTopicMapCache") === true;

if (!forceRefresh && cachedData && lastFetchTime && now - lastFetchTime < CACHE_EXPIRY_MS) {
    // Use cached data if available and valid
    return JSON.parse(cachedData);
    }

// Otherwise, fetch new data from Google Sheets
    try {
        const csvText = await requestTopicMappingCsv();
        const mappings = {};

        const rows = csvText.split("\n");
        rows.forEach(row => {
            const [sourceTopic, targetTopic] = row.split(",").map(cell => cell.trim());
            if (sourceTopic && targetTopic) {
                mappings[sourceTopic] = targetTopic;
            }
        });

        // Save the fetched mappings and current time to localStorage
        localStorage.setItem(CACHE_KEY, JSON.stringify(mappings));
        localStorage.setItem(CACHE_TIME_KEY, now.toString());

        return mappings;
    } catch (error) {
        console.error("Error fetching topic mappings:", error);
        // keep using the list from last time, and try again on the next page
        return cachedData ? JSON.parse(cachedData) : null;
    }
}

function getCurrentTopicIdFromDOM() {
    const match = document.querySelector('.topic-title a')?.href?.match(/[?&]t=(\d+)/);
    return match?.[1] ?? null;
}

function addQuoteInOtherTopicButton(btn, postID, topicMapping, imageData) {
    const currentTopicId = getCurrentTopicIdFromDOM();

    if (!currentTopicId) {
        console.error("Unable to determine the current topic ID.");
        return;
    }

    const targetTopicId = topicMapping[currentTopicId];
    if (!targetTopicId) {
        return;
    }
    let sourceURL = getQuoteElm(btn)

    addSimpleButton(
        btn,
        null,
        'fa-comment',
        'ציטיר אינעם קאמענטארן אשכול',
        'ציטיר אינעם קאמענטארן אשכול',
        () => quoteInOtherTopic(sourceURL.getAttribute("href"), postID, targetTopicId, imageData))

}

// The post's text from its quote (or PM reply) page. Fails with "cloudflare" when Cloudflare
// sent its check page instead, which it sometimes does for a page fetched in the background.
function fetchMsgText(url) {
    return fetch(url)
        .then(response => response.text().then(data => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(data, "text/html");
            const message = doc.querySelector("#message-box #message");
            if (message) return message.innerText;
            const cloudflare = response.headers.get("cf-mitigated") === "challenge" || /Just a moment/i.test(doc.title);
            throw new Error(cloudflare ? "cloudflare" : "no message");
        }));
}

function fetchFailedMessage(error) {
    // Cloudflare lets it through once its check is passed in a normal tab
    return error && error.message === "cloudflare"
        ? "Cloudflare האט אפגעשטעלט. עפנט איינמאל דעם ציטיר בלאט פון דער תגובה, און פרובירט נאכאמאל"
        : "קען נישט ברענגען די תגובה, פרובירט נאכאמאל";
}

async function quoteInOtherTopic(url, postID, targetTopicId, imageData) {
    if (!targetTopicId) {
        iveltNotify("דער אשכול האט נישט קיין קאמענטארן אשכול", 5000);
        return;
    }

    try {
        // Fetch the message text
        let res = await fetchMsgText(url);

        // Process the message text
        res = withTopicLink(replaceAttachmentsWithImgBBCode(res, imageData), postID);

        // Open the reply window
        // on the same address as this page: on another one the quote can't be put into its text box
        const replyURL = `${location.origin}/forum/posting.php?mode=reply&t=${targetTopicId}`;
        const replyWindow = window.open(replyURL, '_blank');

        if (!replyWindow) {
            iveltNotify("דער בראוזער האט נישט געלאזט עפענען א נייעם טעב. ערלויבט פאפ-אפס פאר אייוועלט, און פרובירט נאכאמאל", 5000);
            return;
        }

        // Wait for the textarea to load. Give up after 30 seconds, or if the tab is closed: a reply
        // page that never gets one (signed out, an error page, the forum down) would keep this going
        replyWindow.onload = () => {
            const giveUpAt = Date.now() + 30000;
            const interval = setInterval(() => {
                try {
                    if (replyWindow.closed || Date.now() > giveUpAt) {
                        clearInterval(interval);
                        return;
                    }
                    const textarea = replyWindow.document.querySelector("#message-box textarea");
                    if (textarea) {
                        textarea.value = res;
                        clearInterval(interval);
                    }
                } catch (e) {
                    clearInterval(interval);
                }
            }, 100); // Retry every 100ms
        };
    } catch (error) {
        iveltNotify(fetchFailedMessage(error), 5000);
    }
}


whenIveltSettingsReady(() => {
    TOPIC_MAPPING_EXPIRE = iveltSetting("cachedTopicMappingExpire");
    COPY_ATTACHMENTS = iveltSetting("copyAttachments");
    // empty is never: the list is only fetched when there's none yet, or with "update the list now"
    CACHE_EXPIRY_MS = TOPIC_MAPPING_EXPIRE === '' ? Infinity : (TOPIC_MAPPING_EXPIRE || 3600) * 1000;
    addBtn();
});