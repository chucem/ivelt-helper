// Runs in the extension's own world: the settings come straight from its storage
if (document.getElementById('page-body')) chrome.storage.local.get(['backgroundSync', 'backgroundSyncPosts'], function (items) {
    if (window.location.pathname !== '/forum/viewtopic.php') return ;

  // not every viewtopic page is a topic, e.g. Cloudflare's challenge page or an error
  let pagination = document.querySelector("div.pagination");
  let countMatch = pagination && pagination.innerHTML.match(/(\d+) תגובות/);
  let topicLink = document.querySelector("h2.topic-title > a");
  let forumLink = document.getElementsByClassName("left-box arrow-right")[0];
  let posts = document.getElementsByClassName("post has-profile");
  if (!countMatch || !topicLink || !forumLink || !posts.length) return;

  let currentCount = countMatch[1];
  let lastPost = posts[posts.length - 1];

  var topicURL = topicLink.href;
  var topicURLSearch = topicURL.substr(topicURL.indexOf("?"));
  var urlParams = new URLSearchParams(topicURLSearch);
  var topicId = urlParams.get("t");
  var forumURL = forumLink.href;

  function isLastPage() {
    return document.getElementsByClassName("next").length == 0;
  }

  let title = document.title;
  // setting was unchecked by the user

  let backgroundSync = items.backgroundSync === true;
  let backgroundSyncPosts = items.backgroundSyncPosts;
  if (!backgroundSync || !backgroundSyncPosts) return;

  let interval = parseInt(backgroundSyncPosts);
  let notificationElement = null;
  let titleFlashInterval = null;
  let checkNewResponse = function () {
    if (isLastPage() && currentCount > 0) {
      fetch(forumURL)
        .then(function (response) {
          return response.text();
        })
        .then(function (data) {
          var parser = new DOMParser();
          var doc = parser.parseFromString(data, "text/html");
          let topics = Array.from(
            Array.from(doc.getElementsByClassName("forumbg"))
              .pop()
              .getElementsByClassName("topics")[0]
                .querySelectorAll('li.row:has(dl[class*="_unread"])')
          );
          let topic = topics.find((t) => {
            let tHref = t.children[0]?.children[0].children[0].href;
            if (!tHref) return false;
            let tHrefSearch = tHref.substr(tHref.indexOf("?"));
            let tSearch = new URLSearchParams(tHrefSearch);
            let tId = tSearch.get("t");
            if (tId == topicId) return true;
            else return false;
          });
          //If we cannot find the topic in unread list, it means it was read (even in another tab)
          if (!topic) {
            // Topic is read, remove notification if it exists
            if (notificationElement) {
              notificationElement.remove();
              notificationElement = null;
            }
            if (titleFlashInterval) {
              clearInterval(titleFlashInterval);
              titleFlashInterval = null;
              document.title = title;
            }
            return setTimeout(checkNewResponse, interval);
          }
          let newCount =
            topic.children[0]?.children[1]?.firstChild?.textContent?.trim();
          if (currentCount < newCount * 1 + 1) {
            if (!notificationElement || !document.getElementById("ivelt-new-response-notification")) {
              // Remove any existing notification first
              let existingNotification = document.getElementById("ivelt-new-response-notification");
              if (existingNotification) {
                existingNotification.remove();
              }

              lastPost.insertAdjacentHTML(
                "afterend",
                `<h3 id="ivelt-new-response-notification">
                                נייע תגובות זענען צוגעקומען
                                <a class="button" href="/forum/viewtopic.php?t=${topicId}&view=unread#unread">רילאוד</a>
                            </h3>`
              );
              notificationElement = document.getElementById("ivelt-new-response-notification");

              if (!titleFlashInterval) {
                titleFlashInterval = setInterval(function () {
                  document.title =
                    document.title == title ? "\u26B9 " + title : title;
                }, 500);
              }
            }
            currentCount = newCount * 1 + 1;
            setTimeout(checkNewResponse, interval);
          } else {
            setTimeout(checkNewResponse, interval);
          }
        })
        .catch(function (error) {
          interval *= 3;
          setTimeout(checkNewResponse, interval);
        });
    }
  };
  setTimeout(checkNewResponse, interval);
});
