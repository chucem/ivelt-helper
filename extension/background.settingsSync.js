// Settings sync: carries the settings over to the user's other computers through
// chrome.storage.sync (the browser's own account sync).
//
// Everything keeps reading the settings from chrome.storage.local; this only mirrors
// a short list of small settings between local and sync. Sync has tight limits
// (100 KB, 8 KB per item, 120 writes a minute), that's why the big and growing keys
// (notificationsSent, debug logs) and whatever belongs to this computer (Drive/Dropbox
// accounts and tokens, debug mode) stay local only.
//
// It's a setting of its own (settingsSync, local only): on for new installs,
// existing users turn it on in the settings page.
//
// Also, the last browser notifications shown on any computer are kept in sync (only there),
// so the same notification doesn't pop up on every computer.

const SETTINGS_SYNC_KEY = 'settingsSync';
const SYNCED_SETTINGS = [
  'hideUserName',
  'alwaysCopyTopic',
  'copyAttachments',
  'getBrowserNotifications',
  'popupSameTab',
  'warnOnLosingPost',
  'keepDrafts',
  'quoteSelection',
  'quoteJumpToReply',
  'backgroundSync',
  'backgroundSyncPosts',
  'backgroundSyncNotifMinutes',
  'cachedTopicMappingExpire',
  'stickyPostButtons',
  'titleOpensUnread',
  'doubleClickLike',
  'ShowMultiNotifs',
  'olderNotifsPlus',
  'upDownArrowKeys',
  'spoilerPolish',
  'copyPostLink',
  'imageResizer',
  'pasteImages',
  'openAttachmentsTab',
  'driveUpload',
  'dropboxUpload',
  'cloudUploadInPms',
  'cloudDropVideos',
  'driveButtonPlace',
  'driveFolderName',
  'printShowLikes',
  'whoLiked',
  'profileCards',
  'printLikesStyle',
  'quoteSourceLink',
  'editorUndo',
  'themesEnabled',
  'theme',
  'customTheme'
];
const SYNC_PUSH_DELAY = 1000; // batch quick changes (a color being picked) into one write
const SENT_NOTIFICATIONS_SYNC_KEY = 'notificationsSentSynced'; // sync only, each computer keeps its full list in local
const SENT_NOTIFICATIONS_SYNC_LIMIT = 100; // about 2 KB

let syncPushKeys = new Set();
let syncPushTimeout;
let lastPushed = {}; // what this computer wrote to sync, so its own echo isn't taken as a change from elsewhere

const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function isSettingsSyncOn(){
  const items = await chrome.storage.local.get(SETTINGS_SYNC_KEY);
  return items[SETTINGS_SYNC_KEY] === true;
}

// Writes the given values into local, only the ones that differ. Returns the keys that changed
async function pullSyncedSettings(values){
  const local = await chrome.storage.local.get(Object.keys(values));
  const changed = {};

  Object.keys(values).forEach(key => {
    if(values[key] !== undefined && !sameValue(values[key], local[key]))
      changed[key] = values[key];
  });

  if(Object.keys(changed).length)
    await chrome.storage.local.set(changed);

  return Object.keys(changed);
}

// Copies the given settings from local into sync, only the ones that differ
// (that's also what stops local and sync from echoing each other forever)
async function pushSyncedSettings(keys){
  if(!keys.length)
    return;

  const [local, synced] = await Promise.all([chrome.storage.local.get(keys), chrome.storage.sync.get(keys)]);
  const changed = {};

  keys.forEach(key => {
    if(local[key] === undefined || sameValue(local[key], synced[key]))
      return;

    // one oversized value shouldn't fail the whole write, it just stays on this computer
    const bytes = new TextEncoder().encode(key + JSON.stringify(local[key])).length;
    if(bytes > chrome.storage.sync.QUOTA_BYTES_PER_ITEM){
      debugLog('settingsSync', `skipped ${key}: ${bytes} bytes`);
      return;
    }

    changed[key] = local[key];
  });

  if(!Object.keys(changed).length)
    return;

  Object.assign(lastPushed, changed);
  try {
    await chrome.storage.sync.set(changed);
  } catch(e) {
    debugLog('settingsSync', `push failed: ${e.message}`);
  }
}

// When turned on: what's already in sync wins, so another computer gets the user's settings,
// and whatever sync doesn't have yet is taken from here. Returns the keys that were brought in
async function startSettingsSync(){
  const synced = await chrome.storage.sync.get(SYNCED_SETTINGS);
  const pulled = await pullSyncedSettings(synced);
  await pushSyncedSettings(SYNCED_SETTINGS.filter(key => !(key in synced)));
  debugLog('settingsSync', `started, pulled: ${pulled.join(', ') || 'nothing'}`);
  return pulled;
}

// The browser notifications already shown on another computer (none when settings sync is off)
async function getNotificationsSentElsewhere(){
  if(!(await isSettingsSyncOn()))
    return [];

  const items = await chrome.storage.sync.get(SENT_NOTIFICATIONS_SYNC_KEY);
  return items[SENT_NOTIFICATIONS_SYNC_KEY] || [];
}

// Adds the notifications this computer shows to the synced list, keeping only the last ones
async function shareSentNotifications(ids){
  if(!ids.length || !(await isSettingsSyncOn()))
    return;

  const items = await chrome.storage.sync.get(SENT_NOTIFICATIONS_SYNC_KEY);
  const sent = (items[SENT_NOTIFICATIONS_SYNC_KEY] || [])
    .filter(id => !ids.includes(id))
    .concat(ids)
    .slice(-SENT_NOTIFICATIONS_SYNC_LIMIT);

  try {
    await chrome.storage.sync.set({ [SENT_NOTIFICATIONS_SYNC_KEY]: sent });
  } catch(e) {
    debugLog('settingsSync', `sharing notifications failed: ${e.message}`);
  }
}

// New installs sync by default, and start from the synced settings before the defaults fill in the rest.
// Existing users keep it off until they turn it on
async function settingsSyncOnInstall(reason){
  const items = await chrome.storage.local.get(SETTINGS_SYNC_KEY);
  if(items[SETTINGS_SYNC_KEY] === undefined)
    await chrome.storage.local.set({ [SETTINGS_SYNC_KEY]: reason === 'install' });

  if(await isSettingsSyncOn())
    await startSettingsSync();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if(area !== 'local' && area !== 'sync')
    return;

  const keys = Object.keys(changes).filter(key => SYNCED_SETTINGS.includes(key));
  if(!keys.length || !(await isSettingsSyncOn()))
    return;

  if(area === 'sync'){
    // changed on another computer
    const values = {};
    keys.forEach(key => {
      // each push comes back here once, only that echo is skipped
      if(!sameValue(changes[key].newValue, lastPushed[key]))
        values[key] = changes[key].newValue;
      delete lastPushed[key];
    });
    pullSyncedSettings(values);
    return;
  }

  keys.forEach(key => syncPushKeys.add(key));
  clearTimeout(syncPushTimeout);
  syncPushTimeout = setTimeout(async () => {
    const keysToPush = [...syncPushKeys];
    syncPushKeys.clear();
    // it may have been turned off in the meantime
    if(await isSettingsSyncOn())
      pushSyncedSettings(keysToPush);
  }, SYNC_PUSH_DELAY);
});

// The settings page turns it on through here, to know if settings were brought in from another computer
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if(request.type !== 'settingsSyncStart')
    return;

  chrome.storage.local.set({ [SETTINGS_SYNC_KEY]: true })
    .then(startSettingsSync)
    .then(pulled => sendResponse({ pulled }))
    .catch(e => sendResponse({ error: e.message }));
  return true;
});
