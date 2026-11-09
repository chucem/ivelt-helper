// Color themes, shared by the content script (js/theme.js) and the settings page.
//
// A theme only needs the base colors listed in themeBaseColors; everything else
// (borders, hover, inputs, quotes, ...) is derived in themeVars(). A preset can
// still set a derived color explicitly to fine tune it.
// The colors are applied as --t-* CSS variables, which css/themes.css maps onto
// the forum's own (prosilver) styles.

// the colors the custom theme editor exposes, in display order
const themeBaseColors = [
	{ key: 'bg', label: 'הינטערגרונט' },
	{ key: 'surface', label: 'הויפט טייל' },
	{ key: 'row1', label: 'שורה 1' },
	{ key: 'row2', label: 'שורה 2' },
	{ key: 'border', label: 'ליניעס' },
	{ key: 'text', label: 'טעקסט' },
	{ key: 'strong', label: 'טונקעלער טעקסט' },
	{ key: 'muted', label: 'בלאסער טעקסט' },
	{ key: 'link', label: 'לינקס' },
	{ key: 'linkHover', label: 'לינק ביים צייגן' },
	{ key: 'accent', label: 'קעפל באר' },
	{ key: 'onAccent', label: 'טעקסט אויף קעפל' }
];

const themePresets = [
	{ id: 'default', name: 'נארמאל', colors: {
		bg: '#F5F7FA', surface: '#FFFFFF', text: '#536482', strong: '#28313F', muted: '#6A7A90',
		link: '#105289', linkHover: '#D31141', accent: '#12A3EB', onAccent: '#FFFFFF',
		row1: '#ECF3F7', row2: '#E1EBF2', border: '#CCCCCC' } },

	{ id: 'claude', name: 'Claude', colors: {
		bg: '#F0EEE6', surface: '#FAF9F5', text: '#3D3D3A', strong: '#141413', muted: '#73726C',
		link: '#B6532F', linkHover: '#8F3D20', accent: '#D97757', accentDark: '#C15F3C', onAccent: '#FFFFFF',
		row1: '#F6F4EE', row2: '#EEEBE2', row3: '#E6E2D6', hover: '#E9E3D3', border: '#DEDAD0',
		codeText: '#8A4B2E', highlight: '#F5D9C9', error: '#B5452C' } },

	{ id: 'claude-dark', name: 'Claude טונקל', dark: true, colors: {
		bg: '#1F1E1D', surface: '#262624', text: '#C2C0B6', strong: '#F5F4EE', muted: '#9C9A92',
		link: '#E5946F', linkHover: '#F2B395', accent: '#B4593A', accentDark: '#93472D', onAccent: '#FAF9F5',
		row1: '#2B2A27', row2: '#302F2C', row3: '#383733', hover: '#3B3A35', border: '#403F3A',
		codeText: '#E8A383', highlight: '#6B3A26', error: '#F07A62' } },

	{ id: 'dark', name: 'GitHub טונקל', dark: true, colors: {
		bg: '#010409', surface: '#0D1117', text: '#C9D1D9', strong: '#F0F6FC', muted: '#8B949E',
		link: '#58A6FF', linkHover: '#79C0FF', accent: '#1F6FEB', accentDark: '#1158C7', onAccent: '#FFFFFF',
		row1: '#161B22', row2: '#1C2128', row3: '#22272E', hover: '#262C36', border: '#30363D',
		codeText: '#A5D6FF', highlight: '#5A4A12', error: '#F85149' } },

	{ id: 'reddit', name: 'Reddit', colors: {
		bg: '#DAE0E6', surface: '#FFFFFF', text: '#1C1C1C', strong: '#1A1A1B', muted: '#787C7E',
		link: '#0079D3', linkHover: '#FF4500', accent: '#FF4500', accentDark: '#D93A00', onAccent: '#FFFFFF',
		row1: '#FFFFFF', row2: '#F6F7F8', border: '#E1E4E7' } },

	{ id: 'reddit-dark', name: 'Reddit טונקל', dark: true, colors: {
		bg: '#030303', surface: '#1A1A1B', text: '#D7DADC', strong: '#F2F3F5', muted: '#818384',
		link: '#4FBCFF', linkHover: '#FF8B60', accent: '#D93A00', accentDark: '#B33000', onAccent: '#FFFFFF',
		row1: '#1A1A1B', row2: '#232324', border: '#343536' } },

	{ id: 'stackoverflow', name: 'Stack Overflow', colors: {
		bg: '#F1F2F3', surface: '#FFFFFF', text: '#3B4045', strong: '#0C0D0E', muted: '#6A737C',
		link: '#0063BF', linkHover: '#0A95FF', accent: '#F48225', accentDark: '#DA680B', onAccent: '#FFFFFF',
		row1: '#FFFFFF', row2: '#F8F9F9', border: '#E3E6E8' } },

	{ id: 'hackernews', name: 'Hacker News', colors: {
		bg: '#FFFFFF', surface: '#F6F6EF', text: '#222222', strong: '#000000', muted: '#828282',
		link: '#000000', linkHover: '#FF6600', accent: '#FF6600', accentDark: '#E65C00', onAccent: '#000000',
		row1: '#F6F6EF', row2: '#EEEEE4', border: '#E0E0D4' } },

	{ id: 'xenforo', name: 'XenForo', colors: {
		bg: '#E9EBEE', surface: '#FEFEFE', text: '#141414', strong: '#141414', muted: '#8C8C8C',
		link: '#2577B1', linkHover: '#185886', accent: '#185886', accentDark: '#12446A', onAccent: '#FFFFFF',
		row1: '#FEFEFE', row2: '#F5F5F5', border: '#DADADA' } },

	{ id: 'discourse', name: 'Discourse', dark: true, colors: {
		bg: '#0B0B0B', surface: '#1A1A1A', text: '#DDDDDD', strong: '#F5F5F5', muted: '#999999',
		link: '#3AB0E2', linkHover: '#7CCBEE', accent: '#0B7EB0', accentDark: '#08648C', onAccent: '#FFFFFF',
		row1: '#222222', row2: '#2A2A2A', border: '#363636' } },

	{ id: 'x-dim', name: 'X (Twitter)', dark: true, colors: {
		bg: '#15202B', surface: '#192734', text: '#D6DDE3', strong: '#F7F9F9', muted: '#8B98A5',
		link: '#1D9BF0', linkHover: '#59B8F5', accent: '#1D9BF0', accentDark: '#1A8CD8', onAccent: '#FFFFFF',
		row1: '#1E2A36', row2: '#22303C', border: '#38444D' } },

	{ id: 'dracula', name: 'Dracula', dark: true, colors: {
		bg: '#21222C', surface: '#282A36', text: '#E6E6E0', strong: '#F8F8F2', muted: '#A4ABCF',
		link: '#8BE9FD', linkHover: '#FF79C6', accent: '#6D5BA8', accentDark: '#554689', onAccent: '#F8F8F2',
		row1: '#2E303E', row2: '#343746', row3: '#3B3E51', hover: '#44475A', border: '#44475A',
		quoteBorder: '#6272A4', codeText: '#50FA7B', highlight: '#5C4B7A', error: '#FF5555' } },

	{ id: 'nord', name: 'Nord', dark: true, colors: {
		bg: '#2E3440', surface: '#3B4252', text: '#D8DEE9', strong: '#ECEFF4', muted: '#A9B2C3',
		link: '#88C0D0', linkHover: '#8FBCBB', accent: '#5E81AC', accentDark: '#4C6A92', onAccent: '#ECEFF4',
		row1: '#424A5B', row2: '#465063', row3: '#4C566A', hover: '#515C72', border: '#4C566A',
		quoteBorder: '#5E81AC', codeText: '#A3BE8C', highlight: '#6E5A2E', error: '#E07A84' } },

	{ id: 'solarized', name: 'Solarized', colors: {
		bg: '#EEE8D5', surface: '#FDF6E3', text: '#586E75', strong: '#073642', muted: '#7E8E90',
		link: '#1F75B3', linkHover: '#D33682', accent: '#268BD2', accentDark: '#1F6FA8', onAccent: '#FDF6E3',
		row1: '#F7F0DC', row2: '#EFE8D3', row3: '#E4DDC8', border: '#DDD6C1',
		codeText: '#6C7F00', highlight: '#F5D88A', error: '#DC322F' } },

	{ id: 'sepia', name: 'סעפיא', colors: {
		bg: '#E9DFC8', surface: '#F4ECD8', text: '#5B4636', strong: '#3B2A1E', muted: '#85705B',
		link: '#8B4513', linkHover: '#B5541C', accent: '#8B6B47', accentDark: '#6F5436', onAccent: '#FFF8EC',
		row1: '#EFE5CE', row2: '#E8DCC0', row3: '#DFD1B1', border: '#D6C7A6',
		codeText: '#7A4A1E', highlight: '#E8C88F', error: '#A0331F' } }
];

const hexColorPattern = /^#[0-9a-f]{6}$/i;

// every color a theme can set: the base colors, and the derived ones a preset can fine tune (keep in line with themeVars)
const themeColorKeys = themeBaseColors.map(base => base.key).concat([
	'accentDark', 'row3', 'hover', 'panel', 'inputBg', 'inputBorder', 'buttonBg', 'buttonBorder', 'buttonHover',
	'quoteBg', 'quoteBorder', 'codeBg', 'codeText', 'dropdown', 'highlight', 'error', 'success', 'warn'
]);

// Returns the theme object to apply, or null for the forum's own look.
// customTheme comes from storage (or a pasted JSON), so only well formed colors are kept.
function resolveTheme(themeId, customTheme){
	if(themeId === 'custom')
		return sanitizeTheme(customTheme);

	if(!themeId || themeId === 'default')
		return null;

	return themePresets.find(preset => preset.id === themeId) || null;
}

function sanitizeTheme(theme){
	if(!theme || typeof theme !== 'object' || !theme.colors || typeof theme.colors !== 'object')
		return null;

	const colors = {};
	Object.keys(theme.colors).forEach(key => {
		if(themeColorKeys.includes(key) && hexColorPattern.test(theme.colors[key]))
			colors[key] = theme.colors[key];
	});

	// a theme is only usable when all base colors are there
	if(!themeBaseColors.every(base => colors[base.key]))
		return null;

	return {
		id: 'custom',
		name: typeof theme.name === 'string' ? theme.name.slice(0, 40) : '',
		dark: !!theme.dark,
		colors
	};
}

// Turns a theme into the --t-* CSS variables used by css/themes.css
function themeVars(theme){
	const c = theme.colors;
	const mix = (a, b, percentOfA) => `color-mix(in srgb, ${a} ${percentOfA}%, ${b})`;

	const all = {
		accentDark: mix(c.accent, '#000', 80),
		row3: mix(c.row2, c.text, 88),
		hover: mix(c.row2, c.accent, 88),
		panel: c.row1,
		inputBg: theme.dark ? c.bg : c.surface,
		inputBorder: mix(c.border, c.text, 75),
		buttonBg: c.surface,
		buttonBorder: mix(c.border, c.text, 80),
		buttonHover: c.row2,
		// quotes stand apart from both post colors (a step toward the text color, lightly tinted
		// with the accent, like the forum's beige quotes), and nested quotes alternate with a deeper step
		quoteBg: mix(mix(c.row2, c.text, 93), c.accent, 94),
		quoteBg2: mix(mix(c.row2, c.text, 86), c.accent, 94),
		quoteBorder: mix(c.border, c.text, 65),
		codeBg: c.bg,
		codeText: c.link,
		dropdown: c.surface,
		highlight: mix(c.accent, c.surface, 35),
		error: theme.dark ? '#F07A62' : '#B5452C',
		success: theme.dark ? '#56D364' : '#2E7D32',
		warn: theme.dark ? '#E3B341' : '#7A4F01',
		...c
	};
	// the notification count badge: the error red, toned down toward the page on dark themes (white text stays readable)
	all.badge = theme.dark ? mix(all.error, c.bg, 72) : all.error;

	const vars = {};
	Object.keys(all).forEach(key => {
		vars['--t-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())] = all[key];
	});
	vars['--t-scheme'] = theme.dark ? 'dark' : 'light';
	// colors that the forum or posters set inline are picked for a white page; flip their lightness on dark themes
	vars['--t-ink-filter'] = theme.dark ? 'invert(1) hue-rotate(180deg)' : 'none';

	return vars;
}
