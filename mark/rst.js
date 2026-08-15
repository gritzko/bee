//  mark/rst.js — LITE-037: a reStructuredText SUBSET parser.  docutils is Python
//  and no JS reST parser exists to vendor, so this is hand-written — but it
//  builds the SAME commonmark nodes `mark/gfm.js` yields, so the LITE-035 walk
//  (`mark/html.js`) emits an `.rst` page with no second emitter, no second link
//  door and no edit anywhere on the Markdown side.
//
//  THE SUBSET: section titles (under- and overlined), paragraphs, bullet and
//  enumerated lists, literal blocks (`::`), block quotes, transitions, and
//  inline emph/strong/literal plus hyperlink targets and their references.
//
//  EVERYTHING ELSE DEGRADES, and never crashes: a directive, a footnote or
//  citation definition and a grid table come out as LITERAL TEXT (their source
//  bytes in a `<pre>`), a role's text as an inline literal, a comment is
//  dropped the way reST drops it, and a field list, a line block, a simple
//  table or a substitution is plain paragraph text.  Nothing here ever emits a
//  raw-HTML node, so a document's own markup is always text on the page.
"use strict";

const Node = require("mark/node.js");

//  The adornment set is docutils' own less `.` and `:`, which head comments and
//  field lists — DOG-038's cut, so the tokenizer and this parser agree.
const ADORN = "!\"#$%&'()*+,-/;<=>?@[\\]^_`{|}~";
const BULLET = /^([-*+•])(\s+|$)/;
const ENUM = /^(\(?)(\d+|#)([.)])(\s+|$)/;
const GRID = /^\+[-=+]+\+\s*$/;
const EXPLICIT = /^\.\.(\s|$)/;

function isBlank(l) { return /^[ \t]*$/.test(l); }

//  A tab counts one, as it does in the DOG-038 machine — a v1 simplification.
function indentOf(l) { let i = 0; while (l.charAt(i) === " " || l.charAt(i) === "\t") i++; return i; }

//  A whole line of one adornment character, three or more -> that character.
function adornOf(l) {
  const s = String(l).replace(/\s+$/, "");
  if (s.length < 3) return "";
  const c = s.charAt(0);
  if (ADORN.indexOf(c) < 0) return "";
  for (let i = 1; i < s.length; i++) if (s.charAt(i) !== c) return "";
  return c;
}

function addNode(parent, type) {
  const n = new Node(type);
  parent.appendChild(n);
  return n;
}

//  A block of lines -> the same block with its common indent taken off.
function dedent(lines) {
  let min = -1;
  for (const l of lines) {
    if (isBlank(l)) continue;
    const n = indentOf(l);
    if (min < 0 || n < min) min = n;
  }
  if (min <= 0) return lines.slice();
  return lines.map(function (l) { return isBlank(l) ? "" : l.slice(min); });
}

function litOf(lines) {
  const d = dedent(lines);
  return d.length ? d.join("\n") + "\n" : "";
}

//  --- the block layer --------------------------------------------------------
function blocks(lines, parent, ctx) {
  let i = 0;
  while (i < lines.length) {
    if (isBlank(lines[i])) { i++; continue; }
    if (indentOf(lines[i]) > 0) { i = quoteAt(lines, i, parent, ctx); continue; }
    let k = headingAt(lines, i, parent, ctx);
    if (k > i) { i = k; continue; }
    if (adornOf(lines[i])) { addNode(parent, "thematic_break"); i++; continue; }
    if (EXPLICIT.test(lines[i])) { i = explicitAt(lines, i, parent, ctx); continue; }
    if (GRID.test(lines[i])) { i = gridAt(lines, i, parent); continue; }
    k = listAt(lines, i, false, parent, ctx);
    if (k > i) { i = k; continue; }
    k = listAt(lines, i, true, parent, ctx);
    if (k > i) { i = k; continue; }
    i = paraAt(lines, i, parent, ctx);
  }
}

//  A section title: an adornment line, the title, the same adornment again — or
//  the title with an underline only.  A style is ranked the first time it is
//  seen, so `=` then `-` reads as h1 then h2 whatever the characters are.
function headingAt(lines, i, parent, ctx) {
  const over = adornOf(lines[i]);
  let title = -1, mark = "", end = i;
  if (over && i + 2 < lines.length && !isBlank(lines[i + 1]) &&
      !adornOf(lines[i + 1]) && adornOf(lines[i + 2]) === over) {
    title = i + 1; mark = "o" + over; end = i + 3;
  } else if (!over && i + 1 < lines.length && adornOf(lines[i + 1])) {
    title = i; mark = "u" + adornOf(lines[i + 1]); end = i + 2;
  }
  if (title < 0) return i;
  if (!ctx.levels.has(mark)) ctx.levels.set(mark, Math.min(ctx.levels.size + 1, 6));
  const h = addNode(parent, "heading");
  h.level = ctx.levels.get(mark);
  ctx.raw.push({ node: h, text: lines[title].trim() });
  return end;
}

//  An indented run with no `::` opener in front of it is a block quote.
function quoteAt(lines, i, parent, ctx) {
  const base = indentOf(lines[i]);
  let j = i;
  while (j < lines.length && (isBlank(lines[j]) || indentOf(lines[j]) >= base)) j++;
  while (j > i && isBlank(lines[j - 1])) j--;
  blocks(dedent(lines.slice(i, j)), addNode(parent, "block_quote"), ctx);
  return j;
}

//  A grid table degrades: its own art, verbatim, in a literal block.
function gridAt(lines, i, parent) {
  let j = i;
  while (j < lines.length && !isBlank(lines[j])) j++;
  addNode(parent, "code_block").literal = litOf(lines.slice(i, j));
  return j;
}

//  `.. ` opens explicit markup.  A HYPERLINK TARGET is read (it is what a
//  reference resolves through); a directive, a footnote or a citation
//  definition degrades to literal text; anything else is a comment and is
//  dropped, as reST drops it.
function explicitAt(lines, i, parent, ctx) {
  const base = indentOf(lines[i]);
  let j = i + 1;
  while (j < lines.length && (isBlank(lines[j]) || indentOf(lines[j]) > base)) j++;
  while (j > i + 1 && isBlank(lines[j - 1])) j--;
  const body = lines.slice(i, j);
  const rest = lines[i].slice(base + 2).replace(/^\s/, "");
  const tgt = /^_(_|`[^`]+`|(?:\\.|[^:\\])+):(.*)$/.exec(rest);
  if (tgt) {
    let url = tgt[2].trim();
    for (let k = 1; k < body.length; k++) url += body[k].trim();
    if (tgt[1] === "_" || tgt[1] === "") ctx.anon.push(url);
    else ctx.targets.set(refName(tgt[1]), url);
    return j;
  }
  if (/^[|][^|]+[|]\s+[\w.+-]+::/.test(rest) || /^[\w.+-]+::/.test(rest) ||
      /^\[[^\]]+\]/.test(rest))
    addNode(parent, "code_block").literal = body.join("\n") + "\n";
  return j;
}

//  A list marker -> { len, kind, num }, or null.  `kind` is the marker STYLE —
//  a change of style ends the list and opens the next one, as reST reads it.
function markerOf(line, ordered) {
  const m = (ordered ? ENUM : BULLET).exec(line);
  if (!m) return null;
  return ordered
    ? { len: m[0].length, kind: m[1] + m[3], num: m[2] === "#" ? 1 : Number(m[2]) }
    : { len: m[0].length, kind: m[1], num: 0 };
}

//  A bullet or enumerated list.  An item is its marker line with the marker
//  taken off plus everything indented past the marker's own column, so a nested
//  list, a second paragraph or a literal block inside an item all reach the
//  block layer again.
function listAt(lines, i, ordered, parent, ctx) {
  if (indentOf(lines[i]) > 0) return i;
  const first = markerOf(lines[i], ordered);
  if (first === null) return i;
  const list = addNode(parent, "list");
  list.listType = ordered ? "ordered" : "bullet";
  let tight = true;
  while (i < lines.length && !isBlank(lines[i]) && indentOf(lines[i]) === 0) {
    const m = markerOf(lines[i], ordered);
    if (m === null || m.kind !== first.kind) break;
    const buf = [lines[i].slice(m.len)];
    let blanks = 0;
    i++;
    while (i < lines.length) {
      if (isBlank(lines[i])) { blanks++; buf.push(""); i++; continue; }
      const ind = indentOf(lines[i]);
      if (ind === 0) break;
      blanks = 0;
      buf.push(lines[i].slice(ind < m.len ? ind : m.len));
      i++;
    }
    while (buf.length && isBlank(buf[buf.length - 1])) buf.pop();
    const item = addNode(list, "item");
    blocks(dedent(buf), item, ctx);
    if (item.firstChild !== item.lastChild) tight = false;
    const nx = i < lines.length && !isBlank(lines[i]) ? markerOf(lines[i], ordered) : null;
    if (blanks && nx !== null && nx.kind === first.kind) tight = false;
  }
  list.listTight = tight;
  if (ordered) list.listStart = first.num;
  return i;
}

//  A paragraph, and the literal block a trailing `::` opens.  reST's own rule
//  for the colon: `text::` keeps one, `text ::` keeps none, a lone `::` leaves
//  no paragraph at all.
function paraAt(lines, i, parent, ctx) {
  const buf = [];
  while (i < lines.length && !isBlank(lines[i])) {
    if (buf.length && (adornOf(lines[i]) || indentOf(lines[i]) > 0 ||
                       EXPLICIT.test(lines[i]) || GRID.test(lines[i]) ||
                       BULLET.test(lines[i]) || ENUM.test(lines[i]) ||
                       (i + 1 < lines.length && adornOf(lines[i + 1])))) break;
    buf.push(lines[i].replace(/\s+$/, ""));
    i++;
  }
  let text = buf.join("\n"), lit = false;
  if (/::$/.test(text)) {
    lit = true;
    text = text.slice(0, -2);
    if (/\s$/.test(text)) text = text.replace(/\s+$/, "");
    else if (text !== "") text += ":";
  }
  if (text !== "") ctx.raw.push({ node: addNode(parent, "paragraph"), text: text });
  if (!lit) return i;
  let j = i;
  while (j < lines.length && isBlank(lines[j])) j++;
  if (j >= lines.length || indentOf(lines[j]) === 0) return i;
  let k = j;
  while (k < lines.length && (isBlank(lines[k]) || indentOf(lines[k]) > 0)) k++;
  while (k > j && isBlank(lines[k - 1])) k--;
  addNode(parent, "code_block").literal = litOf(lines.slice(j, k));
  return k;
}

//  --- the inline layer -------------------------------------------------------
//  Run after the WHOLE document is read, so a reference resolves against a
//  target defined anywhere — before it, after it, or in another section.
//
//  reST's start/end-string rules, simplified: a start-string opens at the head
//  of the text or after whitespace or one of `-:/'"<([{`, and its content opens
//  on non-whitespace; an end-string closes on non-whitespace and is followed by
//  the end of the text, whitespace or one of `-.,:;!?\/'")]}>`.
const OPEN_BEFORE = " \t\n-:/'\"<([{";
const CLOSE_AFTER = " \t\n-.,:;!?\\/'\")]}>";

function startOk(s, i) { return i === 0 || OPEN_BEFORE.indexOf(s.charAt(i - 1)) >= 0; }
function afterOk(s, k, extra) {
  if (k >= s.length) return true;
  const c = s.charAt(k);
  return CLOSE_AFTER.indexOf(c) >= 0 || (extra && extra.indexOf(c) >= 0);
}
function isWord(c) { return /[A-Za-z0-9]/.test(c); }

//  The first valid end-string for `delim` at or after `from`, else -1.
function closerOf(s, from, delim, extra) {
  let j = from;
  while (j < s.length) {
    j = s.indexOf(delim, j);
    if (j < 0) return -1;
    if (j > from && !/\s/.test(s.charAt(j - 1)) && afterOk(s, j + delim.length, extra))
      return j;
    j += delim.length;
  }
  return -1;
}

//  A reference name normalizes: backticks off, case folded, whitespace one space.
function refName(s) {
  return String(s).replace(/^`|`$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function textNode(parent, s) {
  const parts = String(s).split("\n");
  for (let i = 0; i < parts.length; i++) {
    if (i) addNode(parent, "softbreak");
    if (parts[i] !== "") addNode(parent, "text").literal = parts[i];
  }
}

//  A hyperlink with its label.  `verbatim` takes the label as it stands — a
//  standalone URI is its own label, and re-reading it would find that URI
//  again.  An UNRESOLVED reference never gets here: the caller lays down the
//  source bytes as plain text instead, so a page carries no dead link (the
//  serve ruling of 2026-08-15, which the emitter's href hook applies again).
function linkNode(parent, dest, text, ctx, depth, verbatim) {
  const a = addNode(parent, "link");
  a.destination = dest;
  if (verbatim || depth >= 4) textNode(a, text);
  else inlineInto(a, text, ctx, depth + 1);
}

function inlineInto(parent, src, ctx, depth) {
  const s = String(src), buf = [];
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i);
    if (c === "\\") { buf.push(s.charAt(i + 1) || "\\"); i += 2; continue; }
    const k = markupAt(s, i, parent, ctx, depth, buf);
    if (k > i) { i = k; continue; }
    buf.push(c);
    i++;
  }
  if (buf.length) { textNode(parent, buf.join("")); buf.length = 0; }
}

//  One inline construct at `i` -> the index past it, or `i` for none.  `buf` is
//  the pending plain text, flushed before a construct lands.
function markupAt(s, i, parent, ctx, depth, buf) {
  const flush = function () {
    if (buf.length) { textNode(parent, buf.join("")); buf.length = 0; }
  };
  const c = s.charAt(i);
  //  ``inline literal`` — verbatim, nothing nests inside it (DOG-025).
  if (c === "`" && s.charAt(i + 1) === "`" && startOk(s, i)) {
    const e = closerOf(s, i + 2, "``");
    if (e > 0) {
      flush();
      addNode(parent, "code").literal = s.slice(i + 2, e);
      return e + 2;
    }
  }
  if ((c === "*" || c === "`") && startOk(s, i) && !/\s/.test(s.charAt(i + 1))) {
    const two = c === "*" && s.charAt(i + 1) === "*";
    const delim = two ? "**" : c;
    const e = closerOf(s, i + delim.length, delim, c === "`" ? "_" : "");
    if (e > 0 && c === "*") {
      flush();
      inlineInto(addNode(parent, two ? "strong" : "emph"),
                 s.slice(i + delim.length, e), ctx, depth + 1);
      return e + delim.length;
    }
    if (e > 0) { flush(); return phraseAt(s, i, e, parent, ctx, depth); }
  }
  //  :role:`text` degrades to an inline literal — the role itself is not run.
  if (c === ":" && startOk(s, i)) {
    const m = /^:[\w.+-]+:`([^`]*)`/.exec(s.slice(i));
    if (m) {
      flush();
      addNode(parent, "code").literal = m[1];
      return i + m[0].length;
    }
  }
  //  A standalone URI links itself; trailing sentence punctuation stays out.
  if ((c === "h" || c === "m") && startOk(s, i)) {
    const m = /^(?:https?:\/\/|mailto:)[^\s<>]+/.exec(s.slice(i));
    if (m) {
      const u = m[0].replace(/[.,;:!?)\]}'"]+$/, "");
      if (u.length > 8) {
        flush();
        linkNode(parent, u, u, ctx, depth, true);
        return i + u.length;
      }
    }
  }
  //  name_ / name__ — a simple reference, resolved or plain.
  if (isWord(c) && (i === 0 || !isWord(s.charAt(i - 1)))) {
    const m = /^([A-Za-z0-9](?:[A-Za-z0-9]|[-_.+:]+[A-Za-z0-9])*)(__?)/.exec(s.slice(i));
    if (m && afterOk(s, i + m[0].length)) {
      flush();
      const d = destOf(m[2], m[1], ctx);
      if (d) linkNode(parent, d, m[1], ctx, depth);
      else textNode(parent, m[0]);              // unresolved: the source, plain
      return i + m[0].length;
    }
  }
  return i;
}

//  A backtick construct, closed at `e`: `text <uri>`_ carries its own
//  destination, `phrase`_ resolves through the targets, `phrase`__ takes the
//  next anonymous one, and a bare `title` is a citation — an emphasis here.
function phraseAt(s, i, e, parent, ctx, depth) {
  let end = e + 1, kind = "";
  if (s.slice(e + 1, e + 3) === "__") { end = e + 3; kind = "__"; }
  else if (s.charAt(e + 1) === "_") { end = e + 2; kind = "_"; }
  const body = s.slice(i + 1, e);
  if (kind === "") {
    inlineInto(addNode(parent, "emph"), body, ctx, depth + 1);
    return end;
  }
  const m = /^([\s\S]*?)\s*<([^>]*)>$/.exec(body);
  if (m) {
    linkNode(parent, m[2].trim(), m[1] === "" ? m[2].trim() : m[1], ctx, depth);
    return end;
  }
  const dest = destOf(kind, body, ctx);
  if (dest) linkNode(parent, dest, body, ctx, depth);
  else textNode(parent, s.slice(i, end));         // unresolved: the source, plain
  return end;
}

//  `__` takes the anonymous targets in document order; `_` looks the name up.
function destOf(kind, name, ctx) {
  if (kind === "__") return ctx.anonAt < ctx.anon.length ? ctx.anon[ctx.anonAt++] : "";
  const d = ctx.targets.get(refName(name));
  return typeof d === "string" ? d : "";
}

//  --- the whole trip ---------------------------------------------------------
function parse(src) {
  const doc = new Node("document");
  const ctx = { targets: new Map(), anon: [], anonAt: 0, levels: new Map(), raw: [] };
  blocks(String(src).replace(/\r\n?/g, "\n").split("\n"), doc, ctx);
  for (const r of ctx.raw) inlineInto(r.node, r.text, ctx, 0);
  return doc;
}

function toHtml(src, opts) {
  return require("mark/html.js").render(parse(src), opts);
}

module.exports = { parse: parse, toHtml: toHtml, adornOf: adornOf, refName: refName };
