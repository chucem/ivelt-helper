// from https://bookmarkify.it/47839
// https://www.ivelt.com/forum/viewtopic.php?f=2&t=14310
// updated to "פרינט אשכול" v2.9: https://www.ivelt.com/forum/viewtopic.php?p=6984498#p6984498
// runs in the page context, so it uses the forum's own jQuery

(function () {
    if (!document.getElementById('page-body')) return; // not the forum, e.g. Cloudflare's check page

    const PRINT_VERSION = 'v2.9';
    const QUOTE_MAX_PX = 250; // long quotes are cut to this height (site uses 550 on screen)
    const REQUEST_DELAY_MS = 400; // small pause between pages, to be gentle on the server

    let showLikes, likeNames, printTag, totalPages, on_page, lastPage, baseUrl;
    let running = false;

    function ltr(t) { return '⁦' + t + '⁩'; } // keep number ranges like 4–6 in order in RTL text

    function pageUrl(page) {
        return baseUrl + '&start=' + (page * 25);
    }

    function cleanPosts() {
        let pageBody = document.querySelector('#page-body');
        while (pageBody.nextSibling) pageBody.parentNode.removeChild(pageBody.nextSibling);
        while (pageBody.previousSibling) pageBody.parentNode.removeChild(pageBody.previousSibling);
        $('#page-body > :not(.post):not(.topic-title):not(.page-number)').remove();

        $('ul.profile-icons, dl.postprofile, div.back2top, div.bg3, .signature').remove();
        // keep only real posts (id like p1234567) – drops ad blocks such as "post_advs" that also start with "p"
        $('.post').filter(function () { return !/^p\d+$/.test(this.id); }).remove();
        // drop duplicates (e.g. if a new reply shifted the pages while loading)
        let seen = {};
        $('.post').each(function () { if (seen[this.id]) $(this).remove(); else seen[this.id] = true; });
        $('.post').removeClass('online'); // remove online-status indicator
        $('.postbody').width('100%');
        if (showLikes) {
            addLikedBy();
        }
        $('.post-buttons').remove();
        // expand all spoilers
        $('.spoilcontent').css('display', 'block');
        $('.spoilbtn').text('▼ ספוילער');
        // attachment/print layout fixes
        $('<style>').text(
            '.print-liked-by{clear:both;margin-top:6px;padding-top:4px;border-top:1px dotted #ccc;font-size:11px;color:#555}' +
            '.print-liked-by .icon{padding-left:3px}' +
            '.postbody .content{overflow:visible!important;max-height:none!important}' +
            // long quotes: cut cleanly at QUOTE_MAX_PX, hide the "ווייז מער..." button/fade
            '.imcger-quote-text{height:auto!important}' +
            '.imcger-quote-text.pq-cut{max-height:' + QUOTE_MAX_PX + 'px!important;overflow:hidden!important;position:relative}' +
            // fade-out at the bottom of a cut quote (like the live site), kept when printing
            '.imcger-quote-text.pq-cut::after{content:"";position:absolute;left:0;right:0;bottom:0;height:70px;' +
                'background:linear-gradient(to bottom,rgba(255,255,255,0),var(--pq-bg,#fff));' +
                '-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
            '.imcger-quote-shadow,.imcger-quote-button{display:none!important}' +
            '.pq-cut-note{text-align:center;font-size:11px;font-weight:bold;color:#666;margin-top:2px}' +
            '.attachbox{float:none!important;display:block!important;width:auto!important;margin:5px 0!important}' +
            '.attachbox dl.file,.attachbox dt,.attachbox dd{float:none!important}' +
            '.postimage{max-width:100%!important;height:auto!important}' +
            '@media print{.postimage{max-height:7in!important;width:auto!important}}' +
            '.print-info{text-align:center;font-size:13px;color:#333;border:1px solid #ccc;border-radius:4px;padding:6px 10px;margin:6px 0 10px}' +
            '.print-info .print-url{direction:ltr;font-size:11px;color:#666;margin-top:3px}' +
            '.print-info .print-ver{font-size:10px;color:#999;margin-top:2px}'
        ).appendTo('head');
        $('.responsive-hide').removeClass('responsive-hide');
        $(".postbody h3:contains('Re:')").remove();
        // shorten long quotes (on every page, not only the one the site already collapsed)
        $('.imcger-quote-text').each(function () {
            $(this).css('height', '');
            if (this.scrollHeight > QUOTE_MAX_PX + 40) { // +40 so we don't cut just one or two lines
                // fade into the quote's own background colour
                let bg = 'rgb(255, 255, 255)';
                for (let el = this; el && el !== document.body; el = el.parentElement) {
                    let c = getComputedStyle(el).backgroundColor;
                    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) { bg = c; break; }
                }
                this.style.setProperty('--pq-bg', bg);
                $(this).addClass('pq-cut');
                $('<div>').addClass('pq-cut-note').text('▼ ציטאט פארקורצערט ▼').insertAfter(this);
            }
        });
        addPrintInfo();
    }

    // a "באדאנקט דורך: name, name" line under each liked post, from the like count's tooltip
    // (postlove puts the names in its title, e.g. "תגובה באדאנקט דורך: name1, name2"), or just "באדאנקט: N"
    function addLikedBy() {
        $('.post').each(function () {
            let likes = $(this).find('.postlove-count:first');
            let count = Number(likes.text()) || 0;
            if (!count) return;
            let title = likes.attr('title') || '';
            let names = title.indexOf(':') >= 0 ? title.slice(title.indexOf(':') + 1).trim() : '';
            let text = likeNames ? 'באדאנקט דורך (' + count + '): ' + (names || '—') : 'באדאנקט: ' + count;
            $('<div>').addClass('print-liked-by')
                .append($('<i>').addClass('icon fa-thumbs-o-up fa-fw').attr('aria-hidden', 'true'))
                .append(document.createTextNode(text))
                .appendTo($(this).find('.postbody:first'));
        });
    }

    function addPrintInfo() {
        let full = on_page === 1 && lastPage === totalPages;
        let pages = on_page === lastPage
            ? 'בלאט ' + on_page + ' פון ' + totalPages
            : 'בלעטער ' + ltr(on_page + '–' + lastPage) + ' פון ' + totalPages;
        let scope = full ? 'דער גאנצער אשכול' : 'נישט דער גאנצער אשכול';
        let posts = $('.post').length + ' תגובות';
        let d = new Date();
        let date = (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear();
        let info = $('<div>').addClass('print-info')
            .append($('<div>').html('<b>' + scope + '</b> · ' + pages + ' · ' + posts + ' · געדרוקט ' + date))
            .append($('<div>').addClass('print-url').text(baseUrl))
            .append($('<div>').addClass('print-ver').text(printTag));
        let title = $('#page-body .topic-title:first');
        if (title.length) title.after(info); else $('#page-body').prepend(info);
    }

    function finish() {
        cleanPosts();
        running = false;
        window.print();
    }

    function loadPage(page) {
        if (page < lastPage) {
            $('#loading-page').text(page);
            loadNextPage(page);
        } else {
            finish();
        }
    }

    function loadNextPage(page) {
        let pageNum = page + 1; // the page being fetched (start = page * 25)
        $.ajax({
            url: pageUrl(page),
            success: function (data) {
                let posts = $('.post', data).not('.pinned').filter(function () {
                    // skip the repeated pinned post, and its hidden copy inside .hide_me
                    return !$(this).closest('.hide_me').length;
                });
                if (!posts.length) { // got a page but no posts – most likely a Cloudflare check page
                    showBlockedPanel(page, pageNum, 'challenge');
                    return;
                }
                $('.post:last').after($('<h3>').addClass('page-number').text('בלאט ' + pageNum));
                $('.page-number:last').after(posts);
                setTimeout(function () { loadPage(pageNum); }, REQUEST_DELAY_MS);
            },
            error: function (xhr) {
                showBlockedPanel(page, pageNum, xhr.status);
            }
        });
    }

    // Panel shown when Ivelt/Cloudflare blocks a page (429 Too Many Requests, 403, check page, etc.)
    function showBlockedPanel(page, pageNum, status) {
        $('#pq-blocked').remove();
        let why = status === 429
            ? 'דער סערווער זאגט "Too Many Requests" (429) – מ\'האט געשיקט צופיל ריקוועסטס נאכאנאנד.'
            : (status === 'challenge'
                ? 'בלאט ' + pageNum + ' איז נישט געקומען ווי עס דארף צו זיין (מסתם א Cloudflare וועריפיקעישאן).'
                : 'בלאט ' + pageNum + ' האט זיך נישט געלאודט (ערראר ' + (status || 'נעטווארק') + ').');
        let btn = 'padding:6px 14px;margin:4px;border:1px solid #999;border-radius:4px;cursor:pointer;font-size:13px;';
        let panel = $('<div id="pq-blocked">').css({
            position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)', 'z-index': 100000,
            background: '#fff', border: '2px solid #c33', 'border-radius': '8px', padding: '16px 20px',
            'max-width': '460px', width: '90%', 'box-shadow': '0 4px 20px rgba(0,0,0,.3)',
            direction: 'rtl', 'text-align': 'right', 'font-size': '14px', 'line-height': '1.5'
        }).append(
            $('<div>').css({'font-weight': 'bold', 'font-size': '16px', 'margin-bottom': '6px'}).text('⚠ דאס לאודן האט זיך אפגעשטעלט ביי בלאט ' + pageNum),
            $('<div>').text(why),
            $('<div>').css('margin-top', '8px').text(
                'געלאודט ביז יעצט: בלעטער ' + ltr(on_page + '–' + page) + '. ' +
                'עפנט אן אייוועלט בלאט אין א נייעם טעב, אויב עס ווייזט זיך ארויס א Cloudflare וועריפיקעישאן – מאכט עס, ' +
                'ווארט א מינוט, און דערנאך קומט צוריק אהער און קליקט "טרייט נאכאמאל".'),
            $('<div>').css('margin', '8px 0').append(
                $('<a>').attr({href: pageUrl(page), target: '_blank', rel: 'noopener'})
                    .css({'font-weight': 'bold'}).text('↗ עפנט בלאט ' + pageNum + ' אין א נייעם טעב')),
            $('<div>').css({'text-align': 'center', 'margin-top': '10px'}).append(
                $('<button type="button">').attr('style', btn + 'background:#105289;color:#fff;border-color:#105289;')
                    .text('טרייט נאכאמאל').on('click', function () {
                        panel.remove();
                        $('#loading-page').text(page);
                        loadNextPage(page); // retry the same page
                    }),
                $('<button type="button">').attr('style', btn + 'background:#eee;')
                    .text('פרינט וואס איז שוין געלאודט').on('click', function () {
                        panel.remove();
                        lastPage = page; // finish with pages on_page..page
                        finish();
                    })
            ),
            $('<div>').css({'font-size': '10px', color: '#999', 'margin-top': '8px', 'text-align': 'center'}).text(printTag)
        );
        $('body').append(panel);
    }

    function startPrint() {
        running = true;
        $('#page-body').before($('<h3>').css({
            'text-align': 'center',
            'font-size': '14px'
        }).text('loading page ').append('<span id="loading-page">')
          .append($('<div>').css({'font-size': '11px', 'color': '#888', 'font-weight': 'normal'}).text(printTag)));
        loadPage(on_page);
    }

    function printThread() {
        if (running) {
            return;
        }

        showLikes = iveltSetting('printShowLikes') === true;
        likeNames = iveltSetting('printLikesStyle') !== 'count';
        printTag = 'פרינט אשכול ' + PRINT_VERSION + (showLikes ? '-L · מיט לייקס' : '');

        totalPages = Number($('.pagination li:not(.next):last').text()) || 1;
        on_page = Number($('.pagination li.active:first').text()) || 1;
        lastPage = totalPages;
        // use the topic-title link (always has t=), so it also works when opened from a ?p= post link
        baseUrl = ($('.topic-title a:first').prop('href') || document.URL).replace(/&start=\d*/, '').replace(/#.*$/, '');

        if (on_page < totalPages) {
            let answer = prompt(printTag + '\r\n\r\nאיר זענט אויף בלאט ' + on_page + ' פון ' + totalPages + '.\r\nביז וועלכן בלאט ווילט איר פרינטן?', totalPages);
            if (answer === null) { // Cancel = do nothing
                return;
            }
            lastPage = Math.max(on_page, Math.min(totalPages, Number(answer) || on_page));
        }
        startPrint();
    }


    function addPrintBtn() {
        let newLi = document.createElement('li');

        let newA = document.createElement('a');
        newA.href = "javascript:void(0);";
        newA.title = "פרינט עטליכע בלעטער / דעם גאנצן אשכול";

        let newI = document.createElement('i');
        newI.className = "icon fa-print fa-fw";
        newI.setAttribute('aria-hidden', 'true');

        let newSpan = document.createElement('span');
        let textNode = document.createTextNode("פרינט עטליכע בלעטער / דעם גאנצן אשכול");
        newSpan.appendChild(textNode);

        newA.appendChild(newI);
        newA.appendChild(newSpan);

        newLi.appendChild(newA);

        let uls = document.querySelectorAll('ul:has(.icon.fa-print.fa-fw)');
        uls.forEach(ul => {
            let clonedNode = newLi.cloneNode(true);
            clonedNode.querySelector('a').addEventListener('click', function (e) {
                e.preventDefault();
                printThread();
            });
            ul.appendChild(clonedNode);
        });
    }

    addPrintBtn();
}());
