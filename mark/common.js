"use strict";

//  LITE-030: entities.decodeHTMLStrict, an INTERIM stub — numeric references
//  in full, a short named table, every other `&name;` left verbatim as-is.
var fromCodePoint = require("mark/from-code-point.js");

var NAMED = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
    shy: "­", ndash: "–", mdash: "—", hellip: "…",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    laquo: "«", raquo: "»", bull: "•", middot: "·",
    dagger: "†", Dagger: "‡", permil: "‰", sect: "§",
    para: "¶", copy: "©", reg: "®", trade: "™",
    deg: "°", plusmn: "±", times: "×", divide: "÷",
    minus: "−", ne: "≠", le: "≤", ge: "≥",
    frac12: "½", frac14: "¼", frac34: "¾",
    micro: "µ", sup2: "²", sup3: "³",
    cent: "¢", pound: "£", yen: "¥", euro: "€",
    curren: "¤", iexcl: "¡", iquest: "¿", not: "¬",
    larr: "←", uarr: "↑", rarr: "→", darr: "↓",
    harr: "↔", infin: "∞", ll: "≪", gg: "≫",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ",
    lambda: "λ", mu: "μ", pi: "π", sigma: "σ",
    omega: "ω", Omega: "Ω", Delta: "Δ", Sigma: "Σ",
    agrave: "à", aacute: "á", acirc: "â", atilde: "ã",
    auml: "ä", aring: "å", aelig: "æ", AElig: "Æ",
    ccedil: "ç", egrave: "è", eacute: "é", ecirc: "ê",
    euml: "ë", igrave: "ì", iacute: "í", ntilde: "ñ",
    ograve: "ò", oacute: "ó", ouml: "ö", oslash: "ø",
    ugrave: "ù", uacute: "ú", uuml: "ü", szlig: "ß",
    Eacute: "É", Ouml: "Ö", Auml: "Ä", Uuml: "Ü"
};

var decodeHTMLStrict = function(s) {
    if (s.charCodeAt(0) !== 38 || s.charCodeAt(s.length - 1) !== 59) {
        return s;
    }
    var body = s.slice(1, -1);
    if (body.charCodeAt(0) === 35) {
        var hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
        var cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!(cp > 0) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
            cp = 0xfffd;
        }
        return fromCodePoint(cp);
    }
    if (Object.prototype.hasOwnProperty.call(NAMED, body)) {
        return NAMED[body];
    }
    return s;
};

var C_BACKSLASH = 92;

var ENTITY = "&(?:#x[a-f0-9]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,31});";

var TAGNAME = "[A-Za-z][A-Za-z0-9-]*";
var ATTRIBUTENAME = "[a-zA-Z_:][a-zA-Z0-9:._-]*";
var UNQUOTEDVALUE = "[^\"'=<>`\\x00-\\x20]+";
var SINGLEQUOTEDVALUE = "'[^']*'";
var DOUBLEQUOTEDVALUE = '"[^"]*"';
var ATTRIBUTEVALUE =
    "(?:" +
    UNQUOTEDVALUE +
    "|" +
    SINGLEQUOTEDVALUE +
    "|" +
    DOUBLEQUOTEDVALUE +
    ")";
var ATTRIBUTEVALUESPEC = "(?:" + "\\s*=" + "\\s*" + ATTRIBUTEVALUE + ")";
var ATTRIBUTE = "(?:" + "\\s+" + ATTRIBUTENAME + ATTRIBUTEVALUESPEC + "?)";
var OPENTAG = "<" + TAGNAME + ATTRIBUTE + "*" + "\\s*/?>";
var CLOSETAG = "</" + TAGNAME + "\\s*[>]";
var HTMLCOMMENT = "<!-->|<!--->|<!--[\\s\\S]*?-->"
var PROCESSINGINSTRUCTION = "[<][?][\\s\\S]*?[?][>]";
var DECLARATION = "<![A-Za-z]+" + "[^>]*>";
var CDATA = "<!\\[CDATA\\[[\\s\\S]*?\\]\\]>";
var HTMLTAG =
    "(?:" +
    OPENTAG +
    "|" +
    CLOSETAG +
    "|" +
    HTMLCOMMENT +
    "|" +
    PROCESSINGINSTRUCTION +
    "|" +
    DECLARATION +
    "|" +
    CDATA +
    ")";
var reHtmlTag = new RegExp("^" + HTMLTAG);

var reBackslashOrAmp = /[\\&]/;

var ESCAPABLE = "[!\"#$%&'()*+,./:;<=>?@[\\\\\\]^_`{|}~-]";

var reEntityOrEscapedChar = new RegExp("\\\\" + ESCAPABLE + "|" + ENTITY, "gi");

var XMLSPECIAL = '[&<>"]';

var reXmlSpecial = new RegExp(XMLSPECIAL, "g");

var unescapeChar = function(s) {
    if (s.charCodeAt(0) === C_BACKSLASH) {
        return s.charAt(1);
    } else {
        return decodeHTMLStrict(s);
    }
};

// Replace entities and backslash escapes with literal characters.
var unescapeString = function(s) {
    if (reBackslashOrAmp.test(s)) {
        return s.replace(reEntityOrEscapedChar, unescapeChar);
    } else {
        return s;
    }
};

//  LITE-030: mdurl dropped — normalizeURI is the identity, so a link
//  destination keeps its source bytes for the emitter to re-emit.
var normalizeURI = function(uri) {
    return uri;
};

var replaceUnsafeChar = function(s) {
    switch (s) {
        case "&":
            return "&amp;";
        case "<":
            return "&lt;";
        case ">":
            return "&gt;";
        case '"':
            return "&quot;";
        default:
            return s;
    }
};

var escapeXml = function(s) {
    if (reXmlSpecial.test(s)) {
        return s.replace(reXmlSpecial, replaceUnsafeChar);
    } else {
        return s;
    }
};

module.exports = {
    decodeHTMLStrict,
    unescapeString,
    normalizeURI,
    escapeXml,
    reHtmlTag,
    OPENTAG,
    CLOSETAG,
    ENTITY,
    ESCAPABLE
};
