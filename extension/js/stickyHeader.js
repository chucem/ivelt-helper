// Frozen header (off by default): once the forum's navbar (quick links, notifications, the user's
// menu and the breadcrumbs) scrolls past the top, it stays at the top of the window, without the big
// header with the logo and the search boxes above it. The navbar's search icon, which only the phone
// layout shows, shows on the desktop too while the bar is frozen, and opens the search bar of
// js/addGoogleSearch.js inside it. css/stickyHeader.css has the look
//
// With stickyTopicBar too (off by default), in a topic: once its title is all under the bar, the
// title and the buttons row under it (reply, topic tools, pages) are moved into a third row under it, both
// in one line, and moved back when scrolled up to their place again. The real ones are moved, not
// copied, so the forum's drop-downs in them still work; an empty box keeps their place meanwhile
(function(){
	const navbar = document.querySelector('#page-header > .navbar');
	if (!navbar) return; // not the forum, e.g. Cloudflare's check page

	chrome.storage.local.get(['stickyHeader', 'stickyTopicBar'], function(items){
		if (items.stickyHeader !== true) return;

		const root = document.documentElement;
		root.classList.add('ih-sticky-header');

		// Takes the navbar's place while it's frozen, so the page under it doesn't jump up.
		// Also tells where the navbar's top is, and how wide it is in the page
		const spot = document.createElement('div');
		spot.className = 'ih-sticky-header-spot';
		navbar.before(spot);

		let stuck = false;
		const topicRow = items.stickyTopicBar === true ? makeTopicRow(navbar) : null;

		const update = () => {
			const spotRect = spot.getBoundingClientRect();
			const shouldStick = spotRect.top < 0;

			if (shouldStick !== stuck) {
				stuck = shouldStick;
				// The navbar's height before it leaves, so the spot keeps the page in place
				spot.style.height = stuck ? `${navbar.offsetHeight}px` : '';
				root.classList.toggle('ih-header-stuck', stuck);
				if (!stuck) {
					navbar.style.left = navbar.style.width = '';
					closeSearchBar();
				}
			}

			if (stuck) {
				navbar.style.left = `${spotRect.left}px`;
				navbar.style.width = `${spotRect.width}px`;
			}
			const barHeight = stuck ? navbar.offsetHeight : 0;
			const rowHeight = topicRow ? topicRow.update(stuck, barHeight, spotRect) : 0;
			// Post buttons kept on screen (stickyPostButtons) and a jump to a post stay under it
			root.style.setProperty('--ih-header-height', `${barHeight + rowHeight}px`);
		};

		// On the desktop the search bar is only there while frozen: closed when the bar comes back
		// into its place, where the forum's own search boxes are above it
		const closeSearchBar = () => {
			const bar = document.getElementById('ih-mobile-search');
			const icon = navbar.querySelector('.responsive-search > a');
			if (bar && !bar.hidden && window.matchMedia('(min-width: 701px)').matches) {
				bar.hidden = true;
				icon?.setAttribute('aria-expanded', 'false');
			}
		};

		window.addEventListener('scroll', update, { passive: true });
		window.addEventListener('resize', update);
		// The navbar's height changes when the search bar opens or a row wraps
		new ResizeObserver(update).observe(navbar);
		if (topicRow) new ResizeObserver(update).observe(topicRow.row);
		update();

		// Opened at a post (#p123): the browser jumped there before the bar froze, so the post's
		// top is under it now. Once more, now that scroll-padding-top leaves room for it
		const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
		if (stuck && target) {
			target.scrollIntoView();
		}
	});

	// The topic's title and buttons row, and the third row they move into. update() moves them in
	// or out and returns the row's height (0 when it's not shown)
	function makeTopicRow(navbar) {
		const pageBody = document.getElementById('page-body');
		const title = pageBody && pageBody.querySelector(':scope > h2.topic-title');
		const buttons = pageBody && pageBody.querySelector(':scope > .action-bar.bar-top');
		if (!location.pathname.endsWith('/viewtopic.php') || !title || !buttons) return null;

		const row = document.createElement('div');
		row.className = 'ih-sticky-topic';
		pageBody.prepend(row);
		const titleSpot = document.createElement('div');
		const buttonsSpot = document.createElement('div');
		let shown = false;
		// where the title's bottom was in the page when the row opened: the page under it doesn't
		// move, so it's checked against that, not against the empty box (whose edges differ by the
		// title's margins, which made the row close and open again and again at that spot)
		let titleBottom = 0;

		// Moves them, and sizes the empty boxes so whatever comes after them stays where it was
		const move = (into) => {
			const next = buttons.nextElementSibling;
			const before = next ? next.getBoundingClientRect().top : 0;
			if (into) {
				buttonsSpot.style.height = '';
				title.before(titleSpot);
				buttons.before(buttonsSpot);
				titleSpot.style.height = `${title.offsetHeight}px`;
				row.append(title, buttons);
			} else {
				titleSpot.replaceWith(title);
				buttonsSpot.replaceWith(buttons);
			}
			document.documentElement.classList.toggle('ih-topic-stuck', into);
			if (into && next) {
				const after = next.getBoundingClientRect().top;
				buttonsSpot.style.height = `${Math.max(0, before - after)}px`;
			}
		};

		return {
			row,
			update(stuck, barHeight, spotRect) {
				// opens once the title is all under the bar, and closes only once it's a little below it
				// again, so a scroll that stops right at the edge doesn't open and close it
				let shouldShow;
				if (!stuck) shouldShow = false;
				else if (shown) shouldShow = titleBottom - window.scrollY <= barHeight + 4;
				else shouldShow = title.getBoundingClientRect().bottom < barHeight;
				if (shouldShow !== shown) {
					if (shouldShow) titleBottom = window.scrollY + title.getBoundingClientRect().bottom;
					shown = shouldShow;
					move(shown);
				}
				if (!shown) return 0;
				row.style.top = `${barHeight}px`;
				row.style.left = `${spotRect.left}px`;
				row.style.width = `${spotRect.width}px`;
				return row.offsetHeight;
			}
		};
	}
})();
