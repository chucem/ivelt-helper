(function(){
	if(!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

	// The settings the scripts in the page's world use (they can't reach chrome.storage): the topic
	// buttons, print, split notifications and editor undo. Only these go on the page.
	const PAGE_SETTINGS = ['alwaysCopyTopic', 'copyAttachments', 'cachedTopicMappingExpire', 'forceUpdateTopicMapCache',
		'quoteSourceLink', 'ShowMultiNotifs', 'printShowLikes', 'printLikesStyle', 'editorUndo'];

	if(chrome.storage){
		chrome.storage.local.get([...PAGE_SETTINGS, 'hideUserName', 'warnOnLosingPost'], function(items){
			if(items.hideUserName){
				let userName = document.querySelector('.header-avatar .username');
				if (userName) {
					userName.dataset.name = userName.innerText;
					userName.innerText = 'הא?';
				}
				let avatar = document.querySelector('.header-avatar .avatar');
				if (avatar)
					avatar.style.display = "none";
			}

			if(items.warnOnLosingPost){
				var form = document.querySelector('form[id="qr_postform"]') || document.querySelector('form[id="postform"]');

				if(form){
					// all action buttons are type=submit
					form.addEventListener('submit', function(){
						window.removeEventListener('beforeunload', avoidLosingPost);
					});

					window.addEventListener('beforeunload', avoidLosingPost);
				}

				let notificationLinks = document.querySelectorAll('#mark_all_notifications a, .pagination a[href*="mark="].mark');
				notificationLinks.forEach (link => {
					link.addEventListener('click', function(event) {
						let confirmation = confirm('זענט איר זיכער אז איר ווילט פארצייכענען אלעס ווי געליינט?');
						if (!confirmation) {
							event.preventDefault();
							event.stopImmediatePropagation();
						}
					}, true);
				});

			}
            
			// as JSON, so they keep their real values (true, 3600, 'names'); one never set is left out
			const pageSettings = {};
			PAGE_SETTINGS.forEach(name => { if(name in items) pageSettings[name] = items[name]; });
			let e = document.createElement('div');
			e.style.display = "none";
			e.setAttribute('id', 'iveltHelperSettings');
			e.dataset.settings = JSON.stringify(pageSettings);
			document.body.appendChild(e);
			// the page scripts wait for this (js/settingsReady.js), DOM events reach the page's world
			document.dispatchEvent(new Event('iveltHelperSettingsReady'));

			if(items.forceUpdateTopicMapCache === true){
				chrome.storage.local.set({ forceUpdateTopicMapCache: false });
			}
		});
	}

	function avoidLosingPost(event){
		var textarea = document.querySelector('textarea[name=message]');

		if(textarea && textarea.value){
			event.preventDefault();
			return event.returnValue = 'Changes you made may not be saved. Are you sure you want to lose your post?';
		}
	}
}())
