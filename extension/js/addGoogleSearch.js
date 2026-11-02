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
                window.open(googleSearchUrl(`intitle:"${topicTitle}" site:www.ivelt.com ${document.getElementById('g_search_keywords').value}`), '_blank').focus();
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
        window.open(googleSearchUrl(`site:www.ivelt.com ${document.getElementById('g_site_search_keywords').value}`), '_blank').focus();
    });
}

// The whole query encoded, so a & or # in the title or the typed words doesn't cut it off
function googleSearchUrl(query){
    return 'https://www.google.com/search?q=' + encodeURIComponent(query.trim());
}

addGoogleSiteSearch();
