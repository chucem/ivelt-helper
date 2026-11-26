// Runs in the extension's own world: the settings come straight from its storage
function enchancePage(items) {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);


// On a phone, quotes without the space at the sides (css/appcss.css), so quotes many levels deep
  // aren't squeezed into a narrow column. The style only applies on a narrow screen
  if (items.compactQuotesMobile !== false) {
    document.documentElement.classList.add('ih-compact-quotes');
    recheckCollapsedQuotes();
  }

// Sticky post buttons logic with logging
  if (items.stickyPostButtons === true) {
    const postButtons = document.querySelectorAll('.has-profile .post-buttons');

    const checkStickyPosition = () => {
      let firstStickyFound = false;
      // With the frozen header (js/stickyHeader.js) the top of the page is under the bar, so a post
      // counts from the bar's bottom; otherwise the previous post kept its buttons while its last
      // lines were hidden under the bar, and they showed over the next post
      const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ih-header-height')) || 0;

      postButtons.forEach(btn => {
        const parent = btn.parentElement;

        const parentRect = parent.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();

        // Add or remove the sticky-post class based on the parent's top position
        if (parentRect.top < top && parentRect.bottom > top + 30 && !firstStickyFound) {
          firstStickyFound = true;

          if (!btn.classList.contains('sticky-post')) {
            btn.style.left = `${btnRect.left}px`; // Keep the original X position
            btn.classList.add('sticky-post');
          }
        } else {
          if (btn.classList.contains('sticky-post')) {
            btn.classList.remove('sticky-post');
            btn.style.left = '';
          }
        }
      });
    };

    window.addEventListener('scroll', checkStickyPosition); // 100ms debounce delay
    checkStickyPosition();
  }
  // Copy the post link (the small icon next to the author name) on a plain left click instead of navigating.
  // Shift+click copies it as a "קעפל: <topic>" link, ready to paste in a reply.
  // Right click, long press, middle click and the other modifier clicks keep the browser's default behavior.
  if (items.copyPostLink !== false) {
    document.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      const link = event.target.closest('[id^="post_content"] > p.author > a[href*="#p"]');
      if (!link) {
        return;
      }

      const postId = new URL(link.href).hash.replace('#p', '');
      if (!/^\d+$/.test(postId)) {
        return;
      }

      event.preventDefault();
      const postUrl = `${window.location.origin}/forum/viewtopic.php?p=${postId}#p${postId}`;
      const title = document.querySelector('h2.topic-title > a')?.textContent.trim();
      copyLink(link, postUrl, event.shiftKey && title ? `קעפל: ${title}` : null)
        .catch(() => { window.location.href = link.href; });
    });
  }

  // In a topic, a plain left click on its title copies a link to the topic: as chosen in the
  // settings, a "קעפל: <title>" link (the way the forum writes it above a quote from a private
  // message, ready to paste in a reply) or only the address. Shift+click copies the other one.
  // Ctrl, middle or right click still open it (asked on the forum, viewtopic.php?p=7075144)
  const topicStyle = items.copyTopicLink === false || items.copyTopicLink === 'off' ? null
    : items.copyTopicLink === 'link' ? 'link' : 'heading';
  const topicTitle = url.pathname === "/forum/viewtopic.php" && topicStyle
    && document.querySelector('h2.topic-title > a[href*="t="]');
  if (topicTitle) {
    topicTitle.title = topicStyle === 'heading'
      ? 'קליק צו קאפירן א "קעפל" לינק צום אשכול, Shift+קליק נאר דעם לינק (Ctrl+קליק עפנט עס)'
      : 'קליק צו קאפירן דעם לינק צום אשכול, Shift+קליק א "קעפל" לינק (Ctrl+קליק עפנט עס)';
    topicTitle.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const topicId = new URL(topicTitle.href).searchParams.get('t');
      if (!/^\d+$/.test(topicId || '')) {
        return;
      }
      event.preventDefault();
      const heading = (topicStyle === 'heading') !== event.shiftKey;
      copyLink(topicTitle, `${window.location.origin}/forum/viewtopic.php?t=${topicId}`,
        heading ? `קעפל: ${topicTitle.textContent.trim()}` : null)
        .catch(() => { window.location.href = topicTitle.href; });
    });
  }

  // Only run on Topic page
  if (url.pathname === "/forum/viewtopic.php"){
    // Duplicate link for "Unread Post" to bottom of page.
    const paginations = document.getElementsByClassName("pagination");
    if (paginations.length > 1) {
      paginations[1].outerHTML = paginations[0].outerHTML;
    }
  }

  const pagination = url.pathname === "/forum/ucp.php" && params.get('i') === 'ucp_notifications'
    && document.querySelector(".action-bar.bar-top .pagination");
  if (pagination){

    const link = document.createElement("a");
    // add listened
    link.setAttribute("href", "javascript:void(0);");
    link.id = "ext-hide-read"
    link.innerText = "באהאלט די געליינטע";
    link.addEventListener('click', function (event) {
      document.querySelectorAll('li.row.bg1, li.row.bg2').forEach(e => e.style.display = (e.style.display === "none") ? "" : "none");

      if (event.currentTarget.id === "ext-hide-read"){
        event.currentTarget.innerText = "ווייז די געליינטע";
        event.currentTarget.id = "ext-show-read";
      } else {
        event.currentTarget.innerText = "באהאלט די געליינטע";
        event.currentTarget.id = "ext-hide-read";
      }

    });

    const linkWrap = document.createElement("span");
    linkWrap.innerText = " • ";
    linkWrap.insertBefore(link, linkWrap.firstChild);

    pagination.insertBefore(linkWrap, pagination.firstChild);
  }

}

// The forum's script (imcger Collapse Quote) cuts long quotes once, while the page loads: each one
// taller than 30 lines gets that height, a fade and a "ווייז מער..." button. The compact quotes style
// comes after that and takes away the space at the sides, so the text is wider and a quote shorter.
// A quote that fits now kept its button, which showed nothing more, with empty space above it (e.g. at
// 594px wide). So once more, with the new sizes: a quote that fits now is shown whole
function recheckCollapsedQuotes() {
  document.querySelectorAll('div.content > blockquote .imcger-quote-text').forEach(box => {
    const text = box.firstElementChild;
    const shadow = box.lastElementChild;
    const button = box.nextElementSibling;
    // Only the ones it cut and that are still closed
    if (!box.style.height || !text || !shadow?.classList.contains('imcger-quote-shadow') || shadow.style.display !== 'block' ||
        !button?.classList.contains('imcger-quote-button')) {
      return;
    }

    if (text.offsetHeight <= parseFloat(box.style.height)) {
      box.style.height = '';
      shadow.style.display = 'none';
      button.style.display = 'none';
    }
  });
}

// Copies the address, or with words a link: [url=...]words[/url] for the forum's reply box, and a
// real link for a mail or a document. Shows "קאפירט" over the anchor
function copyLink(anchor, address, words) {
  let copy;
  if (!words) {
    copy = navigator.clipboard.writeText(address);
  } else {
    const bbcode = `[url=${address}]${words}[/url]`;
    const html = document.createElement('a');
    html.href = address;
    html.textContent = words;
    copy = typeof ClipboardItem === 'function'
      ? navigator.clipboard.write([new ClipboardItem({
          'text/plain': new Blob([bbcode], { type: 'text/plain' }),
          'text/html': new Blob([html.outerHTML], { type: 'text/html' })
        })])
      : navigator.clipboard.writeText(bbcode);
  }
  return copy.then(() => showCopiedTip(anchor, words ? 'קעפל לינק קאפירט ✓' : 'לינק קאפירט ✓'));
}

function showCopiedTip(anchor, text = 'לינק קאפירט ✓') {
  const tip = document.createElement('span');
  tip.className = 'ext-copied-tip';
  tip.innerText = text;

  const rect = anchor.getBoundingClientRect();
  tip.style.top = `${rect.top + window.scrollY - 28}px`;
  tip.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
  document.body.appendChild(tip);

  // Keep it on screen: centered over a link at the screen's edge (on a phone the link is at the right edge) it sticks out
  const margin = 6;
  const tipRect = tip.getBoundingClientRect();
  const viewWidth = document.documentElement.clientWidth;
  const shift = Math.min(0, viewWidth - margin - tipRect.right) || Math.max(0, margin - tipRect.left);
  tip.style.left = `${parseFloat(tip.style.left) + shift}px`;

  setTimeout(() => tip.classList.add('ext-copied-tip-hide'), 1200);
  setTimeout(() => tip.remove(), 1600);
}

// not the forum, e.g. Cloudflare's check page
if (document.getElementById('page-body')) {
  chrome.storage.local.get(['stickyPostButtons', 'copyPostLink', 'copyTopicLink', 'compactQuotesMobile'], enchancePage);
}
