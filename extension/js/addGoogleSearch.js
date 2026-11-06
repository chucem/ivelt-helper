function addGoogleSearch(){
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page
    if (window.location.href.includes("viewtopic.php")) {
        // Not every topic page has these (e.g. an error page)
        let titleLink = document.querySelector('.topic-title > a');
        let topicSearch = document.getElementById('search_keywords');
        if (!titleLink || !topicSearch) return;

        // a " in the title would end the exact-title phrase early
        let topicTitle = titleLink.text.replace(/"/g, ' ').trim();
        topicSearch.insertAdjacentHTML('beforebegin', 
            '<input class="inputbox search tiny" style="border-width:1px;border-radius:4px" type="search" id="g_search_keywords" size="20" placeholder="גוגל זוך אין דעם אשכול…">'
        ) 

        document.getElementById('g_search_keywords').addEventListener('keydown' ,function (e) {
            if (e.key === 'Enter') {
                window.open(googleSearchUrl(`intitle:"${topicTitle}" site:www.ivelt.com ${document.getElementById('g_search_keywords').value}`), '_blank')?.focus(); // null when the browser blocks the new tab
                e.preventDefault();
            }
        });

    }
}

addGoogleSearch();

function addGoogleSiteSearch(){
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page
    // Missing on pages without the forum's search box
    let siteSearch = document.getElementById('search');
    if (!siteSearch) return;

    // Built like the forum's own search box under it (same classes), with a Google button in place of its two
    siteSearch.insertAdjacentHTML('beforebegin',
        '<form class="ih-google-search"><fieldset>' +
            '<input id="g_site_search_keywords" type="search" class="inputbox search tiny" size="20" placeholder="גוגל זוך אין אייוועלט…">' +
            '<button class="button button-search-end" type="submit" title="זוך אין גוגל">' +
                '<i class="icon fa-google fa-fw" aria-hidden="true"></i><span class="sr-only">זוך אין גוגל</span>' +
            '</button>' +
        '</fieldset></form>'
    )

    // Enter in the box submits the form too
    siteSearch.previousElementSibling.addEventListener('submit', function (e) {
        e.preventDefault();
        window.open(googleSearchUrl(`site:www.ivelt.com ${document.getElementById('g_site_search_keywords').value}`), '_blank')?.focus(); // null when the browser blocks the new tab
    });
}

// The whole query encoded, so a & or # in the title or the typed words doesn't cut it off
function googleSearchUrl(query){
    return 'https://www.google.com/search?q=' + encodeURIComponent(query.trim());
}

addGoogleSiteSearch();

// On a phone the forum hides the search box above and its navbar has a search icon that only
// links to search.php. That icon opens a search bar under the breadcrumbs instead: the forum's search
// and the Google search on one box, with a gear to the advanced search page. Only the phone
// layout shows the icon (and this bar, css/appcss.css), so the desktop is untouched
function addMobileSearchBar(){
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page
    let iconLink = document.querySelector('.navbar .responsive-search > a'); // at the end of the breadcrumbs
    let siteSearch = document.getElementById('search');
    if (!iconLink || !siteSearch) return;

    let bar = document.createElement('div');
    bar.id = 'ih-mobile-search';
    bar.setAttribute('role', 'search');
    bar.hidden = true;
    bar.innerHTML =
        '<form method="get"><fieldset>' +
            '<input name="keywords" type="search" maxlength="128" class="inputbox search" placeholder="זוך…" title="זוך פאר קיווארדס">' +
            '<button class="button button-search" type="submit" title="זוך">' +
                '<i class="icon fa-search fa-fw" aria-hidden="true"></i><span class="sr-only">זוך</span>' +
            '</button>' +
            '<button class="button button-search ih-mobile-google" type="button" title="זוך אין גוגל">' +
                '<i class="icon fa-google fa-fw" aria-hidden="true"></i><span class="sr-only">זוך אין גוגל</span>' +
            '</button>' +
            '<a class="button button-search-end" role="button" title="פארגעשריטענע זוכעניש">' +
                '<i class="icon fa-cog fa-fw" aria-hidden="true"></i><span class="sr-only">פארגעשריטענע זוכעניש</span>' +
            '</a>' +
        '</fieldset></form>';

    // The forum's own search form says where to go and has the hidden fields (like the session id)
    let form = bar.querySelector('form');
    form.action = siteSearch.action;
    siteSearch.querySelectorAll('input[type="hidden"]').forEach(hidden => form.appendChild(hidden.cloneNode()));
    bar.querySelector('a').href = iconLink.href;
    let input = form.elements.keywords;

    bar.querySelector('.ih-mobile-google').addEventListener('click', function () {
        if (!input.value.trim()) return input.focus();
        window.open(googleSearchUrl(`site:www.ivelt.com ${input.value}`), '_blank')?.focus(); // null when the browser blocks the new tab
    });
    // Nothing typed: the forum would only show an error page (Enter searches the forum)
    form.addEventListener('submit', function (e) {
        if (!input.value.trim()) {
            e.preventDefault();
            input.focus();
        }
    });
    bar.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            bar.hidden = true;
            iconLink.focus();
        }
    });

    iconLink.closest('ul').after(bar);
    iconLink.setAttribute('aria-expanded', 'false');
    iconLink.setAttribute('aria-controls', bar.id);
    iconLink.addEventListener('click', function (e) {
        // A click to open it in a new tab still goes to the search page
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        bar.hidden = !bar.hidden;
        iconLink.setAttribute('aria-expanded', String(!bar.hidden));
        if (!bar.hidden) input.focus();
    });
}

addMobileSearchBar();
