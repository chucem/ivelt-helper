function enchancePage() {
  const url = new URL(window.location.href);
  const params = new URLSearchParams(url.search);


// Sticky post buttons logic with logging
  if (document.getElementById("iveltHelperSettings").getAttribute("data-sticky-post-buttons") === "true") {
    const postButtons = document.querySelectorAll('.has-profile .post-buttons');

    const checkStickyPosition = () => {
      let firstStickyFound = false;

      postButtons.forEach(btn => {
        const parent = btn.parentElement;

        const parentRect = parent.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();

        // Add or remove the sticky-post class based on the parent's top position
        if (parentRect.top < 0 && parentRect.bottom > 30 && !firstStickyFound) {
          firstStickyFound = true;
          // console.log(`found button set to stick. the parent.bottom is ${parentRect.bottom}, the parentRect.top is ${parentRect.top} `);

          if (!btn.classList.contains('sticky-post')) {
            // console.log(`Adding 'sticky-post' to`, i);
            btn.style.left = `${btnRect.left}px`; // Keep the original X position
            btn.classList.add('sticky-post');
          }
        } else {
          if (btn.classList.contains('sticky-post')) {
            // console.log(`Removing 'sticky-post' from`, i);
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
  // Right click, long press, middle click and modifier clicks keep the browser's default behavior.
  if (document.getElementById("iveltHelperSettings").getAttribute("data-copy-post-link") !== "false") {
    document.addEventListener('click', (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
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
      navigator.clipboard.writeText(postUrl)
        .then(() => showCopiedTip(link))
        .catch(() => { window.location.href = link.href; });
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

function showCopiedTip(anchor) {
  const tip = document.createElement('span');
  tip.className = 'ext-copied-tip';
  tip.innerText = 'לינק קאפירט ✓';

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

whenIveltSettingsReady(enchancePage);
