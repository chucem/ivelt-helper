// Theme picker and custom theme editor on the settings page.
// Palettes and helpers come from js/themes.data.js.

const themeEditor = {
	themeId: 'default',
	custom: null,
	saveTimeout: null
};

function initThemePicker(currentTheme, customTheme){
	themeEditor.themeId = currentTheme || 'default';
	themeEditor.custom = sanitizeTheme(customTheme);

	const picker = document.getElementById('themePicker');
	themePresets.forEach(preset => picker.appendChild(createThemeCard(preset.id, preset.name, preset)));
	picker.appendChild(createThemeCard('custom', 'אייגענע', themeEditor.custom));

	initThemeEditor();
	updateThemeEditor();
}

function createThemeCard(id, name, theme){
	const card = document.createElement('label');
	card.className = 'theme-card';
	card.innerHTML = `<input type='radio' name='theme'>
		<span class='theme-preview'>
			<span class='tp-header'></span>
			<span class='tp-row tp-row1'><i></i></span>
			<span class='tp-row tp-row2'><i></i></span>
		</span>
		<span class='theme-name'></span>`;
	card.querySelector('.theme-name').textContent = name;
	setPreviewColors(card, theme);

	const radio = card.querySelector('input');
	radio.value = id;
	radio.checked = id === themeEditor.themeId;
	radio.addEventListener('change', () => selectTheme(id));

	return card;
}

function setPreviewColors(card, theme){
	card.classList.toggle('theme-card-empty', !theme);
	if(!theme)
		return;

	const vars = themeVars(theme);
	Object.keys(vars).forEach(name => card.style.setProperty(name, vars[name]));
}

function selectTheme(id){
	themeEditor.themeId = id;

	// first time: start the custom theme from the theme that was in use
	if(id === 'custom' && !themeEditor.custom){
		themeEditor.custom = copyBaseColors(themePresets.find(preset => preset.id === themeEditor.lastPresetId) || themePresets[0]);
		setPreviewColors(customThemeCard(), themeEditor.custom);
	}

	if(id !== 'custom')
		themeEditor.lastPresetId = id;

	commitNewSetting(id === 'custom' ? { theme: id, customTheme: themeEditor.custom } : { theme: id });
	updateThemeEditor();
}

// Only the base colors, so the derived ones follow when they get edited
function copyBaseColors(theme){
	const colors = {};
	themeBaseColors.forEach(base => colors[base.key] = theme.colors[base.key]);
	return { name: '', dark: !!theme.dark, colors };
}

function initThemeEditor(){
	themeEditor.lastPresetId = themeEditor.themeId === 'custom' ? 'default' : themeEditor.themeId;

	const baseSelect = document.getElementById('themeEditorBase');
	themePresets.forEach(preset => baseSelect.add(new Option(preset.name, preset.id)));
	baseSelect.addEventListener('change', () => {
		if(!baseSelect.value)
			return;
		themeEditor.custom = copyBaseColors(themePresets.find(preset => preset.id === baseSelect.value));
		baseSelect.value = '';
		customThemeChanged();
	});

	const colorsContainer = document.getElementById('themeEditorColors');
	themeBaseColors.forEach(base => {
		const field = document.createElement('label');
		field.className = 'theme-color-field';
		field.innerHTML = `<input type='color'><span></span>`;
		field.querySelector('span').textContent = base.label;

		const input = field.querySelector('input');
		input.dataset.key = base.key;
		input.addEventListener('input', () => {
			themeEditor.custom.colors[base.key] = input.value.toUpperCase();
			customThemeChanged();
		});

		colorsContainer.appendChild(field);
	});

	document.getElementById('themeEditorDark').addEventListener('change', e => {
		themeEditor.custom.dark = e.currentTarget.checked;
		customThemeChanged();
	});

	document.getElementById('themeCopy').addEventListener('click', () => {
		navigator.clipboard.writeText(customThemeJson())
			.then(() => notify('די קאלירן זענען קאפירט, דו קענסט זיי שיקן פאר אנדערע'));
	});

	document.getElementById('themeImport').addEventListener('click', importCustomTheme);
}

function updateThemeEditor(){
	const isCustom = themeEditor.themeId === 'custom';
	document.getElementById('themeEditor').classList.toggle('hidden', !isCustom);

	if(!isCustom)
		return;

	document.querySelectorAll('#themeEditorColors input').forEach(input => {
		input.value = themeEditor.custom.colors[input.dataset.key];
	});
	document.getElementById('themeEditorDark').checked = themeEditor.custom.dark;
}

function customThemeChanged(){
	setPreviewColors(customThemeCard(), themeEditor.custom);
	updateThemeEditor();

	// color pickers fire on every drag step, the forum tabs follow along once it settles
	clearTimeout(themeEditor.saveTimeout);
	themeEditor.saveTimeout = setTimeout(() => {
		chrome.storage.local.set({ customTheme: themeEditor.custom });
	}, 250);
}

function customThemeCard(){
	return document.querySelector('.theme-card input[value="custom"]').closest('.theme-card');
}

function customThemeJson(){
	return JSON.stringify(themeEditor.custom, null, 2);
}

function importCustomTheme(){
	const text = document.getElementById('themePaste').value;
	let theme = null;

	// a pasted message may have some text around the JSON
	try {
		theme = sanitizeTheme(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)));
	} catch(e) {}

	if(!theme){
		notify('די קאלירן זענען נישט גוט, פרוביר נאכאמאל');
		return;
	}

	delete theme.id;
	themeEditor.custom = theme;
	document.getElementById('themePaste').value = '';
	customThemeChanged();
	notify();
}

// The whole feature can be turned off, then the colors tab (and the popup section) is hidden
function initThemesToggle(enabled){
	const checkbox = document.getElementById('themesEnabled');
	checkbox.checked = !!enabled;
	showThemesTab(checkbox.checked);

	checkbox.addEventListener('change', () => {
		commitNewSetting({ themesEnabled: checkbox.checked });
		showThemesTab(checkbox.checked);

		// turning it on is usually followed by picking a theme
		if(checkbox.checked)
			location.hash = 'colors';
	});
}

function showThemesTab(enabled){
	document.querySelector('.page-tabs').classList.toggle('hidden', !enabled);
	showTab();
}
