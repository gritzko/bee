"use strict";
//  LITE-031: GFM strikethrough — one or two tildes pair into a `strikethrough`
//  node, three or more are inert.  The pairing itself is in processEmphasis.

var Node = require("mark/node.js");

var C_TILDE = 126;

//  `~` must not be swallowed by the ordinary-text run, or handleDelim never
//  sees it; the run regexp is the vendored one plus `~`.
var reMainTilde = /^[^\n`\[\]\\!<&*_'"~]+/m;

var parseTilde = function(block) {
    var res = this.scanDelims(C_TILDE);      // scanDelims does not move pos
    if (res === null) {
        return false;
    }
    if (res.numdelims > 2) {                 // three or more never strike
        var node = new Node("text");
        node._literal = this.subject.slice(this.pos, this.pos + res.numdelims);
        this.pos += res.numdelims;
        block.appendChild(node);
        return true;
    }
    return this.handleDelim(C_TILDE, block);
};

//  Arm one InlineParser (blocks.js keeps exactly one, as parser.inlineParser).
var install = function(inlineParser) {
    inlineParser.reMain = reMainTilde;
    inlineParser.ext[C_TILDE] = parseTilde;
    return inlineParser;
};

module.exports = { install: install, C_TILDE: C_TILDE };
