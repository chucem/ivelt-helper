// Applies the color theme chosen in settings (palettes in js/themes.data.js, styles in css/themes.css).
// Runs at document_start on the forum, and in the <head> of the settings page and the popup,
// which use the same --t-* variables for their own colors.
// chrome.storage is async, so the last applied variables are also cached in localStorage
// (the forum's, or the extension's own), letting us set them before the first paint.
(function(){
	const root = document.documentElement;
	const cacheKey = 'iveltHelperTheme';
	let appliedVars = [];
	let notForum = false;

	function setVars(themeId, vars){
		appliedVars.forEach(name => root.style.removeProperty(name));
		appliedVars = vars ? Object.keys(vars) : [];

		if(!vars){
			root.removeAttribute('data-ivh-theme');
			return;
		}

		appliedVars.forEach(name => root.style.setProperty(name, vars[name]));
		root.setAttribute('data-ivh-theme', themeId);
	}

	function applyTheme(items){
		if(notForum) return;
		// when themes are turned off in the settings the forum keeps its own look
		const theme = items.themesEnabled ? resolveTheme(items.theme, items.customTheme) : null;
		const vars = theme ? themeVars(theme) : null;

		setVars(items.theme, vars);

		try {
			if(vars)
				localStorage.setItem(cacheKey, JSON.stringify({ id: items.theme, vars }));
			else
				localStorage.removeItem(cacheKey);
		} catch(e) {}
	}

	function loadAndApply(){
		chrome.storage.local.get(['themesEnabled', 'theme', 'customTheme'], applyTheme);
	}

	try {
		const cached = JSON.parse(localStorage.getItem(cacheKey));
		if(cached && cached.vars)
			setVars(cached.id, cached.vars);
	} catch(e) {}

	loadAndApply();

	// A forum address that isn't the forum (e.g. Cloudflare's check page) keeps its own look. At
	// document_start the page isn't there yet to tell, so the theme comes off once it is.
	if(location.protocol !== 'chrome-extension:'){
		document.addEventListener('DOMContentLoaded', () => {
			if(document.getElementById('page-body')) return;
			notForum = true;
			setVars(null, null);
		});
	}

	// switch live when the setting is changed (also while editing a custom theme)
	chrome.storage.onChanged.addListener((changes, area) => {
		if(area === 'local' && (changes.themesEnabled || changes.theme || changes.customTheme))
			loadAndApply();
	});
}());
