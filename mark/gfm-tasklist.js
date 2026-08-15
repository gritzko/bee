"use strict";
//  LITE-031: GFM task list items — a pass over the parsed blocks, before the
//  inlines: the marker leaves the text, the state goes on item.taskChecked.

//  a space or tab must follow, a line end does not count (scan_tasklist)
var reMarker = /^\[([ xX])\][ \t\v\f]/;

var tasklist = function(block) {
    var walker = block.walker();
    var event, node, para, m;
    while ((event = walker.next())) {
        node = event.node;
        if (!event.entering || node.type !== "item") {
            continue;
        }
        para = node.firstChild;
        if (!para || para.type !== "paragraph" || para._string_content === null) {
            continue;
        }
        m = reMarker.exec(para._string_content);
        if (m === null) {
            continue;
        }
        node.taskChecked = m[1] !== " ";
        para._string_content = para._string_content.slice(3);
    }
    return block;
};

module.exports = tasklist;
