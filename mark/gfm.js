"use strict";
//  mark/gfm.js — LITE-031: the GFM parser, commonmark.js 0.31.2 (LITE-030)
//  plus GitHub's four extensions.  `new (require("mark/gfm.js"))().parse(src)`
//  returns a commonmark AST with three added node types (`strikethrough`,
//  `table` > `table_row` > `table_cell`) and added node fields:
//  `item.taskChecked`, `table.tableAlign` (per column: left/center/right or
//  null), `table_row.tableHeader`.  Tagfilter is out of scope: StrictMark
//  bans HTML inserts.

var Parser = require("mark/blocks.js");
var strike = require("mark/gfm-strike.js");
var table = require("mark/gfm-table.js");
var tasklist = require("mark/gfm-tasklist.js");
var autolink = require("mark/gfm-autolink.js");

function GfmParser(options) {
    var parser = new Parser(options);
    strike.install(parser.inlineParser);
    table.install(parser);
    //  the task list marker leaves the block text before the inlines are
    //  parsed; the autolink sweep needs them parsed, so it rides on parse()
    var processInlines = parser.processInlines;
    parser.processInlines = function(block) {
        tasklist(block);
        processInlines.call(this, block);
    };
    var parse = parser.parse;
    parser.parse = function(input) {
        return autolink(parse.call(this, input));
    };
    return parser;
}

module.exports = GfmParser;
