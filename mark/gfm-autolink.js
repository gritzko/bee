"use strict";
//  LITE-031: GFM extended autolinks — a sweep over the parsed text nodes for
//  `www.`, `http(s)://` and emails, after cmark-gfm's extensions/autolink.c.

var Node = require("mark/node.js");

var reSpace = /\s/;
var reAlnum = /[A-Za-z0-9]/;
var reAlpha = /[A-Za-z]/;
var reLocal = /[A-Za-z0-9.+_-]/;
var reScheme = /^https?:\/\//i;
//  a host char is anything but a space and ASCII punctuation
var reHostStop = /[\s!-\/:-@\[-`{-~]/;
var TRIM = "?!.,:*_~'\"";

//  cmark's check_domain: dot-separated host chars, no `_` in the last two
//  segments, and (unless allowShort) at least one dot.  Returns a length.
var checkDomain = function(s, start, allowShort) {
    var np = 0, uscore1 = 0, uscore2 = 0;
    var i = start + 1;
    var c;
    for (; i < s.length - 1; i++) {
        c = s.charAt(i);
        if (c === "\\" && i < s.length - 2) {
            c = s.charAt(++i);
        }
        if (c === "_") {
            uscore2++;
        } else if (c === ".") {
            uscore1 = uscore2;
            uscore2 = 0;
            np++;
        } else if (reHostStop.test(c) && c !== "-") {
            break;
        }
    }
    if ((uscore1 > 0 || uscore2 > 0) && np <= 10) {
        return 0;
    }
    return allowShort || np ? i - start : 0;
};

//  cmark's autolink_delim: `<` ends the link, then trailing punctuation, an
//  unbalanced `)` and an `&entity;`-shaped tail come off the end.
var trimDelim = function(s, start, end) {
    var opening = 0, closing = 0;
    var i, c, ne;
    for (i = start; i < end; i++) {
        c = s.charAt(i);
        if (c === "<") {
            end = i;
            break;
        } else if (c === "(") {
            opening++;
        } else if (c === ")") {
            closing++;
        }
    }
    while (end > start) {
        c = s.charAt(end - 1);
        if (c === ")") {
            if (closing <= opening) {
                return end;
            }
            closing--;
            end--;
        } else if (TRIM.indexOf(c) >= 0) {
            end--;
        } else if (c === ";") {
            ne = end - 2;
            while (ne > start && reAlpha.test(s.charAt(ne))) {
                ne--;
            }
            if (ne < end - 2 && s.charAt(ne) === "&") {
                end = ne;
            } else {
                end--;
            }
        } else {
            return end;
        }
    }
    return end;
};

var toSpace = function(s, start) {          // non-space non-`<` tail
    var end = start;
    while (end < s.length && !reSpace.test(s.charAt(end)) &&
           s.charAt(end) !== "<") {
        end++;
    }
    return end;
};

var matchWww = function(s, i) {
    //  only at a line start, after whitespace, or after `*`, `_`, `~`, `(`
    var before = i > 0 ? s.charAt(i - 1) : "";
    if (i > 0 && "*_~(".indexOf(before) < 0 && !reSpace.test(before)) {
        return null;
    }
    var len = checkDomain(s, i, false);
    if (len === 0) {
        return null;
    }
    var end = trimDelim(s, i, toSpace(s, i + len));
    return end === i ? null :
        { start: i, end: end, url: "http://" + s.slice(i, end) };
};

var matchUrl = function(s, i) {
    var m = reScheme.exec(s.slice(i));
    if (m === null || (i > 0 && reAlpha.test(s.charAt(i - 1)))) {
        return null;
    }
    var after = i + m[0].length;
    if (after >= s.length || reHostStop.test(s.charAt(after))) {
        return null;
    }
    var len = checkDomain(s, after, true);
    if (len === 0) {
        return null;
    }
    var end = trimDelim(s, i, toSpace(s, after + len));
    return end === i ? null : { start: i, end: end, url: s.slice(i, end) };
};

//  `at` is an `@`: rewind over the local part (a `mailto:`/`xmpp:` protocol
//  included), then take the dotted domain forward.
var matchEmail = function(s, at, barrier) {
    var start = at;
    var xmpp = false, mailto = true;
    var proto, before;
    while (start > barrier && reLocal.test(s.charAt(start - 1))) {
        start--;
    }
    if (start === at) {
        return null;
    }
    proto = s.slice(barrier, start);
    before = /(mailto:|xmpp:)$/.exec(proto);
    if (before !== null &&
        !reAlnum.test(proto.charAt(proto.length - before[1].length - 1))) {
        start -= before[1].length;
        mailto = false;
        xmpp = before[1] === "xmpp:";
    }
    var np = 0, end = at + 1, c;
    for (; end < s.length; end++) {
        c = s.charAt(end);
        if (reAlnum.test(c)) {
            continue;
        }
        if (c === "." && end + 1 < s.length && reAlnum.test(s.charAt(end + 1))) {
            np++;
        } else if (c === "/" && xmpp) {
            continue;
        } else if (c !== "-" && c !== "_") {
            break;
        }
    }
    c = s.charAt(end - 1);
    if (end - at < 2 || np === 0 || (!reAlpha.test(c) && c !== ".")) {
        return null;
    }
    end = trimDelim(s, at, end);
    if (end === at) {
        return null;
    }
    return {
        start: start,
        end: end,
        url: (mailto ? "mailto:" : "") + s.slice(start, end)
    };
};

//  Every link in one string, left to right, no two overlapping.
var findLinks = function(s) {
    var out = [];
    var i = 0, barrier = 0, m, c;
    while (i < s.length) {
        c = s.charAt(i);
        m = null;
        if (c === "w" || c === "W") {
            if (s.substr(i, 4).toLowerCase() === "www.") {
                m = matchWww(s, i);
            }
        } else if (c === "h" || c === "H") {
            m = matchUrl(s, i);
        } else if (c === "@") {
            m = matchEmail(s, i, barrier);
        }
        if (m === null) {
            i++;
        } else {
            out.push(m);
            i = barrier = m.end;
        }
    }
    return out;
};

var textNode = function(literal) {
    var node = new Node("text");
    node._literal = literal;
    return node;
};

//  A run of adjacent text nodes is scanned as ONE string — inline parsing
//  splits text at entities and stray brackets — and rebuilt only if it links.
var sweepRun = function(run) {
    var i, s = "";
    for (i = 0; i < run.length; i++) {
        s += run[i]._literal;
    }
    var links = findLinks(s);
    if (links.length === 0) {
        return;
    }
    var at = 0;
    var anchor = run[0];
    for (i = 0; i < links.length; i++) {
        if (links[i].start > at) {
            anchor.insertBefore(textNode(s.slice(at, links[i].start)));
        }
        var link = new Node("link");
        link._destination = links[i].url;
        link._title = "";
        link.appendChild(textNode(s.slice(links[i].start, links[i].end)));
        anchor.insertBefore(link);
        at = links[i].end;
    }
    if (at < s.length) {
        anchor.insertBefore(textNode(s.slice(at)));
    }
    for (i = 0; i < run.length; i++) {
        run[i].unlink();
    }
};

var autolink = function(node) {
    if (node.type === "link" || !node.isContainer) {   // no links in links
        return node;
    }
    var child = node.firstChild;
    var run, last;
    while (child) {
        if (child.type !== "text") {
            child = child.next;
            continue;
        }
        run = [child];
        last = child;
        while (last.next !== null && last.next.type === "text") {
            last = last.next;
            run.push(last);
        }
        child = last.next;
        sweepRun(run);
    }
    for (child = node.firstChild; child; child = child.next) {
        autolink(child);
    }
    return node;
};

module.exports = autolink;
