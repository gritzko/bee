//  index/serve.js — LITE-034: `lite serve [--port <n>]`, the repo browser over
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
//  READ ONLY.  GET and HEAD answer; every other method is refused, no request
//  body is ever read, and the listener binds 127.0.0.1 — this is a browser, not
//  a service.  The pol loop runs until SIGINT; nothing daemonises.
"use strict";

const idx = require("index/index.js");
const rd = require("index/read.js");
const bro = require("view/bro.js");
const html = require("view/html.js");

const PORT = 8034;                  // the fixed default; --port overrides
const HOST = "127.0.0.1";           // localhost only — no flag opens this up
const MAXHEAD = 64 << 10;           // a head bigger than this is not a browser
const REF_CAP = 512;                // distinct references resolved per page
const HTML = "text/html; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";

//  --- the QJAB-004 coupling --------------------------------------------------
//  EVERY http leaf call lives in these two functions, so an API change is edited
//  here and nowhere else.  `drainHead` -> a head object, or null = need more.
function drainHead(bytes) { return http._drain(bytes); }
function feedHead(head) { return http._feed(head); }

//  --- the URL table ----------------------------------------------------------
//  The FIRST path segment names the verb; everything after it (plus `?<rev>`) is
//  the arg.  `/` is the root list.  `/style.css` is the one generated sheet.
const ROUTE = {
  "":       "list",                 //  /                  the root list
  list:     "list",                 //  /list/<path>[?<rev>]
  log:      "log",                  //  /log/<path|hex>
  commit:   "commit",               //  /commit/<hex>
  diff:     "diff",                 //  /diff/<hex|path>
  cat:      "cat",                  //  /cat/<path>[?<rev>]
  tree:     "tree",                 //  /tree/<path|hex>[?<rev>]
  blob:     "blob",                 //  /blob/<hexlet>
};

//  Percent-decoding goes through the abc/URI leaf, never a hand-rolled scan.
function unesc(s) { try { return URI.unescape(s); } catch (e) { return s; } }

//  A request URI -> { head, verb, arg }.  The split is `uri._parse`'s — path
//  and query are its slots; only the path SEGMENTS are joined back by hand.
function routeOf(reqUri) {
  let u;
  //  A request URI abc/URI refuses names no page — a 404, never a thrown loop.
  try { u = uri._parse(String(reqUri === undefined ? "" : reqUri)); }
  catch (e) { return { head: String(reqUri), verb: undefined, arg: "" }; }
  const segs = String(u.path || "/").split("/");
  const head = segs.length > 1 ? unesc(segs[1]) : "";
  const rest = segs.slice(2).map(unesc).join("/");
  return { head: head, verb: ROUTE[head],
           arg: rest + (u.query ? "?" + unesc(u.query) : "") };
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
    ? argUrl(pg.root, verb, target.slice(sp + 1).trim())
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

//  A verb + arg -> `/<verb>/<path>[?<rev>]`: a nav target names a path
//  ABSOLUTELY, so the root comes off, and each SEGMENT escapes on its own.
function argUrl(root, verb, arg) {
  //  A target abc/URI refuses (a raw space in a path) is all PATH — a link is
  //  built while PAINTING, so it may never throw a page away.
  let a;
  try { a = rd.argSplit(arg); } catch (e) { a = { path: arg, rev: "" }; }
  const rel = repoRel(root, a.path);
  return "/" + verb + "/" + escPath(rel === null ? a.path : rel) +
         (a.rev ? "?" + URI.escape(a.rev) : "");
}

//  --- references, resolved at RENDER time ------------------------------------
//  Every distinct reference on a page is resolved ONCE (a permalink follow folds
//  two blobs; a page repeating a ref must not pay twice) and no more than
//  REF_CAP of them — past that a page would hold the single-threaded loop.
function refUrl(pg, target) {
  if (pg.refs.has(target)) return pg.refs.get(target);
  let url = "";
  if (pg.left > 0) { pg.left--; url = refResolve(pg, target); }
  pg.refs.set(target, url);
  return url;
}

//  The DOOR resolves; this only spells the answer as a URL.  A dir opens in the
//  browser, a file in `cat` anchored on the landed token; SEVERAL hits name no
//  single page and a miss names none at all, and both come back "" (plain text).
function refResolve(pg, target) {
  let seat;
  try { seat = pg.door.seatOf(target); } catch (e) { return ""; }
  if (seat === null || seat.rels) return "";
  //  The door names an fs path (relative to the cwd it resolved in, which is the
  //  root); index/read.js's own gate turns it into the repo-relative one a URL
  //  needs and REFUSES anything outside — such a ref simply gets no page.
  let rel;
  try { rel = rd.repoRel("cat", { root: pg.root }, seat.full, pg.root); }
  catch (e) { return ""; }
  if (rel === "") return "";
  const st = pg.door.statOf(seat.full);
  if (st === null) return "";
  if (st.kind === "dir") return "/list/" + escPath(rel) + "/";
  const b = anchorByte(pg, seat);
  return "/cat/" + escPath(rel) + (b >= 0 ? "#" + html.anchorId(0, b) : "");
}

//  The byte the landed TOKEN starts at, in the bytes `/cat/<rel>` will serve —
//  the resolver's own token when it walked one (a permalink), else the token
//  view/bro.js's landAt puts the `file:line(:col)` on (with no column, the
//  LINE's first token).  -1 = nothing to anchor: the link stays bare.
function anchorByte(pg, seat) {
  if (seat.hi > seat.lo) return seat.lo;
  if (!seat.line) return -1;
  const h = openOnce(pg, seat.full);
  if (h === null) return -1;
  const la = bro.landAt(h.text, seat.line, seat.col);
  if (la === null) return -1;
  const sp = bro.tokSpanAt(h, la.at);
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

//  --- the response -----------------------------------------------------------
function respond(sock, status, reason, type, body, headOnly) {
  sock.write(feedHead({ version: "HTTP/1.1", status: status, reason: reason,
                        headers: [["Content-Type", type],
                                  ["Content-Length", String(body.length)],
                                  ["Connection", "close"]] }));
  if (!headOnly && body.length) sock.write(body);
  sock.end();
}

function sendPage(sock, status, reason, title, body, headOnly) {
  respond(sock, status, reason, HTML, utf8.Encode(body), headOnly);
}

//  A verb's refusal is already in plain words — it becomes the page.
function why(e) {
  return String(e && e.message !== undefined && e.message !== null ? e.message : e);
}

//  --- one request ------------------------------------------------------------
function handle(req, sock, st) {
  const m = String(req.method || "");
  const only = m === "HEAD";
  //  No write endpoints of any kind: reads answer, everything else is refused.
  if (m !== "GET" && !only) {
    respond(sock, 405, "Method Not Allowed", TEXT,
            utf8.Encode("lite serve only reads; " + m + " is not allowed\n"), false);
    return "405";
  }
  const r = routeOf(req.uri);
  if (r.head === "style.css") {
    respond(sock, 200, "OK", "text/css; charset=utf-8", st.css, only);
    return "200";
  }
  if (r.verb === undefined) {
    sendPage(sock, 404, "Not Found", "lite serve",
             html.errorPage("lite serve", "there is no /" + r.head + " page here"), only);
    return "404";
  }
  let hunks;
  try { hunks = st.door.verbs[r.verb](r.arg); }
  catch (e) {
    sendPage(sock, 404, "Not Found", r.verb, html.errorPage(r.verb, why(e)), only);
    return "404";
  }
  //  One page, one resolution budget and one cache: a reference is followed
  //  ONCE here and the href it yields is final.
  const pg = { root: st.root, door: st.door, refs: new Map(), hunks: new Map(),
               left: REF_CAP };
  const link = function (t) { return urlOf(pg, t); };
  const title = r.verb + (r.arg ? " " + r.arg : "");
  sendPage(sock, 200, "OK", title, html.page(title, html.hunksHtml(hunks, link)), only);
  return "200";
}

//  --- the verb ---------------------------------------------------------------
//  serve(args, door) — `door` IS main.js's own door (the verb table plus the
//  reference resolution), handed in rather than required back: one mechanism in
//  the tree, no serve-side variant, and no import cycle.
function serve(args, door) {
  let port = PORT;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--plain") continue;                 // no bytes to page: a no-op
    if (args[i] === "--port") { port = Number(args[++i]); continue; }
    throw "serve: " + args[i] + " is not an option — try: lite serve [--port <n>]";
  }
  if (!(port > 0 && port < 65536 && port === Math.floor(port)))
    throw "serve: --port wants a whole number from 1 to 65535";

  //  The repo is found ONCE, and the cwd moves to its root: every URL is
  //  repo-relative, so the dir the verbs resolve against must be the root too.
  const ctx = idx.openRepo(io.cwd(), true);
  const root = ctx.root;
  idx.closeRepo(ctx);
  io.chdir(root);

  const st = { door: door, root: root, css: utf8.Encode(html.stylesheet()) };

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
                utf8.Encode("lite serve: that is not an HTTP request\n"), false);
        return;
      }
      if (req === null) {                                 // need more bytes
        if (buf.length > MAXHEAD) {
          done = true;
          respond(sock, 431, "Request Header Fields Too Large", TEXT,
                  utf8.Encode("lite serve: that request head is too long\n"), false);
        }
        return;
      }
      done = true;
      //  The body is never read — there is nothing here that takes one.
      //  A page must never take the LOOP down with it: a surprise is a 500.
      let code;
      try { code = handle(req, sock, st); }
      catch (e) {
        code = "500";
        try {
          respond(sock, 500, "Internal Server Error", TEXT,
                  utf8.Encode("lite serve: " + why(e) + "\n"), false);
        } catch (e2) { sock.destroy(); }
      }
      io.log(req.method + " " + req.uri + " " + code + "\n");
    });
  });
  srv.listen(port, HOST, function () {
    io.log("lite serve: http://" + HOST + ":" + port + "/ browsing " + root + "\n");
  });
  return srv;
}

module.exports = { serve: serve, routeOf: routeOf, urlOf: urlOf, argUrl: argUrl,
                   escPath: escPath, repoRel: repoRel, anchorByte: anchorByte,
                   ROUTE: ROUTE, PORT: PORT, HOST: HOST, REF_CAP: REF_CAP };
