function previousPage() {
	document.querySelectorAll(".previous a")[0].click();
}

function nextPage() {
	document.querySelectorAll(".next a")[0].click();
}

function scrollTop() {
	window.scrollTo({ top: 0, behavior: 'instant' });
}

function scrollBottom() {
	window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' } );
}

// Runs in the extension's own world, so the setting comes straight from its storage, and a change
// in the settings applies right away. On unless the user turned it off.
let upDownArrowKeys = true;

function upDownArrowKeysEnabled() {
	return upDownArrowKeys;
}

function sendPost(post) {
	if (post) {
		post.click();
	}
}

function previewPost() {
	document.getElementsByName("preview")[0].click();
}

function toggleNotification() {
	const notificationNode = document.getElementById("notification_list_button");
	if (notificationNode) {
        notificationNode.scrollIntoView({ behavior: "instant", block: "start" });
		notificationNode.click();
	}
}

function nextNotification() {
  const nodes = document.querySelectorAll("li.bg2 .notification-block");
  for (const node of nodes) {
    const url = node.dataset.realUrl || node.href;
    if (url) {
      window.location.href = url;
      break;
    }
  }
}

function checkKey(e) {
    const post = document.getElementsByName("post")[0] || document.getElementsByName("submit")[0] || false;
    const isAltKey = e.altKey || e.getModifierState('AltGraph');

    if (e.code === "KeyA" && isAltKey) {
		window.location.href = '/forum/search.php?search_id=active_topics';
	}

    if (e.code === "KeyV" && isAltKey && post) {
		previewPost();
	}

    if (e.code === "KeyN" && isAltKey) {
		toggleNotification();
	}

    if (e.code === "KeyM" && isAltKey) {
		nextNotification();
	}

	e = e || window.event;

    if (e.target.nodeName === "INPUT" || e.target.nodeName === "TEXTAREA" || e.target.isContentEditable) {
        return;
    }

    if (e.key === "ArrowLeft") {
		try {
			nextPage();
		} catch {
			// already on the last page
		}
    } else if (e.key === "ArrowRight") {
		try {
			previousPage();
		} catch {
			// already on the first page
		}
    } else if (e.key === "ArrowUp" && upDownArrowKeysEnabled()) {
		scrollTop();
    } else if (e.key === "ArrowDown" && upDownArrowKeysEnabled()) {
		scrollBottom();
	}
}

// not the forum, e.g. Cloudflare's check page: no shortcuts there
if (document.getElementById("page-body")) {
	let post = document.getElementsByName("post")[0] || document.getElementsByName("submit")[0] || false;
	if (post) {
		post.setAttribute("title", "שיק (Ctrl+Enter)");
	}
	chrome.storage.local.get('upDownArrowKeys', items => { upDownArrowKeys = items.upDownArrowKeys !== false; });
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'local' && changes.upDownArrowKeys) upDownArrowKeys = changes.upDownArrowKeys.newValue !== false;
	});
	document.addEventListener("keydown", checkKey);

	// Ctrl+Enter sends the post. phpBB's editor.js also binds Ctrl+Enter in textareas and
	// clicks every submit button in the form (preview, post, ...), so together with ours the
	// form was submitted several times at once, which broke edits (attachments lost, error page).
	// Catch it in the capture phase before phpBB sees it, and submit once via the post button.
	window.addEventListener("keydown", function (e) {
		if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) {
			return;
		}
		const post = document.getElementsByName("post")[0] || document.getElementsByName("submit")[0];
		if (!post) {
			return;
		}
		e.preventDefault();
		e.stopImmediatePropagation();
		if (!e.repeat) {
			sendPost(post);
		}
	}, true);
}
