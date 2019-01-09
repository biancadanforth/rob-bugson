"use strict";

/**
 * Content script that runs in the context of github web pages and:
 *
 * 1. susses out PR page and adds "attach to bug" links
 * 2. linkifies bugzilla bug numbers
 */

// Regexp to match against PR title
const BUG_RE = /\b(ticket|bug|tracker item|issue)s?:? *([\d ,\+&#and]+)\b/i;

// Base url for attaching a github pr to a bug
const ATTACH_BASE_URL = 'https://bugzilla.mozilla.org/attachment.cgi?action=enter&bugid=';

// Url for bug lists
const LIST_BASE_URL = 'https://bugzilla.mozilla.org/buglist.cgi?bug_id=';
const BUG_BASE_URL = 'https://bugzilla.mozilla.org/show_bug.cgi?id=';

const ATTACH_CONTAINER_ID = 'robBugsonAttachLinks';
const LIST_CONTAINER_ID = 'robBugsonListLinks';

/**
 * Retrieve the PR number from the pull request page.
 */
function getPRNum() {
    // Get the PR number which is like "#4099"
    var text = document.querySelector('span.gh-header-number').textContent;

    // Peel off the "#" and return
    return text.substring(1);
}


/**
 * Retrieve the PR title from the pull request page.
 */
function getPRTitle() {
    return document.querySelector('span.js-issue-title').textContent.trim();
}


/**
 * Get list of bug ids from PR title
 */
function getBugIds(text) {
    let match = BUG_RE.exec(text);
    let ret;
    if (match) {
        ret = new Set(match[2].split(/\D+/).filter((bugId) => !!bugId));
    } else {
        ret = new Set();
    }
    return Array.from(ret);
}


/**
 * Return array of "bugzilla links"--one for each bug.
 */
function getBugLinks(bugIds){
    return bugIds.map(function(k){
        let bugLink = document.createElement('a');
        bugLink.href = BUG_BASE_URL + k;
        bugLink.target = '_blank';
        bugLink.className = 'bugzilla_link';
        bugLink.appendChild(document.createTextNode(k));
        return bugLink;
    });
}


/**
 * Return array of "attach links"--one for each bug.
 *
 * Attach links are set up with an event listener to sends the data to the
 * background script for opening and manipulating the new tab.
 */
function getAttachLinks(bugIds, prURL, prNum, prTitle) {
    return bugIds.map(function(bugId) {
        let link = document.createElement("a");
        link.href = "#";
        link.className = "bugzilla_link";
        link.addEventListener("click", (event) => {
            // Send a message to the background script. That handles creating a
            // tab, opening the attach page, and filling in the form.
            let url = ATTACH_BASE_URL + bugId;
            browser.runtime.sendMessage({
                "attachUrl": url,
                "prURL": prURL,
                "prNum": prNum,
                "prTitle": prTitle
            });
            event.preventDefault();
        });
        link.className = 'bugzilla_link';
        link.appendChild(document.createTextNode(bugId));
        return link;
    });
}


/**
 * Returns true if the URL is a github pull request page.
 *
 * @param {URL} url
 * @returns {bool}
 */
function isPullRequest(url) {
    return (
        url.origin == "https://github.com"
            && url.pathname.split("/")[3] == "pull"
    );
}


/**
 * Returns true if the URL is a github compare page.
 *
 * @param {URL} url
 * @returns {bool}
 */
function isComparePage(url) {
    return (
        url.origin == "https://github.com"
            && url.pathname.split("/")[3] == "compare"
    );
}


/**
 * Checks if there's already a container and if not, creates one with attach
 * links in it.
 */
function createAttachLinksContainer() {
    // If this is not a pull request page, then return.
    if (!isPullRequest(new URL(window.location.href))) {
        return;
    }

    // If there's already a link container, then return.
    var linkContainer = document.getElementById(ATTACH_CONTAINER_ID);
    if (linkContainer == null) {
        // If there's no link container, then we create a new one
        linkContainer = document.createElement('p');
        linkContainer.id = ATTACH_CONTAINER_ID;
        linkContainer.className = 'subtext';
    }

    // Remove everything from the link container so we don't end up with
    // duplicates
    while (linkContainer.firstChild) {
        linkContainer.removeChild(linkContainer.firstChild);
    }

    let headerShow = document.querySelector('div.gh-header-show');

    var prURL = window.location.href;
    var prNum = getPRNum();
    var prTitle = getPRTitle();

    var bugIds = getBugIds(prTitle);

    if (bugIds.length > 0) {
        linkContainer.appendChild(document.createTextNode('Attach to bug: '));

        var separator = document.createTextNode(', ');
        getAttachLinks(bugIds, prURL, prNum, prTitle).forEach((bugLink, i) => {
            if (i > 0) {
                linkContainer.appendChild(separator.cloneNode(false));
            }
            linkContainer.appendChild(bugLink);
        });
    }

    headerShow.appendChild(linkContainer);
}


function createBugsList(bugIds){
    var bugsListContainer = document.getElementById(LIST_CONTAINER_ID);
    if (bugsListContainer == null) {
        bugsListContainer = document.createElement('p');
        bugsListContainer.id = LIST_CONTAINER_ID;
        bugsListContainer.className = 'subtext';
    }

    // Remove everything from container so we don't have duplicates
    while (bugsListContainer.firstChild) {
        bugsListContainer.removeChild(bugsListContainer.firstChild);
    }
    bugsListContainer.appendChild(document.createTextNode('Bugs in commits ('));

    var openAll = document.createElement('a');
    openAll.href = LIST_BASE_URL + bugIds.join(',');
    openAll.id = 'open_all_bugzilla_links';
    openAll.target = '_blank';
    openAll.appendChild(document.createTextNode('open all'));
    bugsListContainer.appendChild(openAll);
    bugsListContainer.appendChild(document.createTextNode('): '));

    var separator = document.createTextNode(', ');
    getBugLinks(bugIds).forEach(function(bugLink, i){
        if (i > 0) {
            bugsListContainer.appendChild(separator.cloneNode(false));
        }
        bugsListContainer.appendChild(bugLink);
    });

    return bugsListContainer;
}


function addBugListToPage() {
    var url = new URL(window.location.href);
    var parentElement;
    var bugIds;

    // If this is a compare page
    if (isComparePage(url)) {
        bugIds = [];
        let elements = document.querySelectorAll('a.message, div.commit-desc pre');
        Array.prototype.forEach.call(elements, function(el) {
            bugIds = bugIds.concat(getBugIds(el.textContent));
        });
        var insertBeforeEl = document.getElementById('commits_bucket');
        parentElement = insertBeforeEl.parentElement;
        parentElement.insertBefore(createBugsList(bugIds), insertBeforeEl);
        return;
    }

    if (isPullRequest(url)) {
        bugIds = getBugIds(getPRTitle());
        parentElement = document.querySelector('div.gh-header-show');
        parentElement.appendChild(createBugsList(bugIds));
    }
}


// Run for the current page
createAttachLinksContainer();
addBugListToPage();


// Set up an observer to handle pjax loads that might end up on a PR
let pjaxContainer = document.getElementById('js-repo-pjax-container');
const pjaxContainerObserver = new window.MutationObserver((mutations) => {
    createAttachLinksContainer();
    addBugListToPage();
});
pjaxContainerObserver.observe(pjaxContainer, {
    childList: true,
    attributes: false,
    characterData: false
});