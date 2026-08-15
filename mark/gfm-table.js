"use strict";
//  LITE-031: GFM tables — a leaf block of `table` > `table_row` > `table_cell`,
//  after cmark-gfm's extensions/table.c.  Cells hold inlines, never blocks.

var Node = require("mark/node.js");

//  cmark's scan_table_start: `|? marker (| marker)* |? space* eol`,
//  marker = `space* :? -+ :? space*`
var MARKER = "[ \\t\\v\\f]*:?-+:?[ \\t\\v\\f]*";
var reDelimRow = new RegExp(
    "^\\|?" + MARKER + "(?:\\|" + MARKER + ")*\\|?[ \\t\\v\\f]*$");

//  Split one line into cells: an optional leading and trailing pipe, `\|`
//  escaped, every cell trimmed.  Null when the line holds no cell at all.
var splitRow = function(line) {
    var cells = [];
    var cell = "";
    var i = line.charAt(0) === "|" ? 1 : 0;
    var pipe = i === 1;
    for (; i < line.length; i++) {
        var c = line.charAt(i);
        if (c === "\\" && line.charAt(i + 1) === "|") {
            cell += "|";
            i++;
        } else if (c === "|") {
            cells.push(cell.trim());
            cell = "";
            pipe = true;
        } else {
            cell += c;
            pipe = false;
        }
    }
    //  A trailing pipe (plus blanks) closes the row, it does not open a cell.
    if (!(pipe && cell.trim() === "")) {
        cells.push(cell.trim());
    }
    return cells.length ? cells : null;
};

var alignOf = function(delim) {
    var left = delim.charAt(0) === ":";
    var right = delim.charAt(delim.length - 1) === ":";
    return left && right ? "center" : left ? "left" : right ? "right" : null;
};

var addRow = function(table, cells, columns, header, line) {
    var row = new Node("table_row", [[line, 1], [line, 1]]);
    row.tableHeader = header;
    row._open = false;
    for (var i = 0; i < columns; i++) {
        var cell = new Node("table_cell", [[line, 1], [line, 1]]);
        cell._string_content = i < cells.length ? cells[i] : "";
        cell.tableAlign = table.tableAlign[i];
        cell._open = false;
        row.appendChild(cell);
    }
    table.appendChild(row);
    return row;
};

//  The current line is a delimiter row under the paragraph `container`: its
//  LAST line becomes the header, any earlier line stays a paragraph.
var openHeader = function(parser, container) {
    var line = parser.currentLine.slice(parser.nextNonspace);
    if (!reDelimRow.test(line)) {
        return 0;
    }
    var delims = splitRow(line);
    var lines = container._string_content.replace(/\n$/, "").split("\n");
    var header = splitRow(lines[lines.length - 1]);
    if (!delims || !header || header.length !== delims.length) {
        return 0;
    }
    parser.closeUnmatchedBlocks();
    if (lines.length > 1) {
        var para = new Node("paragraph", [
            container.sourcepos[0],
            [parser.lineNumber - 2, 1]
        ]);
        para._string_content = lines.slice(0, -1).join("\n") + "\n";
        para._open = false;
        container.insertBefore(para);
    }
    var table = new Node("table", [
        [parser.lineNumber - 1, container.sourcepos[0][1]],
        [0, 0]
    ]);
    table.tableAlign = delims.map(alignOf);
    table.tableColumns = header.length;
    container.insertAfter(table);
    container.unlink();
    parser.tip = table;
    addRow(table, header, header.length, true, parser.lineNumber - 1);
    parser.advanceOffset(parser.currentLine.length - parser.offset, false);
    return 2;
};

var openRow = function(parser, table) {
    if (parser.blank) {
        return 0;
    }
    var cells = splitRow(parser.currentLine.slice(parser.nextNonspace));
    if (!cells) {
        return 0;
    }
    addRow(table, cells, table.tableColumns, false, parser.lineNumber);
    parser.advanceOffset(parser.currentLine.length - parser.offset, false);
    return 2;
};

var tableStart = function(parser, container) {
    if (parser.indented) {
        return 0;
    }
    if (container.type === "paragraph") {
        return openHeader(parser, container);
    }
    if (container.type === "table") {
        return openRow(parser, container);
    }
    return 0;
};

var tableBlocks = {
    table: {
        continue: function(parser) {
            return parser.blank ? 1 : 0;
        },
        finalize: function() {
            return;
        },
        canContain: function(t) {
            return t === "table_row";
        },
        acceptsLines: false,
        anyLineStarts: true          // a row may start with any character
    },
    table_row: {
        continue: function() {
            return 1;
        },
        finalize: function() {
            return;
        },
        canContain: function(t) {
            return t === "table_cell";
        },
        acceptsLines: false
    },
    table_cell: {
        continue: function() {
            return 1;
        },
        finalize: function() {
            return;
        },
        canContain: function() {
            return false;
        },
        acceptsLines: false
    }
};

//  Arm one Parser: the three block types, and the start LAST so that every
//  core start (quote, heading, fence, list, ...) breaks the table first.
var install = function(parser) {
    var blocks = {};
    var t;
    for (t in parser.blocks) {
        blocks[t] = parser.blocks[t];
    }
    for (t in tableBlocks) {
        blocks[t] = tableBlocks[t];
    }
    parser.blocks = blocks;
    parser.blockStarts = parser.blockStarts.concat([tableStart]);
    return parser;
};

module.exports = { install: install, splitRow: splitRow };
