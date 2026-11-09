const origin = 'https://www.ivelt.com/';

var queue = [];
var queueTimer = null;

chrome.notifications.onClicked.addListener(function(notifId) {

  if(!notifId.includes('-'))
    return;

  const paramValues = notifId.split('-');
  const link = `${origin}forum/index.php?mark_notification=${paramValues[0]}&hash=${paramValues[1]}`;
  
  // open tab to url
  chrome.tabs.create({url: link}, tab => {
    // focus window
    chrome.windows.update(tab.windowId, {focused: true});
    // remove notification from feed
    chrome.notifications.clear(notifId);
  });
});

function parseAndSendNotifications(data){
  var unreadElements = getTagContent(data, 'li', 'row bg3');
  var storeOnly = false;

  chrome.storage.local.get(['notificationsSent', 'isFreshInstall'], async items => {

    debugLog('isFreshInstall', items.isFreshInstall);

    if(items.isFreshInstall){
      chrome.storage.local.remove('isFreshInstall');
      storeOnly = true;
    }

    if(!unreadElements.length){
      return;
    }

    // already shown on another computer (with settings sync on)
    const sentElsewhere = await getNotificationsSentElsewhere();

    var unread = unreadElements.map(item => {

      const href = getAttrValue(item, 'a', 'href');
      let notificationParts = getTagContent(item, 'p', 'notifications_title', true)[0].split(':');
      const time = getTagContent(item, 'p', 'notifications_time', true)[0];
      let id;

      // not all notifications have a link
      if(href){
        const url = new URL(htmlToText(href).replace('./', origin + 'forum/')); // to text for htmlized "&"
        id = url.searchParams.get('mark_notification') + '-' + url.searchParams.get('hash');
      }
      else {
        id = getAttrValue(item, 'input', 'value');
      }

      debugLog(id, notificationParts[0].substr(0, 10));

      return {
        title: notificationParts.shift(),
        message: notificationParts.join(':'),
        subMessage: time,
        id: id
      }
    });
    
    const sent = sentIds(items.notificationsSent);

    // filter sent items, and ones already waiting in the queue
    unread = unread.filter(u => {
      debugLog(u.id, 'Was already sent: ' + sent.includes(u.id));
      return !sent.includes(u.id) && !queue.some(q => q.id === u.id);
    });

    if(!unread.length)
      return;

    // dont send the initial batch, only remember it
    if(storeOnly){
      debugLog(unread[0].id, 'storeOnly: saving ' + unread.length);
      saveSentIds(sent.concat(unread.map(u => u.id)));
      return;
    }

    // already shown on another computer: remember them here too, but dont show them twice
    const shownElsewhere = unread.filter(u => sentElsewhere.includes(u.id));
    shownElsewhere.forEach(u => debugLog(u.id, 'Was sent on another computer'));
    if(shownElsewhere.length)
      saveSentIds(sent.concat(shownElsewhere.map(u => u.id)));

    unread.filter(u => !sentElsewhere.includes(u.id)).forEach(u => queueNotification(u));
  });
}

// keep only the newest ids, a check never sees more than one page of notifications
const maxSentIds = 250;

function sentIds(stored){
  return stored ? stored.split(',') : [];
}

function saveSentIds(ids){
  chrome.storage.local.set({ 'notificationsSent': ids.slice(-maxSentIds).join(',') });
}

// remember an id only once its notification was shown, so a failed one is retried on the next check
function markSent(id){
  chrome.storage.local.get(['notificationsSent'], items => {
    const sent = sentIds(items.notificationsSent);
    if(!sent.includes(id))
      saveSentIds(sent.concat(id));
  });
  shareSentNotifications([id]);
}

// send one browser notification at a time, every 10 seconds
function queueNotification(notification){

  debugLog(notification.id, 'Queing notification');

  queue.push(notification);

  if(!queueTimer){
    queueTimer = setInterval(function(){
      if(queue.length)
        sendBrowserNotification(queue.shift());
      else{
        clearInterval(queueTimer);
        queueTimer = null;
      }
    }, 10000);
  }
}

function sendBrowserNotification(item){
  debugLog(item.id, 'Sending notification');
  chrome.notifications.create(item.id, {
    type: 'basic',
    // bundled icon: the site's own icon gets a Cloudflare challenge, which makes create() fail
    iconUrl: chrome.runtime.getURL('img/icon128.png'),
    title: item.title,
    message: item.message,
    contextMessage: item.subMessage,
    priority: 2
  }, () => {
    if(chrome.runtime.lastError){
      debugLog(item.id, 'Notification failed: ' + chrome.runtime.lastError.message);
      return;
    }
    markSent(item.id);
  });
}

function getTagContent(string, tag, className, textOnly){

  const startEl = `<${tag} class="${className}">`;
  const endEl = `</${tag}>`;

  var splitted = string.split(startEl);

  // remove value before the tag
  splitted.shift();

  splitted = splitted.map(s => {

    var content = s.split(endEl)[0];

    if(textOnly)
      return htmlToText(content);

    return startEl + content + endEl;
  });

  return splitted;
}

function getAttrValue(string, tag, attr){
  const match = string.match(new RegExp(`<${tag}.*${attr}="([^"]+)"`));
  return match && match[1];
}

function htmlToText(string){
  return string.replace(/<[^>]*>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, '')
    .trim();
}