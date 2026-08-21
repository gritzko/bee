//  index/kv.js — BEE-024: the KEYED lane beside the wh128 family, one
//  `abc.index("kv64", …)` stack at `<gitdir>/be/*.kv.idx`.  A re-put OVERWRITES,
//  so a row is a mutable CELL where a lite2 row is a fact — which is what lets
//  `Now: OPEN` flip to `DONE` in place (TODO-003 is the model).  The first
//  records are FILE HEADERS: the StrictMark meta pairs under a `#   Title`
//  (/meta/todo) and the keys of a Markdown YAML preamble.  The lane decides
//  WHICH files a board opens and never what to show, so titles and bodies still
//  come off the file; `find` is the one door and it brings itself up to date.
"use strict";

const idx = require("./index.js");
const status = require("view/status.js");

//  Rows put between two commits fit ONE 4 KB memtable page (256 kv64 rows).
const KV_BATCH = 200;
//  A page cap on the text read: a meta block and a preamble both live at the top.
const PAGE_CAP = 1 << 20;

//  --- the field split -------------------------------------------------------
//  key = path_hl:40 | key_code:20 | kind:4,  val = vkind:4 | payload:60.
const PHL_BITS = 40n, CODE_BITS = 20n, KIND_BITS = 4n;
const SUB_BITS = CODE_BITS + KIND_BITS;
const MARK_PHL = (1n << PHL_BITS) - 1n;    // reserved: sorts ABOVE every block
const CODE_HEAD = (1n << CODE_BITS) - 1n;  // reserved: the block header row
const CODE_MAX = (1n << 18n) - 1n;         // the widest verbatim 3-char code

const K_HEAD = 0x1n;                       // a StrictMark meta pair
const K_YAML = 0x2n;                       // a YAML preamble key
const K_MARK = 0xFn;                       // the per-worktree mark sentinel

const VK_LIT = 0x0n;                       // payload = ron60 of the value
const VK_HASH = 0x1n;                      // payload = hashlet60 of the value
const VK_MARK = 0x2n;                      // payload = the max mtime seen
const VK_HEAD = 0xEn;                      // payload = the owning worktree's code
const VK_TOMB = 0xFn;                      // the pair or the file is GONE

function packKey(phl, code, kind) {
  return (phl << SUB_BITS) | (code << KIND_BITS) | kind;
}
function packVal(vkind, payload) { return (vkind << 60n) | payload; }
function valKind(v) { return v >> 60n; }
function valPayload(v) { return v & ((1n << 60n) - 1n); }
function keyPhl(k) { return k >> SUB_BITS; }
function keyCode(k) { return (k >> KIND_BITS) & CODE_HEAD; }
function keyKind(k) { return k & 0xFn; }

//  A block's rows are held under the key's low 24 bits, the (code, kind) pair
//  that names ONE cell of one file.
function subOf(code, kind) { return Number((code << KIND_BITS) | kind); }
function subCode(sub) { return BigInt(sub >> 4); }
function subKind(sub) { return BigInt(sub & 0xF); }

//  40 bits over the WORKTREE-QUALIFIED (absolute) path, so two checkouts of one
//  repo share the lane and never share a block.  MARK_PHL is reserved, so the
//  one path in 2^40 that lands on it is nudged down (a collision is caught below).
function pathHl(abs) {
  const h = idx.hlOfText(abs) >> 20n;
  return h === MARK_PHL ? h - 1n : h;
}
//  The worktree's 20-bit code: the HEAD row carries it and the mark row is keyed
//  by it, so one worktree's sweep never marks or tombstones another's rows.
function wtCode(wt) { return idx.hlOfText(wt) >> 40n; }

//  --- the key codes ---------------------------------------------------------
//  A meta key is its 3 chars VERBATIM at 6 bits each — RON64 IS that alphabet,
//  so `ron.decode` IS the packing.  null when the key would not round-trip.
const META_KEY = /^[A-Z][a-z][a-z0-9]$/;
function codeOf(key) {
  if (!META_KEY.test(key)) return null;
  let c;
  try { c = ron.decode(key); } catch (e) { return null; }
  if (ron.encode(c) !== key || c > CODE_MAX) return null;
  return c;
}
function keyOf(code) { try { return ron.encode(code); } catch (e) { return null; } }

//  A YAML key hashes instead: the TOP 20 bits of its text hashlet, under its own
//  kind nibble, so `Now:` and `now:` can never meet.  CODE_HEAD is reserved.
function yamlCode(key) {
  const c = idx.hlOfText(key) >> 40n;
  return c === CODE_HEAD ? c - 1n : c;
}

//  --- the values ------------------------------------------------------------
//  Despaced and decased: the payload is a MATCH TOKEN, never a render source.
function normalize(v) { return String(v).replace(/\s+/g, "").toLowerCase(); }

//  Per-key normalizers, where a RANGE is worth having.  `Due: 2026-08-19` becomes
//  the ron60 date stamp, so deadlines sort and `Due:` takes a prefix.
const NORM = {
  Due: function (raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(raw).trim());
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (t !== t) return null;
    return packVal(VK_LIT, ron.of(t));
  }
};

//  A raw value -> its row val: LITERAL when the normalized form round-trips
//  through ron60 (it then ranges and compares exactly), else its hashlet60.
function packValue(key, raw) {
  const nrm = NORM[key];
  if (nrm) { const v = nrm(raw); if (v !== null) return v; }
  const s = normalize(raw);
  if (s !== "") {
    let n = null;
    try { n = ron.decode(s); } catch (e) { n = null; }
    if (n !== null && n <= (1n << 60n) - 1n && ron.encode(n) === s)
      return packVal(VK_LIT, n);
  }
  return packVal(VK_HASH, idx.hlOfText(s));
}

//  --- the lexer -------------------------------------------------------------
//  The meta pair is LINE-LOCAL by design, so the regex IS the grammar
//  ([/wiki/StrictMark]).  A ticket header is plainly indented — column 0 or the
//  one four-space run — and the third char may be a digit (`On1:`, `On2:`).
const PAIR_RE = /^(?: {4})?([A-Z][a-z][a-z0-9]): (.*)$/;
//  A top-level YAML key with its value on the same line; an INDENTED line, a
//  list item and a key whose value is a block all fall out of this shape.
const YAML_RE = /^([A-Za-z_][A-Za-z0-9_.-]*):[ \t]+(\S.*)$/;

//  Where the body starts: a `---` at line 1 opens a preamble, and the meta block
//  a StrictMark title carries stands after it.  BEE-029 moved the rule to
//  `mark/front.js`, so the lane and the rendered page split a file alike.
const bodyStart = require("mark/front.js").bodyLine;

//  The file's OWN meta pairs: the block standing directly under the title
//  (/meta/todo).  One leading non-pair line — the header itself — is skipped,
//  blanks pass, and the first other construct ends the block, so the four-space
//  pairs buried in a bulletpoint below are not the file's meta.  First wins.
//  BEE-043: a pair also says WHERE it stands — its line and the indent the
//  grammar found it at — so done.js edits the very line this lexer read and no
//  writer needs a second regex (BEE-043).
function metaPairs(lines) {
  const out = [];
  let header = false;
  for (let i = bodyStart(lines); i < lines.length; i++) {
    const ln = lines[i];
    if (ln.trim() === "") continue;
    const m = PAIR_RE.exec(ln);
    if (m) {
      out.push({ key: m[1], value: m[2].trim(), line: i,
                 indent: ln.charAt(0) === " " ? "    " : "" });
      continue;
    }
    if (header || out.length) break;
    header = true;
  }
  return out;
}

//  The YAML preamble's TOP-LEVEL keys.  A nested block, a list and a multiline
//  scalar are SKIPPED whole (the key too): the payload is a match token, and a
//  value this lane cannot spell on one line is no token at all.
function yamlPairs(lines) {
  const out = [];
  if (!lines.length || lines[0].trim() !== "---") return out;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === "---" || t === "...") break;
    const m = YAML_RE.exec(lines[i]);
    if (m) out.push({ key: m[1], value: m[2].trim() });
  }
  return out;
}

//  One file's text, capped at a page: a meta block and a preamble both sit at
//  the top, so nothing below the cap is ever a pair of the file's own.
function readText(file) {
  let st;
  try { st = io.lstat(file); } catch (e) { return null; }
  if (st.kind !== "reg") return null;
  if (Number(st.size) === 0) return "";
  let d;
  try { d = io.mmap(file, "r").data(); } catch (e) { return null; }
  return utf8.Decode(d.length > PAGE_CAP ? d.slice(0, PAGE_CAP) : d);
}

//  One file -> Map(sub -> row val), its whole block bar the header row.
function lex(file) {
  const out = new Map();
  const txt = readText(file);
  if (txt === null) return out;
  const lines = txt.split("\n");
  for (const p of metaPairs(lines)) {
    const code = codeOf(p.key);
    if (code === null) continue;
    const sub = subOf(code, K_HEAD);
    if (!out.has(sub)) out.set(sub, packValue(p.key, p.value));
  }
  for (const p of yamlPairs(lines)) {
    const sub = subOf(yamlCode(p.key), K_YAML);
    if (!out.has(sub)) out.set(sub, packValue(p.key, p.value));
  }
  return out;
}

//  --- the candidate set -----------------------------------------------------
//  Every `.mkd`/`.md` the STAGE lists plus the untracked ones the BEE-022 walk
//  finds under igno.  A stage entry whose file is gone still comes through, so
//  the sweep can see it die; a build tree never floods the list.
const MKD = /\.(mkd|md)$/i;

function candidates(ctx, hash) {
  const phlOf = hash || pathHl;
  const st = status.stageOf(ctx);
  const tracked = new Map();
  const rel = [];
  for (const e of (st.rows || [])) {
    if (tracked.has(e.path)) continue;
    tracked.set(e.path, false);
    if (MKD.test(e.path)) rel.push(e.path);
  }
  const un = [];
  status.scanUntracked(ctx, tracked, un);
  for (const e of un) if (MKD.test(e.path)) rel.push(e.path);
  rel.sort();
  const out = [];
  for (const p of rel) {
    const file = ctx.root + "/" + p;
    let s;
    try { s = io.lstat(file); } catch (e) { continue; }   // gone: not live
    if (s.kind !== "reg") continue;
    out.push({ rel: p, file: file, mtime: s.mtime, phl: phlOf(file) });
  }
  return out;
}

//  --- the lane --------------------------------------------------------------
//  A batching writer over the lane; a seal NEVER carries the mark, which is the
//  sweep's last write, so a crash mid-sweep only ever costs a redundant re-lex.
function kvWriter(ix) {
  let n = 0, total = 0;
  return {
    put: function (k, v) { ix.put(k, v); total++; if (++n >= KV_BATCH) { ix.commit(); n = 0; } },
    seal: function () { if (n) { ix.commit(); n = 0; } },
    get rows() { return total; }
  };
}

//  ONE merged pass over the stack -> { blocks, marks }.  `blocks` maps a path_hl
//  to `{ wt, rows: Map(sub -> val) }` with tombstones already dropped; the lane
//  is path-major, so a key column is not contiguous and a query rides this scan
//  — it still costs far less than the fs sweep before it.
function readAll(ix) {
  const blocks = new Map(), marks = new Map();
  const c = ix.seek(0n);
  while (c.next()) {
    const k = c.key, v = c.val;
    if (keyKind(k) === K_MARK) {
      if (valKind(v) === VK_MARK) marks.set(keyCode(k), valPayload(v));
      continue;
    }
    const kind = keyKind(k);
    if (kind !== K_HEAD && kind !== K_YAML) continue;
    const phl = keyPhl(k), code = keyCode(k);
    let b = blocks.get(phl);
    if (b === undefined) { b = { wt: null, rows: new Map() }; blocks.set(phl, b); }
    if (code === CODE_HEAD && kind === K_HEAD) {
      b.wt = valKind(v) === VK_TOMB ? null : valPayload(v);
      continue;
    }
    const sub = subOf(code, kind);
    if (valKind(v) === VK_TOMB) { b.rows.delete(sub); continue; }
    b.rows.set(sub, v);
  }
  return { blocks: blocks, marks: marks };
}

//  Reconcile ONE file's block: put what the lex found (a re-put overwrites, an
//  identical value is not re-put), tombstone every cell that vanished, and
//  refresh the header row naming the owning worktree.
function reconcile(w, t, rows, block, wt, rec) {
  const old = block ? block.rows : new Map();
  for (const [sub, v] of rows) {
    if (old.get(sub) === v) continue;
    w.put(packKey(t.phl, subCode(sub), subKind(sub)), v);
    rec.put++;
  }
  for (const sub of old.keys()) {
    if (rows.has(sub)) continue;
    w.put(packKey(t.phl, subCode(sub), subKind(sub)), packVal(VK_TOMB, 0n));
    rec.tombed++;
  }
  if (!block || block.wt !== wt) {
    w.put(packKey(t.phl, CODE_HEAD, K_HEAD), packVal(VK_HEAD, wt));
    rec.put++;
  }
  if (!block) block = { wt: wt, rows: rows };
  else block.rows = rows;
  block.wt = wt;
  return block;
}

//  Tombstone a whole block — a file this worktree indexed and that is gone, or
//  one a path-hash collision has just taken out of the index.
function killBlock(w, phl, block, rec) {
  for (const sub of block.rows.keys()) {
    w.put(packKey(phl, subCode(sub), subKind(sub)), packVal(VK_TOMB, 0n));
    rec.tombed++;
  }
  w.put(packKey(phl, CODE_HEAD, K_HEAD), packVal(VK_TOMB, 0n));
  rec.tombed++;
  block.rows = new Map();
  block.wt = null;
}

//  sweep(ix, files, wt, opts) -> { blocks, direct, rec }.  `direct` holds the
//  files a 40-bit path-hash COLLISION took out of the index: the sweep holds the
//  COMPLETE path list, so two live paths on one hashlet are DETECTED, both
//  blocks die and both files are read directly for this run.
function sweep(ix, files, wt, opts) {
  const rec = { files: files.length, pairs: 0, lexed: 0, skipped: 0, put: 0,
                tombed: 0, collided: 0, mark: 0n, maxMtime: 0n, cold: false };
  const state = readAll(ix);
  const blocks = state.blocks;
  const mark = state.marks.has(wt) ? state.marks.get(wt) : 0n;
  rec.mark = mark;
  rec.cold = mark === 0n;

  const byPhl = new Map();
  for (const t of files) {
    if (t.mtime > rec.maxMtime) rec.maxMtime = t.mtime;
    const g = byPhl.get(t.phl);
    if (g === undefined) byPhl.set(t.phl, [t]); else g.push(t);
  }
  const direct = [], collided = new Set();
  for (const [phl, g] of byPhl) {
    if (g.length < 2) continue;
    collided.add(phl);
    for (const t of g) { t.rows = lex(t.file); direct.push(t); rec.collided++; }
  }

  const w = kvWriter(ix);
  let n = 0;
  for (const t of files) {
    if (collided.has(t.phl)) continue;
    if (t.mtime < mark) { rec.skipped++; continue; }   // `>=` re-lexes: see below
    const rows = lex(t.file);
    blocks.set(t.phl, reconcile(w, t, rows, blocks.get(t.phl), wt, rec));
    rec.lexed++;
    //  The crash-mid-sweep golden: seal what is written, then die BEFORE the
    //  mark row.  Production never passes this.
    if (opts && opts._crashAfter !== undefined && ++n >= opts._crashAfter) {
      w.seal();
      throw "kv: injected sweep fault after " + n + " files";
    }
  }
  //  A block THIS worktree owns whose file is gone — or that just collided out.
  for (const [phl, b] of blocks) {
    if (b.wt !== wt) continue;                          // another worktree's
    if (byPhl.has(phl) && !collided.has(phl)) continue;
    killBlock(w, phl, b, rec);
  }
  w.seal();
  //  The mark is the MAX mtime OBSERVED, written LAST and only when it moves: a
  //  clock is never consulted, and an intermediate seal must never carry it.
  //  The test is `>=` — a redundant re-lex costs one read, a missed edit gives a
  //  wrong answer, and a file touched mid-scan re-lexes on the next run.
  if (rec.maxMtime !== mark) {
    ix.put(packKey(MARK_PHL, wt, K_MARK), packVal(VK_MARK, rec.maxMtime));
    ix.commit(true);
  }
  for (const b of blocks.values()) if (b.wt === wt) rec.pairs += b.rows.size;
  return { blocks: blocks, direct: direct, rec: rec };
}

//  sweepIn(ctx, ix, opts) — the sweep over one open repo and one open lane; the
//  candidate list rides back on the answer, so `find` walks the fs once.
function sweepIn(ctx, ix, opts) {
  opts = opts || {};
  const files = candidates(ctx, opts._hash);
  const s = sweep(ix, files, wtCode(ctx.root), opts);
  s.files = files;
  return s;
}

//  The bring-up `bee index` runs (BEE-024:66): open the lane, sweep, close, and
//  hand back the record its summary line prints.
function sweepRepo(ctx, opts) {
  const ix = idx.openKv(ctx.gitdir);
  try { return sweepIn(ctx, ix, opts).rec; }
  finally { try { ix.close(); } catch (e) {} }
}

//  --- the answer ------------------------------------------------------------
//  A filter is `{ key, value }` (exact), `{ key, prefix }` (a ron60 SPELLING
//  prefix, which is what makes `Due:` a range) or `{ key, any: true }`
//  (presence).  `yaml: true` asks for a preamble key of that spelling.
function clauseOf(f) {
  const key = String(f.key);
  const yaml = f.yaml === true || codeOf(key) === null;
  const kind = yaml ? K_YAML : K_HEAD;
  const code = yaml ? yamlCode(key) : codeOf(key);
  if (code === null)
    throw "kv: '" + key + "' is not a meta key (a capital then two lowercase " +
          "or digits, like Now or On1) — pass `yaml: true` for a preamble key";
  const cl = { sub: subOf(code, kind), key: key };
  if (f.prefix !== undefined) {
    const s = normalize(f.prefix);
    if (!/^[0-9A-Z_a-z~]{1,10}$/.test(s))
      throw "kv: '" + f.prefix + "' is no ron60 prefix";
    const shift = BigInt(6 * (10 - s.length));
    cl.lo = ron.decode(s) << shift;
    cl.hi = cl.lo + (1n << shift);
    return cl;
  }
  if (f.any === true || f.value === undefined || f.value === null) {
    cl.any = true;
    return cl;
  }
  cl.val = packValue(key, f.value);
  return cl;
}

function holds(cl, rows) {
  const v = rows.get(cl.sub);
  if (v === undefined) return false;
  if (cl.any) return true;
  if (cl.val !== undefined) return v === cl.val;
  if (valKind(v) !== VK_LIT) return false;             // a hash only equals
  const p = valPayload(v);
  return p >= cl.lo && p < cl.hi;
}

const EMPTY = { rows: new Map() };

//  find(repo, filters, opts) -> { files, rec } (+ `rows` on request).  The one
//  door: the fs is scanned, the unindexed is indexed, and the filtered file list
//  comes out of the index, AND-intersected on `path_hl`.  A path comes back
//  through the sweep's OWN list, never decoded from a hash.
//  `opts.rows` hands the matched files' CELLS back beside them, keyed by path:
//  the BEE-025 board reads `Now:` off them and answers its OR'd and absent-key
//  clauses in memory, so one find per repo per run serves the whole question.
function find(repo, filters, opts) {
  opts = opts || {};
  const ctx = idx.openRepo(repo === undefined ? io.cwd() : repo, true);
  try {
    const ix = idx.openKv(ctx.gitdir);
    let s;
    try { s = sweepIn(ctx, ix, opts); }
    finally { try { ix.close(); } catch (e) {} }
    const cls = [];
    for (const f of (filters || [])) cls.push(clauseOf(f));
    const out = [], cells = opts.rows === true ? new Map() : null;
    for (const t of s.files) {
      //  A collided file carries its OWN rows, read directly this run.
      const rows = t.rows || (s.blocks.get(t.phl) || EMPTY).rows;
      let all = true;
      for (const cl of cls) if (!holds(cl, rows)) { all = false; break; }
      if (!all) continue;
      out.push(t.file);
      if (cells !== null) cells.set(t.file, rows);
    }
    return { files: out, rows: cells, rec: s.rec };
  } finally { idx.closeRepo(ctx); }
}


//  The phrase `bee index` hangs on its one summary line (BEE-024:66).
function said(rec) {
  if (!rec) return "";
  return " — kv: " + rec.files + " files, " + rec.pairs + " pairs";
}

module.exports = {
  find: find, sweep: sweep, sweepIn: sweepIn, sweepRepo: sweepRepo, said: said,
  candidates: candidates, lex: lex, metaPairs: metaPairs, yamlPairs: yamlPairs,
  readAll: readAll, clauseOf: clauseOf, holds: holds,
  packKey: packKey, packVal: packVal, valKind: valKind, valPayload: valPayload,
  keyPhl: keyPhl, keyCode: keyCode, keyKind: keyKind,
  subOf: subOf, subCode: subCode, subKind: subKind,
  pathHl: pathHl, wtCode: wtCode, codeOf: codeOf, keyOf: keyOf,
  yamlCode: yamlCode, normalize: normalize, packValue: packValue,
  KV_BATCH: KV_BATCH, MARK_PHL: MARK_PHL, CODE_HEAD: CODE_HEAD,
  K_HEAD: K_HEAD, K_YAML: K_YAML, K_MARK: K_MARK,
  VK_LIT: VK_LIT, VK_HASH: VK_HASH, VK_MARK: VK_MARK, VK_HEAD: VK_HEAD,
  VK_TOMB: VK_TOMB
};
