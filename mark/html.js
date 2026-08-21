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

//  The bytes a string takes, so a cut inside a token still names its own byte.
function byteLen(s) {
  return typeof utf8 !== "undefined" ? utf8.Encode(s).length : String(s).length;
}

//  cmark's escape_html: these four and never `'`.
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
                  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

//  MARK-018: a fenced body is LEXED, not merely labelled — `tok.parse` is the
//  JS face of dog/tok's whole dispatch table (quickjab/tok.c:76), the very core
//  that paints a source file, so a fence wears the SAME `tok-*` classes the
//  served source does (render/html.js:99:yo) inside the `<pre><code>` every other
//  renderer keeps.  A span carries a COLOUR onto ink: the default slot `S` (no
//  stylesheet rule) and a whitespace-only token stay bare text, so an unknown
//  info — the plain-text fallback, which tags nothing but `S`/`P` — renders as
//  it did before: PUNCTUATION ALONE IS NOT HIGHLIGHTING, so a run without one
//  of the grammar tags below hands the body back untouched.
const PAINTED = "DGLHRNCFT";   // comment, string, number, preproc, keyword, …
function paintCode(literal, lang) {
  if (!lang || typeof tok === "undefined" || typeof utf8 === "undefined") return null;
  const bytes = utf8.Encode(literal);
  let t = null;
  //  A body past the lexer's 16 MiB cap throws: it is plain text, as ever.
  try { t = tok.parse(bytes, lang); } catch (e) { return null; }
  if (t === null || t.length === 0) return null;
  const out = [];
  let prev = 0, painted = false, run = "", runTag = "";
  //  One span per RUN of a tag, not per token: a comment reaches the callback
  //  word by word (TOKSplitText), and ten spans paint what one does.
  const flush = function () {
    if (run === "") return;
    if (runTag === "S" || run.trim() === "") out.push(run);
    else {
      out.push('<span class="tok-' + runTag + '">' + run + "</span>");
      if (PAINTED.indexOf(runTag) >= 0) painted = true;
    }
    run = "";
  };
  for (let i = 0; i < t.length; i++) {
    const end = t[i] & 0xffffff;                       // tok32, wrap.js:10:ka
    const tag = String.fromCharCode(65 + ((t[i] >>> 27) & 0x1f));
    const text = esc(utf8.Decode(bytes.slice(prev, end)));
    prev = end;
    if (tag !== runTag) { flush(); runTag = tag; }
    run += text;
  }
  flush();
  if (prev < bytes.length) out.push(esc(utf8.Decode(bytes.slice(prev))));
  //  No grammar tag — an ext no lexer claims: hand back the plain body.
  return painted ? out.join("") : null;
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
  let tail = "\n", inA = 0;              // a leading cr() must not fire
  const put = function (s) { if (s) { out.push(s); tail = s.charAt(s.length - 1); } };
  const cr = function () { if (tail !== "\n") put("\n"); };

  //  BEE-052:19 a rendered page is a landing place too: `#b<byte>` is the ONE
  //  fragment vocabulary a reference speaks (render/html.js:135), and only the
  //  painted view ever answered it.  A node that knows its first byte (the
  //  StrictMark parser's `boff`, mark/strict.js:20) wears that id; a run of text
  //  is cut back into the tokens it was merged from, so every one is addressable.
  //  A dialect whose parser mints no offsets emits exactly what it always did.
  const seen = new Set();
  const idAt = function (off) {
    if (!(off >= 0) || seen.has(off)) return "";
    seen.add(off);
    return ' id="b' + off + '"';
  };
  const idOf = function (node) { return idAt(node.boff); };

  //  The boundaries a text run is cut at: where the autolink hook split it, and
  //  where each token it swallowed began.  -> [{ text, off, href }] in order.
  const cutRun = function (node, segs) {
    const parts = node.parts || [];
    const marks = [];
    let at = 0;
    for (const g of segs) { marks.push({ at: at, href: g.href }); at += g.text.length; }
    const lit = node.literal, outp = [];
    let i = 0, j = 0, href = "";
    while (i < lit.length) {
      while (j < parts.length && parts[j].at <= i) j++;
      let nx = j < parts.length ? parts[j].at : lit.length;
      for (const m of marks) if (m.at > i && m.at < nx) nx = m.at;
      for (const m of marks) if (m.at <= i) href = m.href || "";
      //  A cut inside a token still names a byte — the id is an offset, not a
      //  token, so a position between two of them addresses just as well.
      const base = j > 0 ? parts[j - 1] : null;
      const off = base === null ? -1
                : base.off + byteLen(lit.slice(base.at, i));
      outp.push({ text: lit.slice(i, nx), off: off, href: href });
      i = nx;
    }
    return outp;
  };

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
      //  LITE-043: opts.autolink may split a text run into plain and linked
      //  segments (wiki/Link.mkd refs); never inside an already-open <a>.
      case "text": {
        const segs = inA === 0 && opts.autolink ? opts.autolink(node.literal) : null;
        if (!node.parts) {
          if (!segs) { put(esc(node.literal)); break; }
          for (const g of segs)
            put(g.href ? '<a href="' + esc(g.href) + '">' + esc(g.text) + "</a>"
                       : esc(g.text));
          break;
        }
        for (const g of cutRun(node, segs || [{ text: node.literal }])) {
          const span = "<span" + idAt(g.off) + ">" + esc(g.text) + "</span>";
          put(g.href ? '<a href="' + esc(g.href) + '">' + span + "</a>" : span);
        }
        break;
      }
      case "softbreak": put("\n"); break;
      case "linebreak": put("<br />\n"); break;
      case "code": put("<code" + idOf(node) + ">" + esc(node.literal) + "</code>"); break;
      case "emph": put(ent ? "<em" + idOf(node) + ">" : "</em>"); break;
      case "strong": put(ent ? "<strong" + idOf(node) + ">" : "</strong>"); break;
      case "strikethrough": put(ent ? "<del" + idOf(node) + ">" : "</del>"); break;
      //  SAFE: the source bytes, visible as text — never markup of its own.
      case "html_inline": put(esc(node.literal)); break;
      //  LITE-041: a custom node carries its own tags — emitted raw, and only
      //  the rst parser mints them (dl/dt/dd), never document text.
      case "custom_inline": case "custom_block":
        if (ent) { cr(); if (node.onEnter) put(node.onEnter); }
        else if (node.onExit) put(node.onExit);
        break;
      case "link": {
        if (ent) {
          const h = hrefOf(node.destination, false);
          open.push(h);                  // the exit must match the enter
          if (h !== null) { put('<a href="' + h + '"' + titleOf(node) + ">"); inA++; }
        } else if (open.pop() !== null) { put("</a>"); inA--; }
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
        if (ent) { cr(); put("<p" + idOf(node) + ">"); } else put("</p>\n");
        break;
      }
      case "heading": {
        if (ent) {
          cr();
          //  The slug already owns the <h>'s id, so the byte rides an inner
          //  span — and only when the parser minted one, so `.md`/`.rst` emit
          //  the heading they always did.
          const bid = idOf(node);
          node.bspan = bid !== "";
          put("<h" + node.level + ' id="' + esc(slugOf(textOf(node), used)) + '">' +
              (node.bspan ? "<span" + bid + ">" : ""));
        } else put((node.bspan ? "</span>" : "") + "</h" + node.level + ">\n");
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
          //  LITE-040: reST alpha enumerators ride a type attribute; commonmark
          //  sets no enumType, so a .md list is untouched.
          const ty = node.enumType ? ' type="' + node.enumType + '"' : "";
          put(node.listType === "bullet" ? "<ul>\n"
              : st === 1 || st === null || st === undefined ? "<ol" + ty + ">\n"
              : "<ol" + ty + ' start="' + st + '">\n');
        } else put(node.listType === "bullet" ? "</ul>\n" : "</ol>\n");
        break;
      }
      case "item": {
        if (ent) {
          cr();
          //  BEE-032: the checkbox IS the task item's marker — `.task` lets
          //  the sheet drop the list bullet, so an item never wears two.
          //  The tight paragraph below drops its tag, so the item's own line
          //  byte (the list quad's `boff`) rides the <li> — a permalink's landing.
          put(node.taskChecked !== undefined ? '<li class="task"' + idOf(node) + ">"
                                             : "<li" + idOf(node) + ">");
          if (node.taskChecked !== undefined)
            put('<input type="checkbox"' + (node.taskChecked ? ' checked=""' : "") +
                ' disabled="" /> ');
        } else put("</li>\n");
        break;
      }
      case "code_block": {
        cr();
        const info = node.info ? String(node.info).split(/\s+/)[0] : "";
        //  MARK-018: the info string names the lexer the body is painted with;
        //  unpainted, the block is the escaped literal it always was.
        const lit = String(node.literal === undefined || node.literal === null
                           ? "" : node.literal);
        const body = paintCode(lit, info);
        put("<pre><code" + (info ? ' class="language-' + esc(info) + '"' : "") + ">" +
            (body === null ? esc(lit) : body) + "</code></pre>\n");
        break;
      }
      case "thematic_break": cr(); put("<hr" + idOf(node) + " />\n"); break;
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
