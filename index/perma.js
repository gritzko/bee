//  index/perma.js — LITE-025: FOLLOW a permalink `file.c:k4:d8K3`.  Segment 1 is
//  a ron64 BYTE OFFSET into the file's blob AS THE ANCHORED VERSION HAD IT,
//  segment 2 a ron64 BLOB HASHLET — a blob id prefix and NOTHING ELSE (ruled
//  2026-08-14: no commit-id tier).  Minting lives elsewhere; this file walks.
//
//  BLOB OFFSET, NEVER A WEAVE OFFSET (ruled): the fold's ranges are
//  tokenizer-dependent, so a weave rebuild under a new lexer would re-point every
//  link; blob bytes are canonical git ground.
//
//  THE WALK
//   1. the hashlet's ron64 pairs unpack to a HEX PREFIX — 12 bits a pair, three
//      hex digits, big-endian — which is what the named blob's sha1 carries;
//   2. the SCOPE IS ONE FILE, never repo-wide (that is what keeps a hashlet four
//      characters long): the blobs this path itself ever held, EARLIEST in the
//      path's history order, then its staged/working blob — a link minted on
//      content no commit carries yet;
//   3. the anchored blob is folded, then the CURRENT worktree bytes are folded
//      ON TOP — one CFOLD pair, exactly what view/diff.js does;
//   4. walking the weave AT THE ANCHOR names the token covering the byte (its
//      body offset IS its identity), walking AT THE HEAD says where that same
//      token sits today: the anchored line, wherever later commits pushed it;
//   5. a token later DELETED still has a place in the weave — the follow lands
//      where it stood and the caller says which commit took it.
//
//  EARLIEST WINS, in the path's own history order: a file reverted to an older
//  version carries that older blob AGAIN, and the link means the first of them —
//  a younger blob sharing the prefix was minted a longer hashlet of its own.
"use strict";

const idx = require("./index.js");
const lg = require("view/log.js");
const rd = require("./read.js");
const wv = require("./weave.js");

//  Two distinct 16-hex layer ids, view/diff.js's own; only != matters.
const ID_WAS = "0000000000000001", ID_NOW = "0000000000000002";
//  A deleting commit is looked for over the path's own history, oldest first;
//  a long-dead line in a long history stops being worth a fold at some point.
const DELETER_SCAN = 64;

//  --- the anchor segments ---------------------------------------------------
//  RON64 is 0-9 A-Z _ a-z ~.  `ron.decode` is THE reader for it (no alphabet
//  table here); these two only gate what is handed to it.
function isRon64(s) {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x30 && c <= 0x39) continue;           // 0-9
    if (c >= 0x41 && c <= 0x5a) continue;           // A-Z
    if (c >= 0x61 && c <= 0x7a) continue;           // a-z
    if (c === 0x5f || c === 0x7e) continue;         // _ ~
    return false;
  }
  return true;
}
function allDigits(s) {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return false;
  }
  return true;
}

//  Is this pair of segments a permalink?  SEGMENT 2 DECIDES (the ruling): a
//  hashlet is even, at least 4 chars, and carries a non-digit — an all-digit
//  segment 2 is a COLUMN and the ref stays LITE-024's line:col.
function isHashlet(s) {
  return isRon64(s) && s.length >= 4 && s.length <= 10 && (s.length & 1) === 0 &&
         !allDigits(s);
}
function isOffset(s) { return isRon64(s) && s.length <= 10; }

//  The hashlet -> the hex prefix a matching sha1 carries.  Each PAIR of ron64
//  chars is one 12-bit chunk (`ron.decode` of the pair IS that chunk), spelled
//  back as three hex digits, big-endian.
function hashletHex(h) {
  if (!isHashlet(h)) return null;
  let out = "";
  for (let i = 0; i < h.length; i += 2) {
    let v;
    try { v = Number(ron.decode(h.slice(i, i + 2))); } catch (e) { return null; }
    if (!(v >= 0 && v < 4096)) return null;
    out += v.toString(16).padStart(3, "0");
  }
  return out;
}

function offsetOf(s) {
  if (!isOffset(s)) return -1;
  let v;
  try { v = Number(ron.decode(s)); } catch (e) { return -1; }
  return v >= 0 ? v : -1;
}

//  --- the mint (LITE-026) ---------------------------------------------------
//  The INVERSE of hashletHex/offsetOf, beside them so ONE file owns the ron64
//  packing in both directions.  `ron.encode` drops a leading zero and a hashlet
//  is read two chars at a time, so a pair is padded back to width 2.
function packPair(v) { return ron.encode(BigInt(v)).padStart(2, "0"); }
function packOffset(n) { const s = ron.encode(BigInt(n)); return s === "" ? "0" : s; }

//  A blob sha1 (hex) -> the SHORTEST hashlet that names it among `others` — the
//  path's own other blobs, which is the whole scope.  Min 4 chars, EVEN (12 bits
//  a pair), one non-digit (that is what tells segment 2 from a column), extended
//  BY 2 until unique.  null = even 10 chars collide, so nothing is minted.
function mintHashlet(sha, others) {
  for (let pairs = 2; pairs <= 5; pairs++) {
    const hexn = pairs * 3;
    if (sha.length < hexn) return null;
    let h = "";
    for (let i = 0; i < pairs; i++)
      h += packPair(parseInt(sha.slice(i * 3, i * 3 + 3), 16));
    if (!isHashlet(h)) continue;                  // all-digit: extend by 2
    let clash = false;
    for (const o of others || [])
      if (o !== sha && o.slice(0, hexn) === sha.slice(0, hexn)) { clash = true; break; }
    if (!clash) return h;
  }
  return null;
}

//  The INVERSE of lineCol: a 1-based line:col -> the byte offset, -1 when the
//  blob has no such line (the caller then mints nothing — never a guess).  A
//  column past the line's own bytes clamps to it: a compiler counts columns its
//  own way, and the LINE is what the ref means.
function byteAt(bytes, line, col) {
  if (!(line >= 1)) return -1;
  let at = 0;
  for (let k = 1; k < line; k++) {
    while (at < bytes.length && bytes[at] !== 0x0a) at++;
    if (at >= bytes.length) return -1;
    at++;
  }
  if (at >= bytes.length) return -1;
  let end = at;
  while (end < bytes.length && bytes[end] !== 0x0a) end++;
  let off = at + (col > 1 ? col - 1 : 0);
  if (off > end) off = end > at ? end - 1 : at;
  return off;
}

//  --- the anchored version --------------------------------------------------
//  EARLIEST WINS: a younger blob sharing the prefix was minted a longer hashlet
//  of its own, so the old link keeps its old meaning.  The sha breaks a
//  same-second tie, so the answer never depends on the walk order.
function earliest(cands) {
  if (!cands || cands.length === 0) return null;
  let best = cands[0];
  for (const c of cands)
    if (c.ts < best.ts || (c.ts === best.ts && c.sha < best.sha)) best = c;
  return best;
}

//  The path's own commits (fileLog IS the `git log -- <path>` graph), oldest
//  first — the history order every "earliest" here means.
function historyOf(ix, r, rel) {
  const out = [];
  const w = lg.fileLog(ix, r, rel, 0);
  for (const hl of w.hls) {
    const hex = idx.hexOfHl(hl);
    const m = idx.readCommit(r, hex);
    if (m !== null) out.push({ sha: hex, ts: m.ts, m: m });
  }
  out.sort(function (a, b) { return a.ts - b.ts || (a.sha < b.sha ? -1 : a.sha > b.sha ? 1 : 0); });
  return out;
}


//  --- the bytes -------------------------------------------------------------
function blobAt(ctx, commit, rel) {
  const e = rd.entryAt(ctx.r, commit.m.tree, rel);
  if (e === null || e.dir) return null;
  const o = idx.object(ctx.r, e.sha);
  return o === null || o.type !== "blob" ? null : o.bytes;
}

//  LITE-026: the DISTINCT blob ids this path ever held, oldest first — the
//  hashlet SCOPE both halves share: the follow filters it, the mint extends
//  against it.  One file's blobs, never the repository's.
function blobHistory(ctx, ix, rel) {
  const out = [];
  for (const c of historyOf(ix, ctx.r, rel)) {
    const e = rd.entryAt(ctx.r, c.m.tree, rel);
    if (e === null || e.dir) continue;
    if (out.indexOf(e.sha) < 0) out.push(e.sha);
  }
  return out;
}

//  The commits of this path whose blob AT THIS PATH carries the prefix.  A file
//  reverted to an older version answers twice, which is what `earliest` is for.
function blobsFor(ctx, ix, rel, hexpfx) {
  const out = [];
  for (const c of historyOf(ix, ctx.r, rel)) {
    const e = rd.entryAt(ctx.r, c.m.tree, rel);
    if (e === null || e.dir) continue;
    if (e.sha.slice(0, hexpfx.length) === hexpfx)
      out.push({ sha: c.sha, ts: c.ts, m: c.m, blob: e.sha });
  }
  return out;
}

//  The WORKING copy's own blob id — a link minted on content no commit carries.  (lite never reads `.git/index`, so a
//  staged-only change reads as a worktree one — view/diff.js's own stance.)
function blobIdOf(bytes) {
  const head = utf8.Encode("blob " + bytes.length);   // then the NUL git puts
  const all = new Uint8Array(head.length + 1 + bytes.length);
  all.set(head, 0);
  all[head.length] = 0;
  all.set(bytes, head.length + 1);
  return hex.encode(sha1(all));
}

//  The bytes the pager will actually PAINT: the worktree file, which is what
//  main.js's openPath opens.  A file gone from the checkout has no landing.
function nowBytes(abs) {
  let st = null;
  try { st = io.lstat(abs); } catch (e) { return null; }
  if (st.kind === "dir") return null;
  if (st.kind === "reg" && st.size === 0) return new Uint8Array(0);
  try { const m = io.mmap(abs, "r"); return m.data ? m.data() : m; }
  catch (e) { return null; }
}

function weavable(a, b) {
  return a !== null && b !== null &&
         a.length <= wv.MAX_SOURCE_SIZE && b.length <= wv.MAX_SOURCE_SIZE &&
         !wv.isBinary(a) && !wv.isBinary(b);
}

//  A byte position -> the 1-based line and byte column the pager lands on.
function lineCol(bytes, at) {
  let line = 1, col = 1;
  const n = at < bytes.length ? at : bytes.length;
  for (let i = 0; i < n; i++) {
    if (bytes[i] === 0x0a) { line++; col = 1; } else col++;
  }
  return { line: line, col: col };
}

//  --- the weave walks -------------------------------------------------------
//  At the ANCHOR rev: the token covering `off`, named by its BODY OFFSET (the
//  weave's identity) plus how far into it the byte sits.
function tokenAt(w, off) {
  w.rewind(ID_WAS);
  let pos = 0, last = null;
  while (w.next()) {
    const t = w.tok;
    if (!t.alive) continue;
    if (off >= pos && off < pos + t.text.length)
      return { id: t.off, delta: off - pos };
    last = t;
    pos += t.text.length;
  }
  //  `off` at the very end of the blob: the last token is what it names.
  if (last !== null && off === pos)
    return { id: last.off, delta: last.text.length - 1 };
  return null;
}

//  At the HEAD rev: where that same token sits now — `at` is the byte, `dead`
//  says the token is gone and `at` is merely where it stood.
//  LITE-029: `lo`/`hi` are the token's own bytes today — the identity the pager
//  selects, so nothing has to be re-derived from the column.
function tokenNow(w, id, delta) {
  w.rewind(ID_NOW);
  let pos = 0;
  while (w.next()) {
    const t = w.tok;
    if (t.off === id) {
      if (!t.alive) return { at: pos, dead: true };
      const d = delta < t.text.length ? delta : t.text.length - 1;
      return { at: pos + (d > 0 ? d : 0), dead: false,
               lo: pos, hi: pos + t.text.length };
    }
    if (t.alive) pos += t.text.length;
  }
  return null;
}

//  --- the fold scratch (view/diff.js's own reason: no per-call 16 MB maps) --
let _wWas = null, _wNow = null;
function scratch() {
  if (_wWas === null) {
    _wWas = abc.ram("CFOLD", wv.MAX_SOURCE_MARKED_UP);
    _wNow = abc.ram("CFOLD", wv.MAX_SOURCE_MARKED_UP);
  }
}
//  was -> now as ONE fold pair; a lexer that cannot take the source falls back
//  to the plain tokenizer, as view/diff.js's fold2 does.
function foldPair(was, now, ext) {
  scratch();
  const go = function (e) {
    const a = _wWas.fold(null, was, e, ID_WAS, []);
    return _wNow.fold(a, now, e, ID_NOW, [ID_WAS]);
  };
  try { return go(ext); }
  catch (err) {
    if (!("" + err).includes("full")) return null;
    try { return go(""); } catch (e2) { return null; }
  }
}

//  LITE-026: walk the NOW side of a was->now fold, handing every ALIVE token to
//  `at(tok, lo, hi, fresh)` — `lo`/`hi` are its bytes in NOW, `fresh` says the
//  WAS side does not carry it (ADDED TEXT).  The mint's added-line scan and the
//  follow share this one fold pair; false = the pair is not weavable.
function walkNew(was, now, ext, at) {
  if (!weavable(was, now)) return false;
  const w = foldPair(was, now, ext);
  if (w === null) return false;
  const old = new Set();
  w.rewind(ID_WAS);
  while (w.next()) if (w.tok.alive) old.add(w.tok.off);
  w.rewind(ID_NOW);
  let pos = 0;
  while (w.next()) {
    const t = w.tok;
    if (!t.alive) continue;
    const lo = pos;
    pos += t.text.length;
    at(t, lo, pos, !old.has(t.off));
  }
  return true;
}

//  --- the deleting commit ---------------------------------------------------
//  Which commit took the line?  The path's own commits NEWER than the anchor,
//  oldest first: the first one whose blob no longer carries the token is it.
//  Bounded — a long-dead line in a long history says "since <anchor>" instead.
function deleterOf(ctx, ix, rel, anchor, id, ext) {
  const w = lg.fileLog(ix, ctx.r, rel, 0);
  const later = [];
  for (const hl of w.hls) {
    const hex = idx.hexOfHl(hl);
    if (hex === anchor.sha) continue;
    const m = idx.readCommit(ctx.r, hex);
    if (m === null || m.ts < anchor.ts) continue;
    later.push({ sha: hex, ts: m.ts, m: m });
  }
  later.sort(function (a, b) { return a.ts - b.ts || (a.sha < b.sha ? -1 : 1); });
  const was = blobAt(ctx, anchor, rel);
  if (was === null) return null;
  for (let i = 0; i < later.length && i < DELETER_SCAN; i++) {
    const then = blobAt(ctx, later[i], rel);
    if (!weavable(was, then === null ? new Uint8Array(0) : then)) continue;
    if (then === null) return later[i];             // the whole file went
    const w2 = foldPair(was, then, ext);
    if (w2 === null) continue;
    const at = tokenNow(w2, id, 0);
    if (at === null || at.dead) return later[i];
  }
  return null;
}

//  --- the follow ------------------------------------------------------------
//  follow(partial, offSeg, hash, from) -> null (a quiet miss, the caller's own
//  message stands), { rels } when the partial names SEVERAL files that answer
//  (the caller's chooser), or { rel, full, line, col, note } — the landing.
function follow(partial, offSeg, hash, from) {
  const hexpfx = hashletHex(hash);
  const off = offsetOf(offSeg);
  if (hexpfx === null || off < 0) return null;
  let ctx;
  try { ctx = idx.openRepo(from || io.cwd(), true); } catch (e) { return null; }
  try {
    const ix = idx.openIndex(ctx.gitdir);
    try {
      idx.bringUp(ctx, ix, { track: false });       // the lazy contract, as ever
      //  The path is named the way every other lite reference is — the LITE-011
      //  descent at HEAD, so `FSW.c`, `abc/FSW.c` and the full spelling all work.
      //  A chooser row hands back the ABSOLUTE path it painted; inside this repo
      //  that is the root-relative one, which is what the descent reads.
      let p = String(partial);
      const pre = ctx.root + "/";
      if (p.slice(0, pre.length) === pre) p = p.slice(pre.length);
      const rels = require("./resolve.js").resolveAt(ctx, ix, ctx.head.sha, p);
      const hits = [], seats = [];
      for (const rel of rels) {
        const seat = land(ctx, ix, rel, hexpfx, off);
        if (seat === null) continue;
        hits.push({ rel: rel, full: ctx.root + "/" + rel });
        seats.push(seat);
      }
      if (hits.length === 0) return null;
      if (hits.length > 1) return { rels: hits };
      return seats[0];
    } finally { try { ix.close(); } catch (e) {} }
  } catch (e) { return null; }
  finally { idx.closeRepo(ctx); }
}

//  The anchored version: the path's own blob history first (EARLIEST match), the
//  staged/working blob after it — the whole scope, in order.
//  -> { was, commit, tier } — `commit` is null for a working-copy anchor.
function anchorOf(ctx, ix, rel, full, hexpfx) {
  const b = earliest(blobsFor(ctx, ix, rel, hexpfx));
  if (b !== null) {
    const o = idx.object(ctx.r, b.blob);
    if (o !== null && o.type === "blob")
      return { was: o.bytes, commit: b, tier: "blob" };
  }
  const wt = nowBytes(full);
  if (wt !== null && blobIdOf(wt).slice(0, hexpfx.length) === hexpfx)
    return { was: wt, commit: null, tier: "work" };
  return null;
}

function land(ctx, ix, rel, hexpfx, off) {
  const full = ctx.root + "/" + rel;
  const a = anchorOf(ctx, ix, rel, full, hexpfx);
  if (a === null) return null;
  const anchor = a.commit, was = a.was;
  if (off >= was.length) return null;
  const now = nowBytes(full);
  if (now === null) return null;
  const seat = { rel: rel, full: full, line: 0, col: 0, note: "", tier: a.tier,
                 anchor: anchor === null ? "" : anchor.sha.slice(0, 8) };
  //  Nothing moved: the blob offset IS today's offset, no fold needed.
  if (wv.bytesEq(was, now)) {
    const lc = lineCol(now, off);
    seat.line = lc.line; seat.col = lc.col;
    return seat;
  }
  const ext = wv.extOf(rel);
  if (!weavable(was, now)) {
    //  Unweavable (binary, or over the source cap): the blob offset is all
    //  there is — the anchored line as the commit saw it.
    const lc = lineCol(was, off);
    seat.line = lc.line; seat.col = lc.col;
    return seat;
  }
  const w = foldPair(was, now, ext);
  if (w === null) return null;
  const tk = tokenAt(w, off);
  if (tk === null) return null;
  const at = tokenNow(w, tk.id, tk.delta);
  if (at === null) return null;
  const lc = lineCol(now, at.at);
  seat.line = lc.line; seat.col = lc.col;
  //  LITE-029: an ALIVE token hands the pager its bytes, not just a column.
  if (!at.dead) { seat.lo = at.lo; seat.hi = at.hi; }
  if (at.dead) {
    const who = anchor === null ? null : deleterOf(ctx, ix, rel, anchor, tk.id, ext);
    seat.note = who !== null ? "deleted in " + who.sha.slice(0, 8)
              : anchor !== null ? "deleted since " + anchor.sha.slice(0, 8)
                                : "the anchored line is gone";
  }
  return seat;
}

module.exports = { follow: follow, earliest: earliest, anchorOf: anchorOf,
                   blobIdOf: blobIdOf, blobHistory: blobHistory,
                   hashletHex: hashletHex, offsetOf: offsetOf,
                   mintHashlet: mintHashlet, packOffset: packOffset,
                   walkNew: walkNew,
                   isHashlet: isHashlet, isOffset: isOffset,
                   lineCol: lineCol, byteAt: byteAt };
