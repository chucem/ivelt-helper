const preferencesOptions = [
	'getBrowserNotifications',
	'popupSameTab',
	'warnOnLosingPost',
	'keepDrafts',
	'quoteSelection',
	'quoteJumpToReply',
	'backgroundSync',
	'backgroundSyncPosts',
	'backgroundSyncNotifMinutes',
	'debugMode',
	"alwaysCopyTopic",
	'cachedTopicMappingExpire',
	'copyAttachments',
	'quoteSourceLink',
	'stickyPostButtons',
	'stickyHeader',
	'compactQuotesMobile',
	'titleOpensUnread',
	'doubleClickLike',
	'ShowMultiNotifs',
	'olderNotifsPlus',
	'splitQuotedNotifs',
	'splitLikedNotifs',
	'splitMentionedNotifs',
	'splitPmNotifs',
	'upDownArrowKeys',
	'spoilerPolish',
	'imageResizer',
	'pasteImages',
	'driveUpload',
	'dropboxUpload',
	'cloudUploadInPms',
	'cloudDropVideos',
	'driveButtonPlace',
	'driveFolderName',
	'openAttachmentsTab',
	'copyPostLink',
	'copyTopicLink',
	'whoLiked',
	'profileCards',
	'printShowLikes',
	'printLikesStyle',
	'editorUndo',
	'multiAccounts',
	'switchReloadsOneTab'
];

// Listen to settings changes
function startListeners(){

	preferencesOptions.forEach(prefName => {
		document.getElementById(prefName).addEventListener('change', (e) => {
			var newSetting = {};

			if(e.currentTarget.type === 'checkbox')
				newSetting[prefName] = !!e.currentTarget.checked;
			else
				newSetting[prefName] = e.currentTarget.value;

			commitNewSetting(newSetting);
			postSettingChange(newSetting);

			if(prefName === 'getBrowserNotifications' && newSetting.getBrowserNotifications)
				startNotificationCheck();
		});
	});

	document.getElementById('forceUpdateTopicMapCache').addEventListener('click', () => {
		chrome.storage.local.set({ forceUpdateTopicMapCache: true }, function () {
			notify();
		});
	});
	showTopicMappingStatus();
	chrome.storage.onChanged.addListener((changes, area) => {
		if(area === 'local' && (changes.topicMappingFetch || changes.forceUpdateTopicMapCache))
			showTopicMappingStatus();
	});
	document.querySelector('.js-copy-logs').addEventListener('click', copyLogs);
	document.getElementById('resetSettings').addEventListener('click', resetSettings);
}

// Under "update the list now": when the commentary topics list was last downloaded (background.js
// records it). The button itself only marks it, the next forum page downloads it, so till then it says so
async function showTopicMappingStatus(){
	const { topicMappingFetch = {}, forceUpdateTopicMapCache } = await chrome.storage.local.get(['topicMappingFetch', 'forceUpdateTopicMapCache']);
	const { updatedAt, failedAt } = topicMappingFetch;
	// isolated, so the browser's (often English) date doesn't get mixed into the Yiddish around it
	const when = time => '⁨' + new Date(time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '⁩';

	let text = updatedAt ? 'לעצט אפדעיטעט ' + when(updatedAt) : '';
	if(failedAt && (!updatedAt || failedAt > updatedAt))
		text += (text ? '. ' : '') + 'דער לעצטער פרואוו (' + when(failedAt) + ') האט נישט געארבעט';
	if(forceUpdateTopicMapCache === true)
		text = 'ווערט אפדעיטעט ווען מען עפנט דעם קומענדיגן בלאט אויפן פארום';
	document.getElementById('topicMappingStatus').textContent = text;
}

// The notification check is off by default (an empty backgroundSyncNotifMinutes). Its checkbox
// turns it on and off, and turning it on starts it at every 5 minutes
const NOTIFICATION_CHECK_START = '5';
// the same for updating the list of commentary topics, an empty cachedTopicMappingExpire is never
const TOPIC_MAPPING_UPDATE_START = '3600';

// A checkbox for a setting that's a time, where an empty time is off
function initTimedCheckbox(checkboxId, prefName, savedValue, startValue){
	const checkbox = document.getElementById(checkboxId);
	const time = document.getElementById(prefName);

	checkbox.checked = !!savedValue;
	// while it's off the list shows what turning it on would start with
	if(!savedValue)
		time.value = startValue;

	checkbox.addEventListener('change', () => {
		if(checkbox.checked)
			time.value = startValue;
		const newSetting = { [prefName]: checkbox.checked ? time.value : '' };
		commitNewSetting(newSetting);
		postSettingChange(newSetting);
	});
}

// Browser notifications need the notification check, so turning them on turns it on too
function startNotificationCheck(){
	const checkbox = document.getElementById('notificationCheck');
	if(checkbox.checked)
		return;

	checkbox.checked = true;
	const newSetting = { backgroundSyncNotifMinutes: NOTIFICATION_CHECK_START };
	document.getElementById('backgroundSyncNotifMinutes').value = NOTIFICATION_CHECK_START;
	commitNewSetting(newSetting);
	postSettingChange(newSetting);
}

// The defaults live in background.js, so it does the reset
function resetSettings(){
	if(!confirm('ביסטו זיכער אז דו ווילסט צוריקשטעלן אלע אנשטעלונגען ווי זיי זענען געווען פון אנהייב?'))
		return;

	chrome.runtime.sendMessage({ type: 'resetSettings' }, () => location.reload());
}

// update fields after a related setting has been changed
function postSettingChange(items){
	if(items.hasOwnProperty('backgroundSync')){
		document.getElementById('backgroundSyncPosts').disabled = !items.backgroundSync;
	}

	if(items.hasOwnProperty('backgroundSyncNotifMinutes')){
		document.getElementById('backgroundSyncNotifMinutes').disabled = !items.backgroundSyncNotifMinutes;
	}

	if(items.hasOwnProperty('cachedTopicMappingExpire')){
		document.getElementById('cachedTopicMappingExpire').disabled = !items.cachedTopicMappingExpire;
	}

	if(items.hasOwnProperty('driveUpload') || items.hasOwnProperty('dropboxUpload')){
		const drive = document.getElementById('driveUpload').checked;
		const dropbox = document.getElementById('dropboxUpload').checked;
		document.getElementById('driveFolderName').disabled = !drive;
		document.getElementById('driveButtonPlace').disabled = !drive && !dropbox;
		document.getElementById('cloudUploadInPms').disabled = !drive && !dropbox;
		document.getElementById('cloudDropVideos').disabled = !drive && !dropbox;
	}

	if(items.hasOwnProperty('printShowLikes')){
		document.getElementById('printLikesStyle').disabled = !items.printShowLikes;
	}

	if(items.hasOwnProperty('multiAccounts')){
		document.getElementById('switchReloadsOneTab').disabled = !items.multiAccounts;
	}

	// only means something with the bells split
	if(items.hasOwnProperty('ShowMultiNotifs')){
		['olderNotifsPlus', 'splitQuotedNotifs', 'splitLikedNotifs', 'splitMentionedNotifs', 'splitPmNotifs']
			.forEach(id => document.getElementById(id).disabled = !items.ShowMultiNotifs);
	}

	// on unless turned off
	if(items.hasOwnProperty('quoteSelection')){
		document.getElementById('quoteJumpToReply').disabled = items.quoteSelection === false;
	}

	if(items.hasOwnProperty('debugMode')){
		document.querySelector('.js-copy-logs').classList.toggle('hidden', !items.debugMode);
	}
}

function copyLogs(){
	chrome.storage.local.get(null, items => {
		chrome.storage.local.getBytesInUse(inUse => {
			let logs = [navigator.userAgent, `Bytes in use: ${inUse}, QUOTA_BYTES: ${chrome.storage.local.QUOTA_BYTES}, QUOTA_BYTES_PER_ITEM: ${chrome.storage.local.QUOTA_BYTES_PER_ITEM}`];
			Object.keys(items).forEach(key => {
				if(key.indexOf('debug-') === 0)
					logs.push(key + ' -> ' + items[key]);
			});
			navigator.clipboard.writeText(logs.join('\n'))
				.then(() => notify('די לאגס זענען קאפירט געווארן'));
		});
	});
}



// Saves settings to chrome.storage
function commitNewSetting(nameValue){

	chrome.storage.local.set(nameValue, function() {
		// Let user know options were saved.
		notify();
	});
}

function notify(message){
	const fadeTarget = document.getElementById('notify');
	fadeTarget.innerHTML = message || 'די אנשטעלונגען זענען געסעיווט געווארן';
	fadeTarget.classList.add('fade');
	setTimeout(function() {
		fadeTarget.classList.remove('fade');
	}, 3650);
}

function initSettings() {

	// Get all preferences from storage to set fields as needed
	chrome.storage.local.get(null, function(items) {

		preferencesOptions.forEach(prefName => {
			const element = document.getElementById(prefName);

			if(element.type === 'checkbox')
				element.checked = items[prefName];
			else
				element.value = items[prefName];
		});

		initTimedCheckbox('notificationCheck', 'backgroundSyncNotifMinutes', items.backgroundSyncNotifMinutes, NOTIFICATION_CHECK_START);
		initTimedCheckbox('topicMappingUpdate', 'cachedTopicMappingExpire', items.cachedTopicMappingExpire, TOPIC_MAPPING_UPDATE_START);
		postSettingChange(items);

		initThemePicker(items.theme, items.customTheme);
		initThemesToggle(items.themesEnabled);
		initSettingsSyncToggle(items.settingsSync);

		startListeners();
	});
}

// The syncing itself is done in the background. Turning it on may bring in the settings
// from another computer, then the page is reloaded to show them
function initSettingsSyncToggle(enabled){
	const checkbox = document.getElementById('settingsSync');
	checkbox.checked = !!enabled;

	checkbox.addEventListener('change', () => {
		if(!checkbox.checked){
			commitNewSetting({ settingsSync: false });
			return;
		}

		chrome.runtime.sendMessage({ type: 'settingsSyncStart' }, response => {
			if(chrome.runtime.lastError || !response || response.error){
				checkbox.checked = false;
				notify('עס האט נישט געקלאפט, פרוביר נאכאמאל');
				return;
			}

			if(response.pulled.length){
				notify('די אנשטעלונגען פון דיינע אנדערע קאמפיוטערס זענען אריינגעברענגט געווארן');
				setTimeout(() => location.reload(), 1500);
			}
			else
				notify();
		});
	});
}

// The page has tabs, the hash picks one (settings.html#colors) so it can be linked to
function showTab(){
	const tabsShown = !document.querySelector('.page-tabs').classList.contains('hidden');
	const tabName = tabsShown && document.getElementById('tab-' + location.hash.slice(1)) ? location.hash.slice(1) : 'settings';

	document.querySelectorAll('.tab-panel').forEach(panel => {
		panel.classList.toggle('hidden', panel.id !== 'tab-' + tabName);
	});
	document.querySelectorAll('.page-tabs a').forEach(link => {
		link.classList.toggle('active', link.dataset.tab === tabName);
	});
}

// The version under the title, from the manifest (version_name has the beta number)
function showVersion(){
	const manifest = chrome.runtime.getManifest();
	document.getElementById('version').textContent = manifest.version_name || manifest.version;
}

// Where it was installed from: the store's update URL tells Chrome Web Store from Edge Add-ons,
// an unpacked folder is a zip from GitHub (or a copy of the code)
const installSources = {
	chrome: { name: 'Chrome Web Store', link: 'https://chromewebstore.google.com/detail/ivelt-helper-v2/ahidenbhdkloaingggdcijofobjboopi' },
	edge: { name: 'Edge Add-ons', link: 'https://microsoftedge.microsoft.com/addons/detail/ivelt-helper-v2/hnklcnfpeamfiflmpnmjphigmbjoeknc' },
	github: { name: 'GitHub', link: 'https://github.com/chucem/ivelt-helper/releases' },
};

async function getInstallSource(){
	const self = await chrome.management.getSelf();
	if(self.installType === 'development')
		return 'github';
	if(/edge\.microsoft\.com/.test(self.updateUrl))
		return 'edge';
	if(/google\.com/.test(self.updateUrl))
		return 'chrome';
	return null;
}

// "2.7.0-beta.6" > "2.7.0-beta.5", and "2.7.0" > "2.7.0-beta.6"
function compareVersions(a, b){
	const [aMain, aPre] = a.replace(/^v/, '').split('-');
	const [bMain, bPre] = b.replace(/^v/, '').split('-');
	const aParts = aMain.split('.').map(Number), bParts = bMain.split('.').map(Number);
	for(let i = 0; i < Math.max(aParts.length, bParts.length); i++){
		if((aParts[i] || 0) !== (bParts[i] || 0))
			return (aParts[i] || 0) - (bParts[i] || 0);
	}
	if(!aPre || !bPre)
		return !aPre - !bPre;
	return aPre.localeCompare(bPre, undefined, { numeric: true });
}

// The ID the manifest's "key" gives: a copy of the code (dev) and test build zips keep the key,
// release zips drop it (release.yml). So a dev copy checks for test builds even right after a
// release, when its version has no "-beta" yet
const BETA_EXTENSION_ID = 'mkhocmhicodbokdhfjgamkhebdelcdaa';

// The stores check through the browser, which also downloads the update.
// GitHub: the newest release, test builds (prereleases) only for someone already on one.
// Gives { update, checkedAt }: checkedAt only when the answer is from an earlier check
async function checkForUpdate(source, installed){
	if(source === 'github'){
		const response = await fetch('https://api.github.com/repos/chucem/ivelt-helper/releases?per_page=20');
		if(!response.ok)
			throw new Error(response.status);
		const onPrerelease = installed.includes('-') || chrome.runtime.id === BETA_EXTENSION_ID;
		const newest = (await response.json())
			.filter(release => !release.draft && (onPrerelease || !release.prerelease))
			.sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
		if(newest && compareVersions(newest.tag_name, installed) > 0)
			return { update: { version: newest.tag_name.replace(/^v/, ''), link: newest.html_url } };
		return { update: null };
	}

	// After each check Chrome answers "throttled" for a while, longer each time, until it restarts.
	// So the last real answer is kept for then, in session storage, which also empties on a restart
	// (and when the extension updates)
	const { status, version } = await chrome.runtime.requestUpdateCheck();
	if(status === 'throttled'){
		const { lastUpdateCheck } = await chrome.storage.session.get('lastUpdateCheck');
		if(!lastUpdateCheck)
			throw new Error(status);
		return lastUpdateCheck;
	}
	const answer = { update: status === 'update_available' ? { version } : null };
	await chrome.storage.session.set({ lastUpdateCheck: { ...answer, checkedAt: Date.now() } });
	return answer;
}

async function showInstallSource(){
	const manifest = chrome.runtime.getManifest();
	const sourceLine = document.getElementById('installSource');
	const statusLine = document.getElementById('updateStatus');

	const source = await getInstallSource();
	if(!source)
		return;

	const sourceLink = document.createElement('a');
	sourceLink.href = installSources[source].link;
	sourceLink.target = '_blank';
	sourceLink.textContent = installSources[source].name;
	sourceLine.append('אינסטאלירט פון ', sourceLink);

	statusLine.textContent = 'מ\'קוקט צי ס\'איז דא א נייע ווערסיע…';
	let update, checkedAt;
	try {
		({ update, checkedAt } = await checkForUpdate(source, manifest.version_name || manifest.version));
	}
	catch(e){
		statusLine.textContent = 'מ\'קען יעצט נישט נאכקוקן פאר א נייע ווערסיע';
		return;
	}

	// when it was checked, in the tooltip: an answer can be from an earlier check
	statusLine.title = 'לעצט נאכגעקוקט ' + new Date(checkedAt || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

	if(!update){
		statusLine.textContent = 'דאס איז די לעצטע ווערסיע';
		return;
	}

	const version = document.createElement('bdi');
	version.textContent = update.version;
	const action = document.createElement('a');
	if(update.link){
		action.href = update.link;
		action.target = '_blank';
		action.textContent = 'נעמט עס אראפ';
	}
	else {
		// the browser has it already, a reload puts it in. That closes this page, and the new
		// version opens it again (reopenSettingsAfterUpdate in background.js)
		action.href = '#';
		action.textContent = 'אפדעיט יעצט';
		action.title = 'לייג אריין די נייע ווערסיע. דער בלאט מאכט זיך צו און עפנט זיך ווידער מיט דער נייער ווערסיע';
		action.addEventListener('click', async e => {
			e.preventDefault();
			await chrome.storage.local.set({ reopenSettingsUntil: Date.now() + 60 * 1000 });
			chrome.runtime.reload();
		});
	}
	statusLine.replaceChildren('ס\'איז דא א נייע ווערסיע ', version, ' – ', action);
}

// A link to one setting (settings.html#stickyHeader, from the what's-new pop-up) scrolls to its
// row and marks it for a few seconds, so it's found at once
function showLinkedSetting(){
	const id = decodeURIComponent(location.hash.slice(1));
	const field = id && document.getElementById(id);
	const row = field && field.closest('#tab-settings .row');
	if(!row) return;
	row.scrollIntoView({ block: 'center' });
	row.classList.remove('setting-target', 'setting-target-fade');
	row.classList.add('setting-target');
	setTimeout(() => row.classList.add('setting-target-fade'), 2500);
	setTimeout(() => row.classList.remove('setting-target', 'setting-target-fade'), 4500);
}

// The filter box: only the settings with all the words typed show, with their group's heading.
// Hebrew letters are matched without their final forms, so "אשכול" finds "אשכולות" too
function initSettingsFilter(){
	const input = document.getElementById('settingsFilter');
	const none = document.getElementById('settingsFilterNone');
	const panel = document.getElementById('tab-settings');
	const fold = text => text.toLowerCase().replace(/[ךםןףץ]/g, c => 'כמנפצ'['ךםןףץ'.indexOf(c)]);
	const rows = [...panel.querySelectorAll('.row')].filter(row => !row.closest('.settings-filter'));
	const filter = () => {
		const words = fold(input.value).split(/\s+/).filter(Boolean);
		let shown = 0;
		rows.forEach(row => {
			const match = words.every(word => fold(row.textContent).includes(word));
			row.classList.toggle('filtered-out', !match);
			if(match) shown++;
		});
		panel.querySelectorAll('.settings-group, .row-pair').forEach(box => {
			box.classList.toggle('filtered-out', !box.querySelector('.row:not(.filtered-out)'));
		});
		none.classList.toggle('hidden', shown > 0);
	};
	input.addEventListener('input', filter);
	// Escape clears it
	input.addEventListener('keydown', e => {
		if(e.key === 'Escape' && input.value){
			input.value = '';
			filter();
		}
	});
}

// A "ניי" tag on the settings that the what's-new entry of this version (or the newest one before
// it) names, from js/whatsNew.data.js: what the update just added is found at once
function markNewSettings(){
	if(typeof whatsNewReleases !== 'object') return;
	const current = chrome.runtime.getManifest().version.split('.').map(Number);
	const older = v => {
		const parts = v.split('.').map(Number);
		for(let i = 0; i < Math.max(parts.length, current.length); i++){
			const diff = (parts[i] || 0) - (current[i] || 0);
			if(diff) return diff < 0;
		}
		return true;
	};
	const latest = Object.keys(whatsNewReleases).filter(older)
		.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
	const release = latest && whatsNewReleases[latest];
	if(!release) return;
	[...(release.features || []), ...(release.fixes || [])].forEach(item => {
		const field = item && item.setting && document.getElementById(item.setting);
		const label = field && (field.closest('.row').querySelector(`label[for="${item.setting}"]`) || field.closest('.row').querySelector('label'));
		if(!label || label.querySelector('.new-tag')) return;
		const tag = document.createElement('span');
		tag.className = 'new-tag';
		tag.textContent = 'ניי';
		tag.title = 'ניי אין ווערסיע ' + latest;
		label.prepend(tag, ' ');
	});
}

window.addEventListener('hashchange', showTab);
window.addEventListener('hashchange', showLinkedSetting);
document.addEventListener('DOMContentLoaded', initSettingsFilter);
document.addEventListener('DOMContentLoaded', markNewSettings);
// the what's-new pop-up again, also after it was closed (js/whatsNew.js)
document.addEventListener('DOMContentLoaded', () => {
	document.getElementById('showWhatsNew').addEventListener('click', e => {
		e.preventDefault();
		if(window.ihShowWhatsNew) window.ihShowWhatsNew();
	});
});
document.addEventListener('DOMContentLoaded', () => setTimeout(showLinkedSetting));
document.addEventListener('DOMContentLoaded', showVersion);
document.addEventListener('DOMContentLoaded', showInstallSource);
document.addEventListener('DOMContentLoaded', showTab);
document.addEventListener('DOMContentLoaded', initSettings);
