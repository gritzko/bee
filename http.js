//  http.js — LITE-034: `bee http [--port <n>]`, the repo browser over
//  HTTP.  Three parts and no fourth: quickjab's `net.createServer` on the one
//  implicit `pol` loop for the transport, QJAB-004's `http._drain`/`http._feed`
//  for the message heads, and a ROUTER TABLE mapping URL forms onto the SAME
//  verbs door the pager clicks through (main.js VERBS).
//
//  ARG-BLIND, like the pager: the router splits a URL into (verb, arg) and hands
//  the arg over verbatim — `?<rev>` included — and the verb resolves it.  So the
//  URL scheme is one table plus one URL builder, and a ruling on it is an edit
//  in this file and nowhere else.
//
//  READS answer GET and HEAD; BEE-047's ONE write endpoint takes POST, gated by
//  `--ro`, a same-origin check and act.js's map.  The listener binds 127.0.0.1 —
//  a browser, not a service.  The pol loop runs until SIGINT; nothing daemonises.
"use strict";

const idx = require("index/index.js");
const mnt = require("index/mount.js");
const rd = require("index/read.js");
const wv = require("index/weave.js");
const wrap = require("render/wrap.js");
const html = require("render/html.js");
const mark = require("mark/html.js");
const front = require("mark/front.js");
const rst = require("mark/rst.js");
const hk = require("index/hook.js");
//  BEE-047: the mutation table and its views-vs-verbs map — this file never
//  keeps a verb list of its own.
const act = require("act.js");

const PORT = 8034;                  // the fixed default; --port overrides
const HOST = "127.0.0.1";           // localhost only — no flag opens this up
const MAXHEAD = 64 << 10;           // a head bigger than this is not a browser
const REF_CAP = 512;                // distinct references resolved per page
const HTML = "text/html; charset=utf-8";
const CSS = "text/css; charset=utf-8";
const ICO = "image/vnd.microsoft.icon";
const TEXT = "text/plain; charset=utf-8";
const OCTET = "application/octet-stream";
const MAXBYTES = wv.MAX_SOURCE_SIZE;    // LITE-036: the shared source cap, 4 MB
const MAXPOST = 4 << 10;                // BEE-047: a spell is a line, not a file

//  --- the QJAB-004 coupling --------------------------------------------------
//  EVERY http leaf call lives in these two functions, so an API change is edited
//  here and nowhere else.  `drainHead` -> a head object, or null = need more.
function drainHead(bytes) { return http._drain(bytes); }
function feedHead(head) { return http._feed(head); }

//  One request header by name, matched case-blind as HTTP spells them; "" when
//  the head carries none.
function headerOf(req, name) {
  const hs = (req && req.headers) || [];
  for (const h of hs) if (String(h[0]).toLowerCase() === name) return String(h[1]);
  return "";
}

//  BEE-047: how many BODY bytes this request carries — a POST's own
//  Content-Length and nothing else, so no other method ever waits for one.  An
//  unreadable length is 0: the act then refuses in words rather than hang.
function bodyLen(req) {
  if (String(req.method || "") !== "POST") return 0;
  const n = Number(headerOf(req, "content-length") || "0");
  return n > 0 && n === Math.floor(n) ? n : 0;
}

//  --- the URL table ----------------------------------------------------------
//  The FIRST path segment names the verb; everything after it (plus `?<rev>`) is
//  the arg.  `/` is the root list.  `/style.css` is the one generated sheet.
const ROUTE = {
  "":       "list",                 //  /                  the root list
  list:     "list",                 //  /list/<path>[?<rev>]
  log:      "log",                  //  /log/<path|hex>
  commit:   "commit",               //  /commit/<hex>
  diff:     "diff",                 //  /diff/<hex|path>
  //  BEE-022: the quad of the LIVE worktree; it takes no path and no rev.
  status:   "status",               //  /status
  //  BEE-025: the ticket board of THIS repo; the segments after it are the arg
  //  LINE (`/todo/BEE/Sev:HIGH`), which is why a slash separates words there.
  todo:     "todo",                 //  /todo[/<TOPIC>][/<Key:Value>...]
  cat:      "cat",                  //  /cat/<path>[?<rev>]  a .md RENDERS here
  //  BEE-046: the same bytes under the diff wash, which the sheet's own
  //  side-in/side-rm classes paint — no second palette on this side either.
  dog:      "dog",                  //  /dog/<path>
  raw:      "cat",                  //  /raw/<path>[?<rev>]  the painted source
  tree:     "tree",                 //  /tree/<path|hex>[?<rev>]
  blob:     "blob",                 //  /blob/<hexlet>
  bytes:    "cat",                  //  /bytes/<path>[?<rev>] the bytes VERBATIM
  //  BEE-012: SEVERAL hits are a choice, not a miss — the ref is read in THIS
  //  repo's ambient, so the page lists what a reader on that page would see.
  choose:   "choose",               //  /<repo>/choose/<ref>
};

//  LITE-036: the EXTENSION -> content type table — the ONE place a served byte
//  stream is typed, and never off the bytes.  Off the list is octet-stream (the
//  browser downloads, interprets nothing); `svg` is deliberately absent, being
//  script in the page's origin.
const MIME = {
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  gif:  "image/gif",
  webp: "image/webp",
  ico:  "image/x-icon",
  bmp:  "image/bmp",
};

//  A path -> its extension, lowercased: the last dot of the LAST segment names
//  it, and no dot or a dotfile names none.
function extOf(path) {
  const p = String(path);
  const dot = p.lastIndexOf("."), cut = p.lastIndexOf("/");
  return dot > cut + 1 ? p.slice(dot + 1).toLowerCase() : "";
}

//  A path -> its content type; off the list is octet-stream.
function mimeOf(path) {
  const t = MIME[extOf(path)];
  return typeof t === "string" ? t : OCTET;
}

//  Percent-decoding goes through the abc/URI leaf, never a hand-rolled scan.
function unesc(s) { try { return URI.unescape(s); } catch (e) { return s; } }

//  A request URI -> { repo, head, verb, arg, raw, query }.  The split is
//  `uri._parse`'s — path and query are its slots; only the path SEGMENTS are
//  joined back by hand.
//  BEE-003 (ruling 2): the FIRST segment names the REPO when the registry knows
//  it (`names`, the mount table), and the verb follows it — `/<repo>/<verb>/
//  <path>`.  BEE-028: a segment that spells a verb IS that verb, always; with
//  none after the repo the rest is a path (`verb: "path"`) and the caller 301s
//  to its `cat`/`list` form, as it does with no repo at all — an old or typed
//  link converges on the one spelling instead of quietly serving one tree.
function routeOf(reqUri, names) {
  let u;
  //  A request URI abc/URI refuses names no page — a 404, never a thrown loop.
  try { u = uri._parse(String(reqUri === undefined ? "" : reqUri)); }
  catch (e) { return { repo: "", head: String(reqUri), verb: undefined, arg: "",
                       raw: "/", query: "" }; }
  const segs = String(u.path || "/").split("/");
  const q = u.query ? "?" + unesc(u.query) : "";
  const own = { repo: "", raw: String(u.path || "/"),
                query: u.query ? "?" + u.query : "" };
  const first = segs.length > 1 ? unesc(segs[1]) : "";
  const at = names && names.indexOf(first) >= 0 ? 2 : 1;
  if (at === 1) {
    own.head = first;
    own.verb = ROUTE[first];
    own.arg = segs.slice(2).map(unesc).join("/") + q;
    return own;
  }
  own.repo = first;
  const head = segs.length > 2 ? unesc(segs[2]) : "";
  if (Object.prototype.hasOwnProperty.call(ROUTE, head)) {
    own.head = head;
    own.verb = ROUTE[head];
    own.arg = segs.slice(3).map(unesc).join("/") + q;
    return own;
  }
  own.head = "";
  own.verb = "path";
  own.arg = segs.slice(2).map(unesc).join("/") + q;
  return own;
}

//  BEE-003: the names the router knows — one per registered top-level repo.
function repoNames() {
  const out = [];
  for (const m of mnt.list()) if (m.prefix === "" && !m.dup) out.push(m.name);
  return out;
}

//  --- the link builder -------------------------------------------------------
//  A pager click target -> its URL, the INVERSE of routeOf.  `<verb> <arg>`
//  goes to that verb's page; anything else is a REFERENCE, RESOLVED HERE, while
//  the page is painted (ruling 2026-08-15): the emitted href already names the
//  landed file and the landed token, and a reference that resolves to nothing
//  gets no href at all — the painter then leaves it as plain painted text.
function urlOf(pg, target) {
  const sp = target.indexOf(" ");
  const verb = sp > 0 ? target.slice(0, sp) : "";
  return ROUTE[verb] && verb !== ""
    ? argUrl(pg, verb, target.slice(sp + 1).trim())
    : refUrl(pg, target);
}

//  Repo-relative, each SEGMENT escaped on its own so `/` stays a separator.
function escPath(p) {
  const segs = String(p).split("/");
  for (let i = 0; i < segs.length; i++) segs[i] = URI.escape(segs[i]);
  return segs.join("/");
}

//  An absolute path -> its repo-relative spelling, or null when it lies OUTSIDE
//  the repo — a page can only be served for what the repo carries.
function repoRel(root, full) {
  if (full === root || full === root + "/") return "";
  if (full.length > root.length && full.slice(0, root.length + 1) === root + "/")
    return full.slice(root.length + 1);
  return null;
}

//  BEE-003: a path -> `{ name, rel }` in the URL's own frame.  An ABSOLUTE one
//  is addressed by the OUTERMOST registered repo holding it (`mount.canon`), so
//  a submodule file is spelled through its parent (ruling 5); a relative one is
//  already in the page's own repo and only takes that repo's mount prefix.
//  null = no registered repo holds it, so there is no page to name.
function pathIn(pg, path) {
  const p = String(path);
  if (p.charAt(0) !== "/") {
    //  BEE-020:55: the prefix rides a HEXLET too — a sub page's `commit <hex>`
    //  names a commit of the SUB, so its href must re-enter the sub (the router
    //  re-roots `<prefix>/<hexlet>` through `mnt.serves`), not land in the parent.
    const pre = pg.prefix ? pg.prefix + "/" : "";
    return { name: pg.name, rel: p === "" ? "" : pre + p };
  }
  const c = mnt.canon(p);
  if (c !== null) return { name: c.mount.name, rel: c.rel };
  const rel = repoRel(pg.root, p);
  return rel === null ? null : { name: pg.name, rel: rel };
}

//  A verb + arg -> `/<repo>/<verb>/<path>[?<rev>]`: a nav target names a path
//  ABSOLUTELY, so the root comes off, and each SEGMENT escapes on its own.
function argUrl(pg, verb, arg) {
  //  BEE-023: a `//name/rel` arg names its repo outright, and abc/URI would read
  //  the name as an authority — so the repo comes off FIRST, the rest splits as usual.
  const rt = mnt.splitRooted(arg);
  if (rt !== null) arg = rt.rel;
  //  A target abc/URI refuses (a raw space in a path) is all PATH — a link is
  //  built while PAINTING, so it may never throw a page away.
  let a;
  try { a = rd.argSplit(arg); } catch (e) { a = { path: arg, rev: "" }; }
  const w = rt !== null ? { name: rt.name, rel: a.path } : pathIn(pg, a.path);
  if (w === null) return "";
  return "/" + w.name + "/" + verb + "/" + escPath(w.rel) +
         (a.rev ? "?" + URI.escape(a.rev) : "");
}

//  --- references, resolved at RENDER time ------------------------------------
//  Every distinct reference on a page is resolved ONCE (a permalink follow folds
//  two blobs; a page repeating a ref must not pay twice) and no more than
//  REF_CAP of them — past that a page would hold the single-threaded loop.
function refUrl(pg, target) { return memoUrl(pg, "cat " + target, target, refResolve); }

//  LITE-036: the same budget and the same cache for the image spelling of a
//  target — a page linking AND showing one file resolves it once per spelling.
function imgUrl(pg, target) { return memoUrl(pg, "bytes " + target, target, imgResolve); }

function memoUrl(pg, key, target, resolve) {
  if (pg.refs.has(key)) return pg.refs.get(key);
  let url = "";
  if (pg.left > 0) { pg.left--; url = resolve(pg, target); }
  pg.refs.set(key, url);
  return url;
}

//  The DOOR resolves a target to a FILE — this is the only place one is named.
//  -> { seat, rel, st } or null: SEVERAL hits name no single page, a miss names
//  none at all, and the caller spells "" (plain text) for both.
//  BEE-003: the door resolves in the page's own AMBIENT and hands back an
//  ABSOLUTE path, which the mount table addresses — in ANY registered repo, not
//  only the one this page came from.  Outside every registered repo there is no
//  page, so such a ref simply gets no href.
//  BEE-012: the door is asked ONCE per reference (the budget counts follows),
//  so the seat is taken here and placed by `seatAt` below.
function seatOf(pg, target) {
  try { return pg.door.seatOf(target); } catch (e) { return null; }
}

//  A SEAT -> where it sits in the URL's frame, or null when no page names it.
function seatAt(pg, seat) {
  if (seat === null || seat.rels) return null;
  const w = pathIn(pg, seat.full);
  if (w === null || w.rel === "") return null;
  const st = pg.door.statOf(seat.full);
  return st === null ? null : { seat: seat, rel: w.rel, name: w.name, st: st };
}

function seatRel(pg, target) { return seatAt(pg, seatOf(pg, target)); }

//  A dir opens in the browser, a file in `cat` anchored on the landed token.
//  BEE-028: the verb is always written — a verb-less `/<repo>/<path>` would be
//  read as the verb its first segment happens to spell (`todo/`, `log/`).
function refResolve(pg, target) {
  const seat = seatOf(pg, target);
  //  BEE-012: a MULTI-HIT is bee saying "which one?", not "I do not know" — it
  //  gets the chooser page, read in this page's own repo; a MISS stays plain.
  if (seat !== null && seat.rels)
    return "/" + pg.name + "/choose/" + escPath(target);
  const s = seatAt(pg, seat);
  if (s === null) return "";
  if (s.st.kind === "dir") return "/" + s.name + "/list/" + escPath(s.rel) + "/";
  const b = anchorByte(pg, s.seat);
  return "/" + s.name + "/cat/" + escPath(s.rel) + (b >= 0 ? "#" + html.anchorId(0, b) : "");
}

//  LITE-036: an IMAGE names the file's own bytes, at the rev the PAGE is read
//  at — an old revision of a page shows its own era's picture.
function imgResolve(pg, target) {
  const s = seatRel(pg, target);
  if (s === null || s.st.kind === "dir") return "";
  return "/" + s.name + "/bytes/" + escPath(s.rel) +
         (pg.rev ? "?" + URI.escape(pg.rev) : "");
}

//  The byte the landed TOKEN starts at, in the bytes `/cat/<rel>` will serve —
//  the resolver's own token when it walked one (a permalink), else the token
//  render/wrap.js's landAt puts the `file:line(:col)` on (with no column, the
//  LINE's first token).  -1 = nothing to anchor: the link stays bare.
function anchorByte(pg, seat) {
  if (seat.hi > seat.lo) return seat.lo;
  if (!seat.line) return -1;
  const h = openOnce(pg, seat.full);
  if (h === null) return -1;
  const la = wrap.landAt(h.text, seat.line, seat.col);
  if (la === null) return -1;
  const sp = wrap.tokSpanAt(h, la.at);
  return sp === null ? -1 : sp.lo;
}

//  The door's OWN open (mmap + the tokenizer), once per file per page — the
//  served bytes and the pager's are the same bytes, so the offsets agree.
function openOnce(pg, full) {
  if (pg.hunks.has(full)) return pg.hunks.get(full);
  let h = null;
  try { const hs = pg.door.openPath(full); h = hs && hs.length ? hs[0] : null; }
  catch (e) { h = null; }
  pg.hunks.set(full, h);
  return h;
}

//  --- the rendered page ------------------------------------------------------
//  LITE-037: the rendered dialects and their parsers — `.md` CommonMark
//  (LITE-035), `.rst` reStructuredText, BEE-032 `.mkd` StrictMark.  The PARSER
//  is all that differs: the emitter, the page shell and the link door below are
//  one set for all three, and `/raw/` still paints any of them as source.
//  BEE-029: the Markdown entries go through `front`, so a YAML preamble is
//  metadata, not a ruler.
const RENDER = { md: front.toHtml, mkd: front.strictToHtml, rst: rst.toHtml };

//  A path -> the function that renders it, or null for a painted-source file.
function renderOf(path) {
  const r = RENDER[extOf(path)];
  return typeof r === "function" ? r : null;
}

//  The arg's PATH half, rev dropped — the same split `cat` itself makes.
function argPath(arg) {
  try { return rd.argSplit(arg).path; } catch (e) { return String(arg); }
}

//  The arg's REV half, "" when the page is read at the tip.
function argRev(arg) {
  try { return rd.argSplit(arg).rev; } catch (e) { return ""; }
}

//  A link destination -> its href, RESOLVED WHILE THE PAGE IS RENDERED, exactly
//  as a painted reference is (LITE-034).  An absolute url and a bare `#anchor`
//  ride as typed; a relative one goes through the door, so a `.md` target lands
//  on its rendered page, another path on its painted view, and a target that
//  resolves to nothing comes back "" — the emitter then paints plain text.
//  LITE-036: an IMAGE destination (the emitter's own flag, never the bytes)
//  goes to `/bytes/` instead — the same door, the same resolved file, only the
//  spelling differs; a plain LINK to an image file keeps its painted `/cat/`.
function pageHref(pg, dir, dest, isImage) {
  let u = null;
  try { u = uri._parse(String(dest)); } catch (e) { u = null; }
  if (u && (u.scheme || u.authority)) return String(dest);
  if (u && !u.path) return u.fragment ? "#" + u.fragment : "";
  const p = u ? unesc(u.path) : String(dest);
  const rel = p.charAt(0) === "/" ? p.slice(1) : dir + p;
  if (isImage) return imgUrl(pg, rel);
  const url = refUrl(pg, rel);
  if (url === "" || !u || !u.fragment || url.indexOf("#") >= 0) return url;
  return url + "#" + u.fragment;
}

//  LITE-043: bare wiki/Link.mkd refs in RENDERED prose become <a> — the
//  tokenizer's F tokens (hook.fTokens, the ONE scanner) through the SAME door
//  a painted click rides (refUrl); a miss stays plain text.
function autoSegs(pg, text) {
  const bytes = utf8.Encode(text);
  const fs = hk.fTokens(bytes, "txt");
  if (fs.length === 0) return null;
  const segs = [];
  let at = 0;
  for (const f of fs) {
    const url = refUrl(pg, f.text);
    if (url === "") continue;
    if (f.lo > at) segs.push({ text: utf8.Decode(bytes.slice(at, f.lo)) });
    segs.push({ text: f.text, href: url });
    at = f.hi;
  }
  if (segs.length === 0) return null;
  if (at < bytes.length) segs.push({ text: utf8.Decode(bytes.slice(at)) });
  return segs;
}

//  The page: the toggle bar, then the emitted body.  `toHtml` is the dialect's
//  own parser plus the ONE emitter; links resolve against the document's OWN
//  directory, the way a reader reads them.
function pageBody(pg, rel, arg, hunks, toHtml) {
  const src = hunks.length ? utf8.Decode(hunks[0].text) : "";
  const cut = rel.lastIndexOf("/");
  const dir = cut < 0 ? "" : rel.slice(0, cut + 1);
  const body = toHtml(src, {
    href: function (d, isImage) { return pageHref(pg, dir, d, isImage); },
    autolink: function (t) { return autoSegs(pg, t); }
  });
  return html.viewBar("cat " + rel, "source", argUrl(pg, "raw", arg)) +
         html.markBody(body);
}

//  --- the response -----------------------------------------------------------
function respond(sock, status, reason, type, body, headOnly, extra) {
  const hs = [["Content-Type", type],
              ["Content-Length", String(body.length)],
              ["Connection", "close"]];
  if (extra) for (const h of extra) hs.push(h);
  sock.write(feedHead({ version: "HTTP/1.1", status: status, reason: reason,
                        headers: hs }));
  if (!headOnly && body.length) sock.write(body);
  sock.end();
}

function sendPage(sock, status, reason, title, body, headOnly) {
  respond(sock, status, reason, HTML, utf8.Encode(body), headOnly);
}

//  --- LITE-036: `/bytes/<path>[?<rev>]` --------------------------------------
//  The DOOR already named the file and read it (the `cat` verb, its own path
//  gate and its own `?<rev>`) — this only ships what came back: the bytes
//  VERBATIM, typed off the NAME, `nosniff` so no browser guesses otherwise.
//  Over the cap it refuses in plain words rather than stream — an http page is
//  a whole buffer here as everywhere.
function sendBytes(sock, hunks, path, headOnly) {
  const bytes = hunks.length ? hunks[0].text : new Uint8Array(0);
  if (bytes.length > MAXBYTES) {
    respond(sock, 413, "Payload Too Large", TEXT,
            utf8.Encode("bee http: " + path + " is too big to serve (over " +
                        (MAXBYTES >> 20) + " MB)\n"), headOnly);
    return "413";
  }
  respond(sock, 200, "OK", mimeOf(path), bytes, headOnly,
          [["X-Content-Type-Options", "nosniff"]]);
  return "200";
}

//  BEE-047: the act endpoint a page's write faces post to, "" with `--ro` — the
//  ONE switch render/html.js sees, so a locked server paints no live button.
function acts(st, mount) { return st.acts ? actPath(mount.name) : ""; }

//  A verb's refusal is already in plain words — it becomes the page.
function why(e) {
  return String(e && e.message !== undefined && e.message !== null ? e.message : e);
}

//  BEE-003 (ruling 2): a URL that names no repo — or names a SUBMODULE's own
//  registry line, which is not a live address (ruling 5) — moves to the
//  canonical prefixed form.  301, so a browser and an old link both converge.
function moveTo(sock, where, headOnly) {
  respond(sock, 301, "Moved Permanently", TEXT,
          utf8.Encode("bee http: this page is at " + where + "\n"), headOnly,
          [["Location", where]]);
  return "301";
}

//  BEE-003: the repos this server answers for — the [BEE-001] registry, plus
//  the one it was STARTED in, which is served whether or not it was installed
//  (and, sharing a name, wins there: the server must not 301 to itself).
function mounted(st) {
  const out = [];
  let have = false;
  for (const m of mnt.list()) {
    if (m.prefix === "" && !m.dup && m.root === st.home.root) have = true;
    out.push(m);
  }
  if (have) return out;
  const keep = [];
  for (const m of out) if (!(m.prefix === "" && m.name === st.home.name)) keep.push(m);
  keep.push(st.home);
  return keep;
}

//  The first path segment of a request URI, unescaped; "" when there is none.
function firstSeg(reqUri) {
  let u;
  try { u = uri._parse(String(reqUri === undefined ? "" : reqUri)); } catch (e) { return ""; }
  const segs = String(u.path || "/").split("/");
  return segs.length > 1 ? unesc(segs[1]) : "";
}

//  BEE-023:27 the `$SRC_ROOT` leg as a one-request mount, so `/bee-BEE-026/cat/...`
//  serves the worktree the CLI reaches as `//bee-BEE-026`.  Only a FORK name
//  mounts (BEE-026: `<registered>-<tail>`), and only with a plain charset, so a
//  dot-led, slashed or otherwise unregistered `$SRC_ROOT` dir is never served.
const FORK_SEG = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
function srcMount(name, names) {
  if (!FORK_SEG.test(name) || names.indexOf(name) >= 0) return null;
  let fork = false;
  for (const n of names)
    if (name.length > n.length + 1 && name.slice(0, n.length + 1) === n + "-" &&
        name.charAt(n.length + 1) !== ".") { fork = true; break; }
  if (!fork) return null;
  const root = mnt.byName(name);
  if (root === null) return null;
  return { name: name, root: root, prefix: "", own: name, top: root, dup: false };
}

//  The repos this request answers off, and their names: the registry, the repo
//  the server was started in, and BEE-023:27:X5's one-request `$SRC_ROOT` mount.
function tableFor(reqUri, st) {
  const table = mounted(st);
  const names = [];
  for (const x of table) if (x.prefix === "" && !x.dup) names.push(x.name);
  const extra = srcMount(firstSeg(reqUri), names);
  if (extra !== null) { table.push(extra); names.push(extra.name); }
  return { table: table, names: names };
}

//  The top-level mount a name stands for, or null when this server serves none.
function mountOf(table, name) {
  for (const x of table)
    if (x.prefix === "" && !x.dup && x.name === name) return x;
  return null;
}

//  --- BEE-047: the ONE write endpoint ----------------------------------------
//  `POST /<repo>/act`, off the ROUTE table on purpose: ROUTE names VIEWS and a
//  write is no view.  -> the repo name the URL names, "" when it is not the act
//  URL at all.
function actPath(name) { return "/" + name + "/act"; }
function actRepo(reqUri) {
  let u;
  try { u = uri._parse(String(reqUri === undefined ? "" : reqUri)); } catch (e) { return ""; }
  const segs = String(u.path || "/").split("/");
  return segs.length === 3 && unesc(segs[2]) === "act" ? unesc(segs[1]) : "";
}

//  A refusal in plain words, the body carrying them — the only answer a POST
//  gets that is not the page it came from.
function refuse(sock, status, reason, words) {
  respond(sock, status, reason, TEXT, utf8.Encode(words), false);
  return String(status);
}

//  BEE-047: a cross-origin form POST reaches 127.0.0.1 with no CORS to stop it,
//  so the gate is the browser's OWN stated origin — its host and port must be
//  the very ones this request was addressed to.  Neither header: no act.
function sameOrigin(req) {
  const host = headerOf(req, "host");
  const o = headerOf(req, "origin") || headerOf(req, "referer");
  if (host === "" || o === "") return false;
  let u;
  try { u = uri._parse(o); } catch (e) { return false; }
  if (u === null || !u.host) return false;
  return u.host + (u.port ? ":" + u.port : "") === host;
}

//  One field of an `application/x-www-form-urlencoded` body; `+` is a space
//  there, which percent-decoding alone does not know.
function formField(body, name) {
  for (const pair of String(body === undefined || body === null ? "" : body).split("&")) {
    const eq = pair.indexOf("=");
    if (eq >= 0 && unesc(pair.slice(0, eq)) === name)
      return unesc(pair.slice(eq + 1).split("+").join(" "));
  }
  return "";
}

//  The clicked spell, run exactly as a pager click runs it (pager.js:642:6S
//  `_actSpell`): the map says the word writes, act.js's own `shape` says THIS
//  spell does, the rev tree is bumped, and 303 sends the browser back to the
//  page it clicked from — which then spends the report line.
function actPost(req, sock, st) {
  const name = actRepo(req.uri);
  const mount = name === "" ? null : mountOf(tableFor(req.uri, st).table, name);
  //  Any other URL: the refusal this server always gave a write (http.js:12).
  if (mount === null)
    return refuse(sock, 405, "Method Not Allowed",
                  "bee http only reads; POST is not allowed\n");
  if (!st.acts)
    return refuse(sock, 405, "Method Not Allowed",
                  "bee http --ro only reads; POST is not allowed\n");
  if (!sameOrigin(req))
    return refuse(sock, 403, "Forbidden",
                  "bee http: an act takes a SAME-ORIGIN post\n");
  const spell = formField(req.body, "s");
  if (!act.writes(spell))
    return refuse(sock, 403, "Forbidden",
                  "bee http: " + (spell || "an empty spell") + " is no writer\n");
  let fn = null;
  try { fn = act.actOf(spell); } catch (e) { fn = null; }
  //  A shape-split word in its READING shape (`commit <rev>`) is a view, and
  //  act.js's own predicate is what says so — no second reading here.
  if (fn === null)
    return refuse(sock, 403, "Forbidden",
                  "bee http: " + spell + " writes in no shape\n");
  let report;
  try { report = act.run(spell, { repo: mount.root, path: "", anchor: "" }); }
  catch (e) { report = why(e); }
  //  The write moved the index or a ref, so no memo is worth trusting —
  //  pager.js:627:6S bumps for the same reason before it re-opens.
  require("index/cache.js").bumpRoot();
  const line = String(report).split("\n").join("; ");
  const back = headerOf(req, "referer");
  //  BEE-047: the report line takes the top of the page the browser lands on
  //  (handle() spends `flash`); with no page to go back to it IS the answer.
  if (back === "") return refuse(sock, 200, "OK", line + "\n");
  st.flash = line;
  respond(sock, 303, "See Other", TEXT, utf8.Encode(line + "\n"), false,
          [["Location", back]]);
  return "303";
}

//  --- one request ------------------------------------------------------------
function handle(req, sock, st) {
  const m = String(req.method || "");
  const only = m === "HEAD";
  //  GIT-031: ONE page is one snapshot.  The cached ODB handles catch up with
  //  git here and nowhere else, so a page cannot resolve its first references
  //  against one pack set and its last against another.
  idx.epoch();
  //  BEE-047: a write rides POST and lands in the ONE endpoint above; every
  //  other method is still refused outright, its body unread.
  if (m === "POST") return actPost(req, sock, st);
  if (m !== "GET" && !only) {
    respond(sock, 405, "Method Not Allowed", TEXT,
            utf8.Encode("bee http only reads; " + m + " is not allowed\n"), false);
    return "405";
  }
  //  BEE-023:27 a first segment the registry does not know may still be a
  //  `$SRC_ROOT` repo (a forked ticket worktree, BEE-026): it mounts for this request.
  const t = tableFor(req.uri, st);
  const table = t.table, names = t.names;
  const r = routeOf(req.uri, names);
  //  The two SITE files, repo-less and served off blob/: the one sheet and the
  //  one icon.  Both are read at startup, so a request is bytes and no syscall.
  if (r.repo === "" && r.head === "style.css") {
    respond(sock, 200, "OK", CSS, st.css, only);
    return "200";
  }
  if (r.repo === "" && r.head === "favicon.ico") {
    respond(sock, 200, "OK", ICO, st.icon, only);
    return "200";
  }
  if (r.repo === "") {
    //  A SUB's own line redirects to the through-the-parent form; anything else
    //  repo-less is read in the repo this server was started in.
    //  The tail comes off the RAW path, which is still escaped as received.
    const tail = r.raw.slice(1 + String(r.raw.split("/")[1] || "").length);
    for (const x of table)
      if (x.prefix !== "" && x.own === r.head)
        return moveTo(sock, "/" + x.name + "/" + escPath(x.prefix) + tail + r.query, only);
    return moveTo(sock, "/" + st.home.name + r.raw + r.query, only);
  }
  const mount = mountOf(table, r.repo);
  if (mount === null || r.verb === undefined) {
    sendPage(sock, 404, "Not Found", "bee http",
             html.errorPage("bee http", "there is no /" + r.head + " page here"), only);
    return "404";
  }
  //  BEE-012: the chooser reads a REFERENCE, not a path, so it takes no
  //  re-rooting and no rev — the door's own several-hits hunk IS the page.
  if (r.verb === "choose") {
    const pos = { repo: mount.root, path: "", anchor: "" };
    let hunks = null;
    try { hunks = st.door.openTarget(r.arg, pos); } catch (e) { hunks = null; }
    if (hunks === null || !hunks.length) {
      sendPage(sock, 404, "Not Found", "choose",
               html.errorPage("choose", "nothing here answers to " + r.arg), only);
      return "404";
    }
    const pg = { root: mount.root, name: mount.name, prefix: "", door: st.door,
                 refs: new Map(), hunks: new Map(), left: REF_CAP, rev: "" };
    const link = function (t) { return mnt.within(pos, function () { return urlOf(pg, t); }); };
    sendPage(sock, 200, "OK", "choose " + r.arg,
             html.page("choose " + r.arg, html.hunksHtml(hunks, link, "", acts(st, mount))),
             only);
    return "200";
  }
  //  BEE-003: the verb runs IN THE REPO THAT HOLDS THE PATH — a submodule is an
  //  ordinary repo ([BEE-006]) addressed through its parent (ruling 5), so the
  //  arg is re-rooted at whichever worktree actually carries it.
  let arg = r.arg, from = mount.root, prefix = "", verb = r.verb;
  const p0 = argPath(arg), rev = argRev(arg);
  //  BEE-028: no verb in the URL — the target is a path, and its page is at the
  //  spelled form: a dir under `list`, a file (or nothing) under `cat`.
  if (verb === "path") {
    const s = st.door.statOf(mount.root + "/" + p0);
    if (s !== null)
      return moveTo(sock, "/" + mount.name + (s.kind === "dir" ? "/list" : "/cat") +
                    r.raw.slice(1 + r.repo.length) + r.query, only);
    verb = "cat";                         // nothing there: `cat` says so, no detour
  }
  if (p0 !== "" && p0.charAt(0) !== "/") {
    //  BEE-020:55: `serves`, not `deepest` — a path the worktree does not carry
    //  (a hexlet, a file gone at that rev) still names the sub it belongs to.
    const deep = mnt.serves(mount.root, p0);
    if (deep !== null && deep !== mount.root && mnt.under(mount.root, deep)) {
      from = deep;
      prefix = deep.slice(mount.root.length + 1);
      arg = (mount.root + "/" + p0).slice(deep.length + 1) + (rev ? "?" + rev : "");
    }
  }
  //  The AMBIENT of this request: the repo, the path, and nothing of the cwd.
  const pos = { repo: from, path: argPath(arg), anchor: "" };
  let hunks;
  try { hunks = mnt.within(pos, function () { return st.door.verbs[verb](arg, { from: from }); }); }
  catch (e) {
    //  BEE-028: the verb refused, but read as a PATH the URL names a file in
    //  the repo (`/todo/BE/BE-038.mkd`): the refusal names the path form too.
    const asPath = r.head + "/" + p0, ps = st.door.statOf(mount.root + "/" + asPath);
    const hint = ps === null ? null : { text: "as a path it is at", href: "/" + mount.name +
      (ps.kind === "dir" ? "/list/" : "/cat/") + escPath(asPath) + (ps.kind === "dir" ? "/" : "") };
    sendPage(sock, 404, "Not Found", verb, html.errorPage(verb, why(e), hint), only);
    return "404";
  }
  //  LITE-036: a raw-bytes URL has no page to paint and no reference to follow.
  if (r.head === "bytes") return sendBytes(sock, hunks, argPath(arg), only);
  //  One page, one resolution budget and one cache: a reference is followed
  //  ONCE here and the href it yields is final.
  const pg = { root: from, name: mount.name, prefix: prefix, door: st.door,
               refs: new Map(), hunks: new Map(),
               left: REF_CAP, rev: verb === "cat" ? argRev(arg) : "" };
  const link = function (t) { return mnt.within(pos, function () { return urlOf(pg, t); }); };
  const title = (r.head === "raw" ? "raw" : verb) + (arg ? " " + arg : "");
  //  LITE-035/037: a `.md` or `.rst` READS as a page by default; `/raw/` is the
  //  same bytes painted, and each view links to the other.
  const path = verb === "cat" ? argPath(arg) : "";
  const rend = path ? renderOf(path) : null;
  let body;
  if (r.head !== "raw" && verb === "cat" && rend)
    body = mnt.within(pos, function () { return pageBody(pg, path, arg, hunks, rend); });
  else if (r.head === "raw")
    //  BEE-032 nit: the toggle rides the hunk's own banner line, no bar of its own.
    body = html.hunksHtml(hunks, link,
                          rend ? html.toggle("rendered", argUrl(pg, "cat", arg)) : "",
                          acts(st, mount));
  else body = html.hunksHtml(hunks, link, "", acts(st, mount));
  //  BEE-047: the act's one report line is SPENT here — on the very page its
  //  303 sent the browser back to, and only once.
  if (st.flash && !only) { body = html.viewBar(st.flash, "", "") + body; st.flash = ""; }
  sendPage(sock, 200, "OK", title, html.page(title, body), only);
  return "200";
}

//  --- the verb ---------------------------------------------------------------
//  http(args, door) — `door` IS main.js's own door (the verb table plus the
//  reference resolution), handed in rather than required back: one mechanism in
//  the tree, no http-side variant, and no import cycle.
function listen(args, door) {
  let port = PORT, ro = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plain") continue;                 // no bytes to page: a no-op
    if (args[i] === "--port") { port = Number(args[++i]); continue; }
    //  BEE-047: the ONE global read-only switch — acts are on by default, and
    //  this locks them: POST is refused and no write face paints as a button.
    if (args[i] === "--ro") { ro = true; continue; }
    throw "http: " + args[i] + " is not an option — try: bee http [--port <n>] [--ro]";
  }
  if (!(port > 0 && port < 65536 && port === Math.floor(port)))
    throw "http: --port wants a whole number from 1 to 65535";

  //  BEE-003: the repo is no longer PROCESS STATE — every URL names its own
  //  (`/<repo>/…`, off the [BEE-001] registry), so nothing chdirs and no repo is
  //  opened here.  The cwd's repo is only the HOME one a bare URL 301s to; the
  //  climb still runs so `bee http` outside a repo refuses as it always did.
  const ctx = idx.openRepo(io.cwd(), true);
  const root = ctx.root;
  idx.closeRepo(ctx);
  const c = mnt.canon(root);
  const home = c !== null && c.rel === "" ? c.mount
             : { name: mnt.basename(root), root: root, prefix: "", own: mnt.basename(root),
                 top: root, dup: false };

  const st = { door: door, root: root, home: home, acts: !ro, flash: "",
               css: utf8.Encode(html.stylesheet()),
               icon: io.mmap(__dirname + "/blob/favicon.ico", "r").data() };

  const srv = net.createServer(function (sock) {
    let buf = new Uint8Array(0), done = false;
    sock.on("error", function () { });                   // a dropped browser is not news
    sock.on("data", function (chunk) {
      if (done) return;
      const all = new Uint8Array(buf.length + chunk.length);
      all.set(buf, 0);
      all.set(chunk, buf.length);
      buf = all;
      let req;
      try { req = drainHead(buf); }
      catch (e) {
        done = true;
        respond(sock, 400, "Bad Request", TEXT,
                utf8.Encode("bee http: that is not an HTTP request\n"), false);
        return;
      }
      if (req === null) {                                 // need more bytes
        if (buf.length > MAXHEAD) {
          done = true;
          respond(sock, 431, "Request Header Fields Too Large", TEXT,
                  utf8.Encode("bee http: that request head is too long\n"), false);
        }
        return;
      }
      //  BEE-047: the act POST is the ONE request with a body — drained in the
      //  head's own spot and capped as the head is; oversize is a 413, not a hang.
      const need = bodyLen(req);
      if (need > MAXPOST) {
        done = true;
        respond(sock, 413, "Payload Too Large", TEXT,
                utf8.Encode("bee http: that act body is too long\n"), false);
        return;
      }
      if (need > 0) {
        if (buf.length < req.length + need) return;      // need more bytes
        req.body = utf8.Decode(buf.slice(req.length, req.length + need));
      }
      done = true;
      //  A page must never take the LOOP down with it: a surprise is a 500.
      let code;
      try { code = handle(req, sock, st); }
      catch (e) {
        code = "500";
        try {
          respond(sock, 500, "Internal Server Error", TEXT,
                  utf8.Encode("bee http: " + why(e) + "\n"), false);
        } catch (e2) { sock.destroy(); }
      }
      io.log(req.method + " " + req.uri + " " + code + "\n");
    });
  });
  //  BEE-027: the server is process-resident, so the rev tree lives as long as
  //  it does; the watcher fd rides the SAME `pol` loop the transport does.
  const cache = require("index/cache.js");
  if (cache.start(root)) cache.polWatch();

  srv.listen(port, HOST, function () {
    io.log("bee http: http://" + HOST + ":" + port + "/" + home.name +
           "/ browsing " + root + " and every registered repo\n");
  });
  return srv;
}

module.exports = { http: listen, routeOf: routeOf, urlOf: urlOf, argUrl: argUrl,
                   repoNames: repoNames, pathIn: pathIn,
                   escPath: escPath, repoRel: repoRel, anchorByte: anchorByte,
                   renderOf: renderOf, argPath: argPath, argRev: argRev,
                   pageHref: pageHref, extOf: extOf,
                   mimeOf: mimeOf, ROUTE: ROUTE, MIME: MIME, PORT: PORT,
                   HOST: HOST, REF_CAP: REF_CAP, MAXBYTES: MAXBYTES,
                   actPath: actPath, actRepo: actRepo, formField: formField,
                   MAXPOST: MAXPOST };
