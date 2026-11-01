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
    if (onclick){
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

function extractImageUrlsAndNames(contentElement) {
    const images = contentElement.querySelectorAll("img.postimage");
    const imageUrls = [];

    images.forEach(function(image) {
        imageUrls.push({url:image.src, name:image.alt});
    });

    return imageUrls;
}

function replaceAttachmentsWithImgBBCode(text, imageData) {
    if (COPY_ATTACHMENTS !== "true") {
        return text;
    }

    imageData = JSON.parse(imageData);

    // Loop through each image in the imageData array
    imageData.forEach(image => {
        // Create a regex that matches the exact filename anywhere in the text
        const regex = new RegExp(image.name, "g"); // Matches the filename exactly, even if there's no space
        text = text.replace(regex, `[img]${image.url}[/img]`);
    });

    // Remove all [attachment=X] and [/attachment] tags in one go.
    // This regex matches either:
    // 1. '[attachment=' followed by one or more digits and then ']'
    // 2. '[/attachment]'
    const allAttachmentBBCodeRegex = /\[attachment=\d+\]|\[\/attachment\]/g;
    text = text.replace(allAttachmentBBCodeRegex, "");

    return text;
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

    if (TOPIC_MAPPING_EXPIRE !== "") {
         topicMapping = await fetchTopicMapping();
    }


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

        const imageData = extractImageUrlsAndNames(contentElement);

        let id = btn.parentElement.getAttribute("id") || ""

        let strippedId = id.replace("post_content", "")
        strippedId = strippedId.replace("pr", "")
        if (!isPosting) {
            addCopyQuoteButton(btn, id.replace("post_content", ""), imageData)
        }
        let pingOnClick = `ping_user(${strippedId})`
        addSimpleButton(btn, null, 'fa-at', 'דערמאן תגובה', 'דערמאן תגובה', pingOnClick)
        addPMQuoteButton(btn, id)
        if (contentElement.innerHTML.includes("blockquote")) {
            addQuoteLastButton(btn, isPosting);
        }

        if (TOPIC_MAPPING_EXPIRE !== "" && !isPosting && !isPM) {
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
    let navUpdate = addDefaultPage();
    if (needUpdating || navUpdate) {
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
    let sourceURL = getPMHref(postID) || getQuoteElm(btn)
    addSimpleButton(btn, null, 'fa-copy', 'ציטיר אין אנדערע אשכול', 'ציטיר אין אנדערע אשכול',
        sourceURL?
            `copyQuote("${sourceURL.getAttribute("href")}", "${postID}", 
            '${JSON.stringify(imageData)}')`:
            `copyQuoteParse("${postID}")`
    )
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

    addSimpleButton(btn, `${quoteElm.getAttribute('href')}&last=true`, 'fa-quote-left last', 'ציטיר בלויז די לעצטע תגובה', 'ציטיר לעצטע',
        isPosting? `last${quoteElm.getAttribute('onclick')}`: null, '1');
}


function addDefaultPage(){
    if (document.querySelector(`#kf-app-default-page`)){
        return false
    }
    let li = document.createElement("li")
    let a = document.createElement('a');
    li.appendChild(a)
    li.setAttribute("class", "rightside")
    li.setAttribute("id", "kf-app-default-page")
    a.setAttribute('onClick', "saveDefaultPage()")
    a.innerText = "מאך דאס פאר מיין דיפאולט בלאט"
    let pagination = document.querySelectorAll("#nav-footer").item(0)
    if (pagination){
        pagination.insertBefore(li, pagination.firstChild);
        return true;
    }
    return false;
}

function getPostLink(postID){
    return `https://www.ivelt.com/forum/viewtopic.php?p=${postID}#p${postID}`;
}

function copyQuoteParse(post_id){
    var html = document.querySelector(`#post_content${post_id} .content`).innerHTML
    let post_url = getPostLink(post_id)
    var username = getUsername(post_id)
    let converter = new HTML2BBCode();
    html = html.replaceAll("./download", "www.ivelt.com/forum/download")
    navigator.clipboard.writeText(`[quote="${username}"]${converter.feed(html)} [/quote] [url=${post_url}]מקור[/url]`)
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
        const tsExtractor = document.querySelector(`#${prefix}${post_id} [href='#postingbox']`).getAttribute('onclick');
        if (postTimestampElm){
            postTime = tsExtractor ? tsExtractor.match('(?<=time:)(.*)(?=,user)')[0] : undefined;        }
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

        if (document.getElementById("iveltHelperSettings").getAttribute("data-always-copy-topic") == "true"){
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
    let post_url = getPostLink(post_id)
    fetchMsgText(url).then( res => {
        res = replaceAttachmentsWithImgBBCode(res, imageData);

            if (url.toString().includes("posting.php")){
                res = `${res} [url=${post_url}]מקור[/url]`
            }
            navigator.clipboard.writeText(res).then(r =>
                iveltNotify("קאפירט צום קליפבאורד")
            )
        }
    )
}

function iveltNotify(message){

    let fadeTarget = document.querySelector('#ivelt-notify');
    if (!fadeTarget) {
        fadeTarget = document.createElement('div');
        fadeTarget.id = 'ivelt-notify'; // styled in css/appcss.css

        const container = document.querySelector('#page-body')
        container.insertBefore(fadeTarget, container.firstChild);
    }

    fadeTarget.style.opacity = "1";
    fadeTarget.innerHTML = message ;
    setTimeout(function() {
        fadeTarget.style.opacity = "0";
    }, 1500);
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

const forceRefresh = document.getElementById("iveltHelperSettings").getAttribute("data-force-update-topic-map-cache") === "true";

if (!forceRefresh && cachedData && lastFetchTime && now - lastFetchTime < CACHE_EXPIRY_MS) {
    // Use cached data if available and valid
    console.log("Using cached topic mapping.");
    return JSON.parse(cachedData);
    }

// Otherwise, fetch new data from Google Sheets
    try {
        console.log('fetching topic mappings form google sheet');
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

        console.log("Fetched and cached new topic mapping.");
        return mappings;
    } catch (error) {
        console.error("Error fetching topic mappings:", error);
        return null;
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
        `quoteInOtherTopic("${sourceURL.getAttribute("href")}", "${postID}", "${targetTopicId}" ,'${JSON.stringify(imageData)}')`)

}

function fetchMsgText(url) {
    return fetch(url)
        .then(response => response.text())
        .then(data => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(data, "text/html");
            return doc.querySelector("#message-box #message").innerText;
        });
}

async function quoteInOtherTopic(url, postID, targetTopicId, imageData) {
    if (!targetTopicId) {
        alert("No target topic found for this topic in the mapping.");
        return;
    }

    try {
        // Fetch the message text
        let res = await fetchMsgText(url);
        if (!res) {
            console.error("Failed to fetch message text.");
            return;
        }

        // Process the message text
        res = replaceAttachmentsWithImgBBCode(res, imageData);

        // Open the reply window
        const replyURL = `https://www.ivelt.com/forum/posting.php?mode=reply&t=${targetTopicId}`;
        const replyWindow = window.open(replyURL, '_blank');

        if (!replyWindow) {
            alert("Popup blocked. Please allow popups for this site.");
            return;
        }

        // Wait for the textarea to load
        replyWindow.onload = () => {
            const interval = setInterval(() => {
                try {
                    const textarea = replyWindow.document.querySelector("#message-box textarea");
                    if (textarea) {
                        textarea.value = res;
                        clearInterval(interval);
                    }
                } catch (e) {
                    console.error("Error accessing textarea:", e);
                    clearInterval(interval);
                }
            }, 100); // Retry every 100ms
        };
    } catch (error) {
        console.error("Error in quoteInOtherTopic:", error);
    }
}


whenIveltSettingsReady(() => {
    const settings = document.getElementById("iveltHelperSettings");
    TOPIC_MAPPING_EXPIRE = settings.getAttribute("data-cached-topic-mapping-expire");
    COPY_ATTACHMENTS = settings.getAttribute("data-copy-attachments");
    // empty is never: the list is only fetched when there's none yet, or with "update the list now"
    CACHE_EXPIRY_MS = TOPIC_MAPPING_EXPIRE === '' ? Infinity : (TOPIC_MAPPING_EXPIRE || 3600) * 1000;
    addBtn();
});