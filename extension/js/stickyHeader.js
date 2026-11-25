// Frozen header (off by default): once the forum's navbar (quick links, notifications, the user's
// menu and the breadcrumbs) scrolls past the top, it stays at the top of the window, without the big
// header with the logo and the search boxes above it. The navbar's search icon, which only the phone
// layout shows, shows on the desktop too while the bar is frozen, and opens the search bar of
// js/addGoogleSearch.js inside it. css/stickyHeader.css has the look
(function(){
	const navbar = document.querySelector('#page-header > .navbar');
	if (!navbar) return; // not the forum, e.g. Cloudflare's check page

	chrome.storage.local.get(['stickyHeader'], function(items){
		if (items.stickyHeader !== true) return;

		const root = document.documentElement;
		root.classList.add('ih-sticky-header');

		// Takes the navbar's place while it's frozen, so the page under it doesn't jump up.
		// Also tells where the navbar's top is, and how wide it is in the page
		const spot = document.createElement('div');
		spot.className = 'ih-sticky-header-spot';
		navbar.before(spot);

		let stuck = false;

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
			// Post buttons kept on screen (stickyPostButtons) and a jump to a post stay under it
			root.style.setProperty('--ih-header-height', `${stuck ? navbar.offsetHeight : 0}px`);
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
		update();

		// Opened at a post (#p123): the browser jumped there before the bar froze, so the post's
		// top is under it now. Once more, now that scroll-padding-top leaves room for it
		const target = location.hash.length > 1 && document.getElementById(decodeURIComponent(location.hash.slice(1)));
		if (stuck && target) {
			target.scrollIntoView();
		}
	});
})();
