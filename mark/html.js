//  mark/html.js — LITE-035: the AST -> HTML walk.  Upstream's `render/` was
//  dropped when the parser was vendored (LITE-030), so this is a FRESH emitter
//  over the node inventory `mark/gfm.js` yields, the GFM four included: `<del>`,
//  a disabled checkbox per task item, `<table>` with alignment, autolinked `<a>`.
//  It READS the AST and nothing else — zero edits inside the vendored files.
//
//  SAFE BY DEFAULT, and stricter than cmark's own `--safe`: a raw HTML block or
//  inline is ESCAPED and shown as text (cmark drops it for a comment), and a
//  `javascript:`/`vbscript:`/`data:`/`file:` destination makes the link PLAIN
//  TEXT (cmark keeps an `<a href="">`).  A served page carries no markup of the
//  document's own choosing.
//
//  Everything else follows cmark-gfm's html.c byte for byte — the line breaks
//  included — so the test leg can hold the two outputs side by side.
"use strict";

//  cmark's escape_html: these four and never `'`.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

//  houdini_escape_href's own safe set; everything else percent-encodes, bar the
//  two it spells as entities.  `%` is safe, so an already-encoded url survives.
const HREF_SAFE = "-_.+!*(),%#@?=;:/$~";
function escHref(url) {
  const s = String(url), out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i), n = s.charCodeAt(i);
    if (c === "&") { out.push("&amp;"); continue; }
    if (c === "'") { out.push("&#x27;"); continue; }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") ||
        HREF_SAFE.indexOf(c) >= 0) { out.push(c); continue; }
    //  Past ASCII a percent triple per UTF-8 byte, which is what encodeURI does.
    if (n > 0x7f) { try { out.push(encodeURIComponent(c)); continue; } catch (e) { } }
    out.push("%" + (n < 16 ? "0" : "") + n.toString(16).toUpperCase());
  }
  return out.join("");
}

//  The dropped schemes — cmark's scan_dangerous_url set, with NO exception for
//  `data:image/...`.  Whitespace and controls come out first, so an obfuscated
//  `java\nscript:` is caught the way a browser would read it.
const DANGER = /^(javascript|vbscript|data|file):/;
function dangerous(dest) {
  return DANGER.test(String(dest).replace(/[\u0000-\u0020]/g, "").toLowerCase());
}

//  cmark's PLAIN mode: literals as they are, a break as a space, tags dropped —
//  what an `alt` attribute and a heading slug both want.
function textOf(node) {
  const w = node.walker(), out = [];
  let ev;
  while ((ev = w.next())) {
    const n = ev.node, t = n.type;
    if (!ev.entering) continue;
    if (t === "text" || t === "code" || t === "html_inline") out.push(n.literal);
    else if (t === "softbreak" || t === "linebreak") out.push(" ");
  }
  return out.join("");
}

//  A heading's stable anchor: lowercased, ASCII punctuation dropped, runs of
//  space hyphenated, a repeat numbered — GitHub's rule, letters left alone.
const PUNCT = /["#$%&'()*+,./:;<=>?@[\\\]^`{|}~!]/g;
function slugOf(text, used) {
  let s = String(text).toLowerCase().replace(PUNCT, "").trim().replace(/\s+/g, "-");
  if (s === "") s = "section";
  const n = used.get(s) || 0;
  used.set(s, n + 1);
  return n ? s + "-" + n : s;
}

//  render(doc, opts) -> the body fragment (no <html>, no <body>: LITE-034's page
//  shell wraps it).  opts.href is `(destination, isImage) -> url | ""`, the ONE
//  hook: "" means the link resolves to nothing and renders as plain text.  Its
//  answer is html-escaped; with no hook the destination itself is href-escaped.
function render(doc, opts) {
  opts = opts || {};
  const out = [], used = new Map(), open = [];
  let tail = "\n";                       // a leading cr() must not fire
  const put = function (s) { if (s) { out.push(s); tail = s.charAt(s.length - 1); } };
  const cr = function () { if (tail !== "\n") put("\n"); };

  //  -> the final href attribute value, or null: no link at all, plain text.
  const hrefOf = function (dest, isImage) {
    if (dangerous(dest)) return null;
    if (!opts.href) return escHref(dest);
    const h = opts.href(String(dest), isImage === true);
    return h ? esc(h) : null;
  };
  const titleOf = function (n) {
    return n.title ? ' title="' + esc(n.title) + '"' : "";
  };

  const walker = doc.walker();
  let ev;
  while ((ev = walker.next())) {
    const node = ev.node, ent = ev.entering, t = node.type;
    switch (t) {
      //  ---- inlines -------------------------------------------------------
      case "text": put(esc(node.literal)); break;
      case "softbreak": put("\n"); break;
      case "linebreak": put("<br />\n"); break;
      case "code": put("<code>" + esc(node.literal) + "</code>"); break;
      case "emph": put(ent ? "<em>" : "</em>"); break;
      case "strong": put(ent ? "<strong>" : "</strong>"); break;
      case "strikethrough": put(ent ? "<del>" : "</del>"); break;
      //  SAFE: the source bytes, visible as text — never markup of its own.
      case "html_inline": put(esc(node.literal)); break;
      case "custom_inline": case "custom_block": break;
      case "link": {
        if (ent) {
          const h = hrefOf(node.destination, false);
          open.push(h);                  // the exit must match the enter
          if (h !== null) put('<a href="' + h + '"' + titleOf(node) + ">");
        } else if (open.pop() !== null) put("</a>");
        break;
      }
      case "image": {
        if (!ent) break;                 // the exit of a subtree already read
        const h = hrefOf(node.destination, true);
        const alt = esc(textOf(node));
        put(h === null ? alt
            : '<img src="' + h + '" alt="' + alt + '"' + titleOf(node) + " />");
        walker.resumeAt(node, false);    // the alt already read the children
        break;
      }
      //  ---- blocks --------------------------------------------------------
      case "document": break;
      case "paragraph": {
        const gp = node.parent && node.parent.parent;
        if (gp && gp.type === "list" && gp.listTight) break;
        if (ent) { cr(); put("<p>"); } else put("</p>\n");
        break;
      }
      case "heading": {
        if (ent) {
          cr();
          put("<h" + node.level + ' id="' + esc(slugOf(textOf(node), used)) + '">');
        } else put("</h" + node.level + ">\n");
        break;
      }
      case "block_quote":
        cr();
        put(ent ? "<blockquote>\n" : "</blockquote>\n");
        break;
      case "list": {
        if (ent) {
          cr();
          const st = node.listStart;
          put(node.listType === "bullet" ? "<ul>\n"
              : st === 1 || st === null || st === undefined ? "<ol>\n"
              : '<ol start="' + st + '">\n');
        } else put(node.listType === "bullet" ? "</ul>\n" : "</ol>\n");
        break;
      }
      case "item": {
        if (ent) {
          cr();
          put("<li>");
          //  LITE-031 put the state on the node; the marker is already gone.
          if (node.taskChecked !== undefined)
            put('<input type="checkbox"' + (node.taskChecked ? ' checked=""' : "") +
                ' disabled="" /> ');
        } else put("</li>\n");
        break;
      }
      case "code_block": {
        cr();
        const info = node.info ? String(node.info).split(/\s+/)[0] : "";
        put("<pre><code" + (info ? ' class="language-' + esc(info) + '"' : "") + ">" +
            esc(node.literal) + "</code></pre>\n");
        break;
      }
      case "thematic_break": cr(); put("<hr />\n"); break;
      //  SAFE: the block's own bytes, escaped — cmark drops them for a comment.
      case "html_block": cr(); put(esc(node.literal)); cr(); break;
      //  ---- the GFM table -------------------------------------------------
      case "table": cr(); put(ent ? "<table>\n" : "</table>\n"); break;
      case "table_row": {
        const head = node.tableHeader === true;
        if (ent) {
          if (head) put("<thead>\n");
          else if (node.prev && node.prev.tableHeader === true) put("<tbody>\n");
          put("<tr>\n");
        } else {
          put("</tr>\n");
          if (head) put("</thead>\n");
          else if (node.next === null) put("</tbody>\n");
        }
        break;
      }
      case "table_cell": {
        const tag = node.parent && node.parent.tableHeader === true ? "th" : "td";
        if (ent)
          put("<" + tag + (node.tableAlign ? ' align="' + node.tableAlign + '"' : "") + ">");
        else put("</" + tag + ">\n");
        break;
      }
      default: break;
    }
  }
  return out.join("");
}

//  The whole trip for a caller that has bytes: parse with the GFM parser, emit.
function toHtml(src, opts) {
  const Parser = require("mark/gfm.js");
  return render(new Parser().parse(String(src)), opts);
}

module.exports = { render: render, toHtml: toHtml, esc: esc, escHref: escHref,
                   dangerous: dangerous, slugOf: slugOf, textOf: textOf };
