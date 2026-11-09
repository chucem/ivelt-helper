/**
*
* @package External Links Open in New Window
* @copyright (c) 2014 RMcGirr83
* @license http://opensource.org/licenses/gpl-2.0.php GNU General Public License v2
*
*/

(function($) { // Avoid conflicts with other libraries

	'use strict';

	var removeSubdomain = function (a,b){return a.split(".").slice(-(b||2)).join(".")};

	var source=removeSubdomain(location.hostname);
	var IgnoreClasses = [
		'posterip',
		'share-button',
		'fancybox',
		'lightbox',
		'colorbox'
	];
	var NotInClass = true;

	/**
	 * DOM READY
	 */
	$(function() {

		$('a[href^="http://"], a[href^="https://"], a[href^="ftp://"]').filter(function(){
			if ($(this).parents($("div")).is('.content, .signature') && this.hostname&&removeSubdomain(this.hostname)!==source)
			{
				$(this).attr("title", elonw_title).addClass("elonw");
			}
		});

		$(document).on('click',('a[href^="http://"], a[href^="https://"], a[href^="ftp://"]'), function() {
			if ($(this).attr('class') !== undefined)
			{
				var ClassList = $(this).attr('class').split(/\s+/);
				$(ClassList).each(function() {
					if($.inArray(this, IgnoreClasses) !== -1)
					{
						NotInClass = false;
					}
				});
			}
			if ($(this).attr('onclick') !== undefined)
			{
				NotInClass = false;
			}
			var href = $(this).attr('href');
			if(this.hostname && removeSubdomain(this.hostname)!==source && NotInClass)
			{
				window.open(href, '_blank', 'noreferrer, noopener');
				return false;
			}
		});

		$('.forum_link').each(function(){
			var href = $(this).attr('href');
			if (this.hostname && removeSubdomain(this.hostname)!==source)
			{
				$(this).attr("onclick","window.open(this.href);return false;").attr("rel", "nofollow, noreferrer, noopener");
			}
		});

	});

})(jQuery); // Avoid conflicts with other libraries
