//  bee/test/kv/rows.js — BEE-024 leg 8: the ROWS the `kv` lane holds.  Opens the
//  same kv64 stack `bee index` wrote and asserts the ruled bit layout — key
//  `path_hl:40|key_code:20|kind:4`, val `vkind:4|payload:60` — the VERBATIM meta
//  key code against the HASHED YAML one, the literal-or-hash payload, the per
//  worktree HEAD and MARK rows, and then, on scratch lanes of their own, the
//  path-hash collision detector and the crash-mid-sweep re-lex.
//
//  Driven by run.sh with the cwd inside the fixture repo:
//    KV_FIX  the repo
"use strict";
const idx = require("index/index.js");
const kv = require("index/kv.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const repo = io.getenv("KV_FIX");
const gitdir = repo + "/.git";
const wt = kv.wtCode(repo);

//  --- 1. the field split ----------------------------------------------------
//  The kind nibble is the LOW 4 bits, as every lite2 key has it, so one lane
//  holds every cell-like kind and one scan sees them all.
{
  const k = kv.packKey(0x1234567890n, 0xABCDEn, kv.K_YAML);
  check("key-splits-40-20-4",
        kv.keyPhl(k) === 0x1234567890n && kv.keyCode(k) === 0xABCDEn &&
        kv.keyKind(k) === kv.K_YAML, k.toString(16));
  const v = kv.packVal(kv.VK_HASH, 0x0FEDCBA987654321n & ((1n << 60n) - 1n));
  check("val-splits-4-60", kv.valKind(v) === kv.VK_HASH &&
        kv.valPayload(v) === (0x0FEDCBA987654321n & ((1n << 60n) - 1n)));
  check("kinds-are-1-2-F",
        kv.K_HEAD === 0x1n && kv.K_YAML === 0x2n && kv.K_MARK === 0xFn);
}

//  --- 2. the key codes ------------------------------------------------------
//  A meta key is `ron.decode` VERBATIM, 18 of the 20 bits; a YAML key is the TOP
//  20 bits of its text hashlet under its own kind, so `Now:` and `now:` never meet.
{
  check("meta-code-is-ron-decode", kv.codeOf("Now") === ron.decode("Now"),
        kv.codeOf("Now"));
  check("meta-code-fits-18-bits", kv.codeOf("Now") < (1n << 18n));
  check("meta-code-takes-a-digit", kv.codeOf("On1") === ron.decode("On1"));
  check("meta-code-refuses-lowercase", kv.codeOf("now") === null);
  check("meta-code-refuses-4-chars", kv.codeOf("Nowt") === null);
  check("yaml-code-is-hashed", kv.yamlCode("now") === (idx.hlOfText("now") >> 40n));
  check("yaml-and-meta-never-meet",
        kv.subOf(kv.codeOf("Now"), kv.K_HEAD) !== kv.subOf(kv.yamlCode("now"), kv.K_YAML));
}

//  --- 3. the payload --------------------------------------------------------
//  LITERAL when the despaced, decased form round-trips through ron60 (it then
//  ranges and compares exactly), else the hashlet60, which only equals.
{
  const open = kv.packValue("Now", "OPEN");
  check("literal-value-is-ron60", kv.valKind(open) === kv.VK_LIT &&
        ron.encode(kv.valPayload(open)) === "open", ron.encode(kv.valPayload(open)));
  check("decased-and-despaced", kv.packValue("Now", " oPeN ") === open);
  const free = kv.packValue("Ask", "a whole sentence, punctuated");
  check("free-text-hashes", kv.valKind(free) === kv.VK_HASH);
  const due = kv.packValue("Due", "2026-08-19");
  check("due-is-a-ron60-date", kv.valKind(due) === kv.VK_LIT &&
        ron.encode(kv.valPayload(due)) === ron.encode(ron.of(Date.UTC(2026, 7, 19))));
}

//  --- 4. the lexer ----------------------------------------------------------
//  The pair is line-local, so the regex IS the grammar; the block is the one
//  standing under the title, and a nested YAML value is skipped whole.
{
  const lines = ("---\ntitle: hello\nnest:\n  deep: no\n---\n\n#   AAA-9: t\n\n" +
                 "    Now: OPEN\n    Sev: HIGH\n\nprose\n\n -  Fix: not meta\n").split("\n");
  const m = kv.metaPairs(lines);
  check("meta-block-is-the-one-under-the-title",
        m.length === 2 && m[0].key === "Now" && m[1].key === "Sev",
        JSON.stringify(m));
  const y = kv.yamlPairs(lines);
  check("yaml-takes-top-level-only-and-skips-a-block",
        y.length === 1 && y[0].key === "title" && y[0].value === "hello",
        JSON.stringify(y));
}

//  --- 5. the rows on disk ---------------------------------------------------
//  Every block row carries a live kind, each live block one HEAD row naming its
//  owning worktree, and the MARK sits above every block under its own nibble.
{
  const ix = idx.openKv(gitdir);
  const st = kv.readAll(ix);
  let kinds = true, marked = 0;
  const c = ix.seek(0n);
  while (c.next()) {
    const kk = kv.keyKind(c.key);
    if (kk === kv.K_MARK) {
      marked++;
      if (kv.keyPhl(c.key) !== kv.MARK_PHL) kinds = false;
      if (kv.valKind(c.val) !== kv.VK_MARK) kinds = false;
      continue;
    }
    if (kk !== kv.K_HEAD && kk !== kv.K_YAML) kinds = false;
  }
  check("every-row-carries-a-ruled-kind", kinds);
  //  Leg 6 added a second worktree, so the lane holds a mark for each.
  check("a-mark-row-per-worktree", marked === 2, "mark rows " + marked);
  const mine = st.marks.get(wt);
  check("this-worktree-has-a-mark", mine !== undefined && mine > 0n, mine);
  let mine_blocks = 0, others = 0;
  for (const b of st.blocks.values()) {
    if (b.wt === wt) mine_blocks++;
    else if (b.wt !== null) others++;
  }
  check("blocks-are-owned-per-worktree", mine_blocks === 4 && others > 0,
        mine_blocks + " mine, " + others + " other");
  //  The mark is the MAX mtime OBSERVED, never a clock reading.
  let max = 0n;
  for (const f of ["todo/AAA-001.mkd", "todo/AAA-003.mkd", "doc/front.md", "doc/plain.mkd"]) {
    const s = io.lstat(repo + "/" + f);
    if (s.mtime > max) max = s.mtime;
  }
  check("the-mark-is-the-max-mtime-seen", mine === max, mine + " vs " + max);
  ix.close();
}

//  --- 6. a scratch lane -----------------------------------------------------
//  The collision and crash legs must not touch the fixture's own lane, so they
//  run on families of their own outside `<gitdir>/be`.
const SCRATCH = gitdir + "/kvtest";
io.mkdir(SCRATCH);
let seq = 0;
function lane() {
  const dir = SCRATCH + "/" + (++seq);
  io.mkdir(dir);
  return abc.index("kv64", { dir: dir, ext: idx.KV_EXT });
}
function fileList(phl) {
  const out = [];
  for (const rel of ["todo/AAA-001.mkd", "doc/front.md", "doc/plain.mkd"]) {
    const f = repo + "/" + rel;
    const s = io.lstat(f);
    out.push({ rel: rel, file: f, mtime: s.mtime, phl: phl === undefined ? kv.pathHl(f) : phl });
  }
  return out;
}

//  --- 7. the crash-mid-sweep re-lex -----------------------------------------
//  The mark is the sweep's LAST write and an intermediate seal never carries it,
//  so a crash costs a redundant re-lex and never marks an unlexed file done.
{
  const ix = lane();
  let threw = false;
  try { kv.sweep(ix, fileList(), wt, { _crashAfter: 1 }); }
  catch (e) { threw = true; }
  check("an-injected-fault-aborts-the-sweep", threw);
  const st = kv.readAll(ix);
  check("the-crashed-sweep-left-no-mark", st.marks.get(wt) === undefined,
        st.marks.get(wt));
  check("the-crashed-sweep-kept-what-it-sealed", st.blocks.size >= 1,
        st.blocks.size);
  const r = kv.sweep(ix, fileList(), wt, {}).rec;
  check("the-next-sweep-re-lexes-everything", r.lexed === 3 && r.skipped === 0,
        r.lexed + " lexed, " + r.skipped + " skipped");
  check("and-now-the-mark-stands", kv.readAll(ix).marks.get(wt) === r.maxMtime);
  //  The warm run: only the file AT the mark re-lexes, the older ones are
  //  skipped — `>=` costs one redundant read and never misses an edit.
  const r2 = kv.sweep(ix, fileList(), wt, {}).rec;
  check("a-warm-sweep-skips-what-predates-the-mark",
        r2.lexed === 1 && r2.skipped === 2 && r2.put === 0,
        r2.lexed + " lexed, " + r2.skipped + " skipped, " + r2.put + " put");
  ix.close();
}

//  --- 8. the path-hash collision detector -----------------------------------
//  The sweep holds the COMPLETE path list, so two live paths on one 40-bit
//  hashlet are DETECTED: both leave the index for the run and are read directly.
{
  const ix = lane();
  const s = kv.sweep(ix, fileList(0x5150n), wt, {});
  check("a-collision-takes-every-sharer-out", s.rec.collided === 3 &&
        s.rec.lexed === 0, s.rec.collided + " collided, " + s.rec.lexed + " lexed");
  check("no-collided-row-is-ever-put", s.rec.put === 0, s.rec.put);
  let carried = 0;
  for (const t of s.direct)
    if (t.rows.get(kv.subOf(kv.codeOf("Now"), kv.K_HEAD)) !== undefined) carried++;
  check("a-collided-file-is-read-directly", carried === 1, carried);
  ix.close();
}

w1(bad ? "FAIL " + bad + " of " + n + "\n" : "DONE " + n + " checks\n");
if (bad) throw "kv rows: " + bad + " of " + n + " checks failed";
