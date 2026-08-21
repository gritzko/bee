//  mark/strict.js — BEE-032: the StrictMark parser, driven by the very tokens
//  that PAINT a `.mkd` page today (dog/tok/MKDT, wiki/StrictMark.mkd).  tok.parse
//  cuts every block quad ('R'), meta key ('T') and inline delimiter ('G') off
//  the text, so this file never rescans bytes for markup — it stacks those
//  tokens into the SAME commonmark nodes `mark/gfm.js` yields, and `mark/html.js`
//  emits them, exactly as it does for `.md` and `.rst` (LITE-037: only the
//  parser differs per dialect).  The 4-char marker shapes are read off the quad
//  MKDT delimited, mirroring its own inquiries (MKDTmark*, DOG-026), which are
//  C-only — this is the one thing the JS side must spell for itself.
"use strict";

const Node = require("mark/node.js");

//  --- the token lines --------------------------------------------------------
//  tok32 bit layout, as render/wrap.js:10:ka reads it.
const TOK_TAG = (w) => String.fromCharCode(65 + ((w >>> 27) & 0x1f));
const TOK_END = (w) => w & 0xffffff;

//  The page as LINES of tokens.  DOG-045 made the lexer's own tokens
//  line-coherent — none straddles a '\n', which ends the token it closes — so a
//  line is simply the run up to a token ending in one, and the terminator is
//  dropped, being no one's content.  This file used to cut them itself.
//  BEE-052:20 every piece carries `off`, its first byte in the page: that byte
//  is the whole address a permalink lands on (render/html.js:135 anchorId).
function tokLines(src) {
  const text = String(src), bytes = utf8.Encode(text);
  let t = null;
  try { t = tok.parse(bytes, "mkd"); } catch (e) { t = null; }
  //  Past the lexer's 16 MiB cap there are no tokens: the page is its own text.
  if (t === null) return [[{ tag: "S", text: text, off: 0 }]];
  const out = [];
  let line = [], prev = 0;
  for (let i = 0; i < t.length; i++) {
    const end = TOK_END(t[i]), tag = TOK_TAG(t[i]), off = prev;
    let s = utf8.Decode(bytes.slice(prev, end));
    prev = end;
    const eol = s.charAt(s.length - 1) === "\n";
    if (eol) s = s.slice(0, s.length - 1);
    if (s !== "") line.push({ tag: tag, text: s, off: off });
    if (eol) { out.push(line); line = []; }
  }
  if (line.length) out.push(line);
  return out;
}

//  A line's structural PREFIX — the 'R' quads MKDT cut (DOG-024) and the 'T'
//  meta key it tags — and the content tokens that follow it.
function cutLine(line) {
  let i = 0;
  while (i < line.length && (line[i].tag === "R" || line[i].tag === "T")) i++;
  return { quads: line.slice(0, i), body: line.slice(i) };
}

//  The tokens' own bytes back, for the values that take no inline layer.
function rawText(toks) {
  let s = "";
  for (const t of toks) s += t.text;
  return s;
}

//  --- the marker inquiries (MKDT.h's, which reach C only) --------------------
//  A quad is an INDENT when it is blank, a QUOTE when it carries '>', and the
//  line's one MARKER otherwise; a 'T' quad is the meta-pair key (DOG-026).
function quadKind(q) {
  if (q.tag === "T") return "meta";
  if (q.text.indexOf(">") >= 0) return "quote";
  for (let i = 0; i < q.text.length; i++) {
    const c = q.text.charAt(i);
    if (c !== " " && c !== "\t") return "mark";
  }
  return "indent";
}

//  MKDTmarkList: a 4-char marker, told apart by its characters alone.
function markList(s) {
  if (s.length !== 4) return "";
  let dash = 0, dot = 0, brk = 0, dig = 0, sp = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c === "-") dash++;
    else if (c === ".") dot++;
    else if (c === "[") brk++;
    else if (c >= "0" && c <= "9") dig++;
    else if (c === " ") sp++;
  }
  if (brk === 1) return s.charAt(0) === "-" ? "todo" : "";
  if (dot === 1 && dig > 0) return "ol";
  if (dash === 1 && sp === 3) return "ul";
  return "";                             // header / ruler / fence quads
}

function markHeading(s) {                // MKDTmarkHeading: 1..4, else 0
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s.charAt(i) === "#") n++;
  return n;
}

function markFence(s) {                  // MKDTmarkFence: the backtick run
  return s.charAt(0) === "`" ? s.length : 0;
}

//  MKDTmarkHRule: the run stops at four, a 5th dash being a paragraph (DOG-028).
function markRule(s) {
  if (s.length < 3 || s.length > 4) return false;
  for (let i = 0; i < s.length; i++) if (s.charAt(i) !== "-") return false;
  return true;
}

function markRefDef(s) { return s.charAt(0) === "["; }

//  --- reference definitions --------------------------------------------------
//  `[key]: url "title"`.  MKDTB cuts the ONE-symbol form as a marker quad
//  (`[1]:`); a multi-char key is off that 4-char grammar and arrives as the
//  shortcut tokens the inline lexer made of it, so both shapes are read here
//  (wiki/StrictMark.mkd:44:x9-47).  -> { key, rest } or null.
function refdefOf(line) {
  const c = cutLine(line);
  const q = c.quads.length ? c.quads[c.quads.length - 1] : null;
  if (q !== null && quadKind(q) === "mark" && markRefDef(q.text))
    return { key: q.text.slice(1, q.text.length - 2), rest: c.body };
  const b = c.body;
  if (b.length < 3 || b[0].tag !== "G" || b[0].text !== "[") return null;
  let i = 1, key = "";
  while (i < b.length && !(b[i].tag === "G" && b[i].text === "]"))
    key += b[i++].text;
  const colon = i + 1 < b.length && b[i + 1].tag === "P" && b[i + 1].text === ":";
  return colon ? { key: key, rest: b.slice(i + 2) } : null;
}

//  The definition's value: the url runs to the first space, the quoted rest is
//  the title — the split cmark makes, over the tokens rather than the bytes.
function refValue(toks) {
  let i = 0, dest = "", title = "";
  while (i < toks.length && toks[i].tag === "W") i++;
  while (i < toks.length && toks[i].tag !== "W") dest += toks[i++].text;
  while (i < toks.length) title += toks[i++].text;
  title = title.trim();
  const q = title.charAt(0);
  if ((q === '"' || q === "'") && title.charAt(title.length - 1) === q)
    title = title.slice(1, title.length - 1);
  return { dest: dest, title: title };
}

//  --- the inline layer -------------------------------------------------------
function addNode(parent, type) {
  const n = new Node(type);
  parent.appendChild(n);
  return n;
}

//  Text lands in ONE run per stretch, so the caller's autolink hook
//  (http.js:352:8L) reads a whole reference rather than its pieces.
//  BEE-052:21 the run REMEMBERS those pieces all the same — `parts` says where
//  each token's bytes begin, so the emitter can address every one of them
//  without the hook ever seeing a reference cut in half.
function addText(parent, s, off) {
  const last = parent._lastChild;
  const n = last !== null && last.type === "text" ? last : addNode(parent, "text");
  if (typeof n.literal !== "string") n.literal = "";
  if (n.parts === undefined) n.parts = [];
  if (off >= 0) n.parts.push({ at: n.literal.length, off: off });
  n.literal += s;
}

//  An undefined shortcut IS a link to the page it names, `./Page.mkd`
//  (wiki/StrictMark.mkd:46:x9) — but only when the brackets hold a NAME: a space
//  or a lone character spells a `[ ]`/`[v]` todo box that fell off the 4-char
//  marker grammar, never a page.
function pageName(s) {
  return s.length > 1 && s.indexOf(" ") < 0 && s.indexOf("\t") < 0;
}

function implicitDest(label) {
  if (label.charAt(0) === "#") return label;
  const seg = label.slice(label.lastIndexOf("/") + 1);
  return seg.indexOf(".") >= 0 ? label : label + ".mkd";
}

//  The three symmetric spans, ONE symbol each — never `**` (StrictMark.mkd:37:x9).
const SPANS = { "*": "strong", "_": "emph", "~": "strikethrough" };

//  MKDT hands the delimiters over as their own 'G' tokens and re-lexes each
//  span body one level down (DOG-024), so the run arrives well nested: an
//  opener pushes its node, its twin — or a ']'-headed closer — pops it.  A
//  span the lexer could NOT decompose comes whole, as one 'G': that is text.
function inlineInto(parent, toks, ctx) {
  const st = [{ node: parent, delim: "", text: "" }];
  let code = null;
  //  The gap space after a marker, and any line-trailing run, are markup's own
  //  padding (wiki/StrictMark.mkd:68:x9) — never the block's first or last word.
  let lo = 0, hi = toks.length;
  while (lo < hi && toks[lo].tag === "W") lo++;
  while (hi > lo && toks[hi - 1].tag === "W") hi--;
  for (const t of toks.slice(lo, hi)) {
    const top = st[st.length - 1];
    if (code !== null) {                 // a code span takes no inline layer
      if (t.tag === "G" && t.text === "`") code = null;
      else code.literal += t.text;
      continue;
    }
    if (t.tag === "N") { addNode(top.node, "softbreak"); continue; }
    if (t.tag === "G") {
      const g = t.text;
      if (g === "`") {
        code = addNode(top.node, "code");
        code.literal = "";
        code.boff = t.off;               // BEE-052:22 markup answers for its own bytes
        continue;
      }
      if (SPANS[g] !== undefined) {
        if (top.delim === g) st.pop();
        else {
          const n = addNode(top.node, SPANS[g]);
          n.boff = t.off;
          st.push({ node: n, delim: g, text: "" });
        }
        continue;
      }
      if (g === "[" || g === "![") {
        const n = addNode(top.node, g === "[" ? "link" : "image");
        n.boff = t.off;
        st.push({ node: n, delim: g, text: "" });
        continue;
      }
      if (g.charAt(0) === "]" && st.length > 1) {
        const f = st.pop(), n = f.node;
        //  `][l]` names an explicit label; a bare `]` is the SHORTCUT, keyed
        //  on its own bracket text (wiki/StrictMark.mkd:42:x9-46).
        const shortcut = g.length === 1;
        const label = shortcut ? f.text : g.slice(2, g.length - 1);
        const r = ctx.refs.get(label);
        if (r !== undefined) { n.destination = r.dest; n.title = r.title; }
        else if (shortcut && pageName(label)) n.destination = implicitDest(label);
        else if (shortcut) {             //  no page and no definition: the bytes
          n.unlink();
          addText(st[st.length - 1].node, "[" + f.text + "]", n.boff);
          st[st.length - 1].text += "[" + f.text + "]";
          continue;
        } else n.destination = "";       //  an undefined label is no link at all
        st[st.length - 1].text += f.text;
        continue;
      }
    }
    //  A `\*` escape reaches here with its backslash: the lexer shortened only
    //  its own callback slice, never the token span (dog/HUNK.c:1560).
    let s = t.text;
    if (t.tag === "P" && s.length === 2 && s.charAt(0) === "\\") s = s.charAt(1);
    top.text += s;
    addText(top.node, s, t.off);
  }
}

//  --- the block layer --------------------------------------------------------
//  One frame per prefix quad, as StrictMark's `(INDENT|QUOTE)* LIST? LEAF?`
//  stacks them: frame i holds the content of quad-depth i+1.  A list frame's
//  <li> stays open, so a deeper line nests INSIDE the item (beagle/mark's
//  mark_blocks, MARK.c:396).
const KINDS = { ul: "bullet", ol: "ordered", todo: "bullet" };

//  parse(src) -> the document node.  Two passes over the token lines, as
//  beagle/mark makes them (MARK.c:569): the reference definitions first, since
//  they resolve links that precede them, then the blocks — one leaf per line,
//  its content buffered into a run that a wrap, not a line end, continues.
function parse(src) {
  const doc = new Node("document");
  const lines = tokLines(src);
  const ctx = { refs: new Map() };
  //  Pass 1: definitions are collected wherever they sit and never rendered.
  for (const line of lines) {
    const d = refdefOf(line);
    if (d !== null && !ctx.refs.has(d.key)) ctx.refs.set(d.key, refValue(d.rest));
  }

  const st = [];                         // the open container frames
  let run = null;                        // the open inline run (a paragraph)
  let meta = null;                       // the open <dl> of meta pairs
  let fence = null;                      // the open code block
  let fenceAt = 0;                       // its own quad depth

  const inner = function () {
    if (st.length === 0) return doc;
    const f = st[st.length - 1];
    return f.item !== null ? f.item : f.node;
  };
  const flush = function () {
    if (run !== null) inlineInto(run.node, run.toks, ctx);
    run = null;
  };
  //  Close every frame past `n`, the buffered run living in the innermost.
  const unwind = function (n) {
    if (st.length <= n) return;
    flush();
    while (st.length > n) st.pop();
    meta = null;
  };
  //  Drop the frames this line's quad path disagrees with: a quote quad wants a
  //  <blockquote> and an indent quad any other container — a list opened by a
  //  marker one level up owns the indent below it.
  const conflicts = function (path) {
    for (let i = 0; i < path.length && i < st.length; i++) {
      const k = st[i].kind, want = path[i];
      if (want === "quote" ? k === "quote" : k !== "quote") continue;
      unwind(i);
      break;
    }
  };
  //  Open the ancestors the path names but nothing occupies yet.
  const grow = function (path) {
    while (st.length < path.length) {
      const quote = path[st.length] === "quote";
      const n = addNode(inner(), quote ? "block_quote" : "custom_block");
      if (!quote) { n.onEnter = "<div>\n"; n.onExit = "</div>\n"; }
      st.push({ kind: quote ? "quote" : "div", node: n, item: null });
    }
  };
  //  A LEAF has no child container, so it closes everything at its own depth
  //  and renders in the frame above (beagle/mark's mark_enter_leaf).
  const enterLeaf = function (path) {
    conflicts(path);
    unwind(path.length);
    grow(path);
  };

  for (const line of lines) {
    const c = cutLine(line);
    //  BEE-052:23 a block answers for the line that opened it, the leading quad
    //  included: a landing names a line, and a quad is where a line begins.
    const loff = line.length ? line[0].off : -1;
    const quads = c.quads;
    const lastq = quads.length ? quads[quads.length - 1] : null;
    const kind = lastq === null ? "" : quadKind(lastq);
    const mark = kind === "mark" || kind === "meta" ? lastq : null;
    const path = quads.slice(0, mark === null ? quads.length : quads.length - 1)
                      .map(quadKind);
    const depth = path.length;

    //  A fence's body is the lexer's ruling, not ours: it emits every body line
    //  as one verbatim 'H' with no quads at all, and quads mean the block ended.
    if (fence !== null) {
      if (quads.length === 0) {
        let s = rawText(line);
        for (let i = 0; i < (fenceAt + 1) * 4 && s.charAt(0) === " "; i++)
          s = s.slice(1);                //  the body's indent is markup, not code
        fence.literal += s + "\n";
        continue;
      }
      fence = null;
      if (mark !== null && markFence(mark.text)) continue;   // the explicit closer
    }

    if (rawText(line).trim() === "") {
      //  A blank flushes the run and closes any list or quote leaf; enclosing
      //  divs persist, so a blank-separated multi-paragraph div stays one.
      flush();
      while (st.length > 0 && st[st.length - 1].kind !== "div") st.pop();
      meta = null;
      continue;
    }

    //  A definition line renders nothing, in either of its two shapes.
    if (refdefOf(line) !== null) { flush(); meta = null; continue; }

    //  A markerless line at the run's own depth continues it, wrap and all.
    if (mark === null && run !== null && run.depth === depth) {
      run.toks.push({ tag: "N", text: "\n" });
      for (const t of c.body) run.toks.push(t);
      continue;
    }
    //  So does a line under a meta pair: a value is verbatim and runs one quad
    //  deeper than its key, as any leaf's content does (DOG-026, MKDT.c:463:GT).
    if (mark === null && meta !== null && meta.depth + 1 === depth) {
      flush();
      addText(meta.dd, " " + rawText(c.body).trim(), loff);
      continue;
    }
    flush();
    if (kind !== "meta") meta = null;

    //  The one CONTAINER leaf: a list marker keeps its level open, so it
    //  reconciles one frame deeper than any other line and reuses a same-kind
    //  list already there (beagle/mark's mark_enter_list, MARK.c:481).
    const list = mark !== null && kind === "mark" ? markList(mark.text) : "";
    if (list !== "") {
      conflicts(path);
      unwind(depth + 1);
      if (!(st.length === depth + 1 && st[depth].list === list)) {
        unwind(depth);
        grow(path);
        const l = addNode(inner(), "list");
        l.boff = loff;
        l.listType = KINDS[list];
        l.listTight = true;
        if (list === "ol") l.listStart = parseInt(mark.text, 10) || 1;
        st.push({ kind: "list", list: list, node: l, item: null });
      }
      const it = addNode(st[depth].node, "item");
      it.boff = loff;
      //  LITE-031's shape: the state rides the node, the `-[·]` marker is gone.
      if (list === "todo") {
        const s = mark.text.charAt(2);
        it.taskChecked = s === "v" || s === "V" || s === "x" || s === "X";
      }
      st[depth].item = it;
      const p = addNode(it, "paragraph");
      p.boff = loff;
      run = { node: p, toks: c.body.slice(), depth: depth + 1 };
      continue;
    }

    enterLeaf(path);

    if (mark === null) {                 // a paragraph, the implied leaf
      const p = addNode(inner(), "paragraph");
      p.boff = loff;
      run = { node: p, toks: c.body.slice(), depth: depth };
      continue;
    }
    if (kind === "meta") {               // `Key: value`, a page's own metadata
      if (meta === null || meta.depth !== depth) {
        const dl = addNode(inner(), "custom_block");
        dl.onEnter = '<dl class="meta">\n';
        dl.onExit = "</dl>\n";
        meta = { node: dl, dd: null, depth: depth };
      }
      const dt = addNode(meta.node, "custom_block");
      dt.onEnter = '<dt id="b' + loff + '">'; dt.onExit = "</dt>\n";
      addText(dt, mark.text.slice(0, mark.text.length - 1), -1);
      const dd = addNode(meta.node, "custom_block");
      dd.onEnter = "<dd>"; dd.onExit = "</dd>\n";
      addText(dd, rawText(c.body).trim(), c.body.length ? c.body[0].off : -1);
      meta.dd = dd;
      continue;
    }
    const level = markHeading(mark.text);
    if (level > 0) {
      const h = addNode(inner(), "heading");
      h.boff = loff;
      h.level = level > 6 ? 6 : level;
      inlineInto(h, c.body, ctx);
      continue;
    }
    if (markFence(mark.text)) {
      fence = addNode(inner(), "code_block");
      fence.boff = loff;
      fence.literal = "";
      fence.info = rawText(c.body).trim();
      fenceAt = depth;
      continue;
    }
    if (markRule(mark.text)) {
      addNode(inner(), "thematic_break").boff = loff;
      //  A captioned ruler: the caption opens a run of its own (DOG-028).
      if (rawText(c.body).trim() !== "") {
        const p = addNode(inner(), "paragraph");
        run = { node: p, toks: c.body.slice(), depth: depth };
      }
      continue;
    }
    //  A marker off every known shape stays what it reads as: plain text.
    const p = addNode(inner(), "paragraph");
    p.boff = loff;
    run = { node: p, toks: [mark].concat(c.body), depth: depth };
  }
  flush();
  return doc;
}

function toHtml(src, opts) {
  return require("mark/html.js").render(parse(src), opts);
}

module.exports = { parse: parse, toHtml: toHtml };
