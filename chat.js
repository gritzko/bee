//  chat.js — `bee chat [dir] [outdir]`: render Claude Code session logs as
//  /wiki/StrictMark pages, CHAT-001's format v2 verbatim with only the be-isms
//  bridged to bee/quickjab (LITE-016:8:cD).  One page per jsonl, named by a
//  10-char ron60 digest of the basename (LITE-022:8:a~), reads as a plain
//  conversation: user turns quoted, claude verbatim, tool calls one fenced
//  line each; harness XML never reaches the page.  Reentrant with no sidecar
//  state — the trailing `[log]:` ref def carries the consumed-bytes cursor
//  (CHAT-001:23:oC), so a rerun appends byte-identically or regenerates.
"use strict";

//  The machine-injected XML envelopes — harness plumbing Claude Code stores
//  inside the user turn, not conversation.  Whole elements are cut; a turn
//  left with only whitespace contributes no turn at all, which also keeps an
//  append byte-identical to a from-scratch render (CHAT-001:43:oC).
const NOISE = ["system-reminder", "local-command-caveat", "local-command-stdout",
               "command-name", "command-message", "command-args",
               "task-notification"];

//  A tool call renders as `<name> <essential arg>` — the first of these
//  string fields the input carries, ordered so the short, telling one wins
//  (Bash -> command, Read -> file_path, Agent -> description over its huge
//  prompt); an input with none of them falls back to compact one-line json.
const ARG_KEYS = ["command", "file_path", "path", "pattern", "url", "query",
                  "summary", "description", "skill", "prompt", "message"];
const ARG_CAP = 200;

//  LITE-016: quickjab's `io.log` appends the newline itself, so bee's messages
//  carry none — the one deliberate departure from CHAT-001's call sites.
function say(msg) { io.log(msg); }

function readBytes(p) {
  if (Number(io.stat(p).size) === 0) return new Uint8Array(0);   // mmap of 0 bytes
  return io.mmap(p, "r").data();
}

function tryText(p) { try { return utf8.Decode(readBytes(p)); } catch (e) { return null; } }

//  as merge.js: create the parent dirs, then write the bytes.
function writeFile(p, text) {
  const dir = dirname(p);
  if (dir) io.mkdir(dir);                        // FILEMakeDirP: parents, idempotent
  const bytes = utf8.Encode(text);
  const fd = io.open(p, "c");
  try { const b = io.buf(bytes.length + 8); b.feed(bytes); io.writeAll(fd, b); }
  finally { io.close(fd); }
}

//  LITE-016: be's shared/util/path.js is not in bee — the two helpers chat used
//  (dirname, resolveInTree) inline here, `normalize` as view/log.js writes it.
function dirname(p) {
  if (p === "/" || p === "") return p;
  const i = p.lastIndexOf("/");
  if (i < 0) return ".";
  return i === 0 ? "/" : p.slice(0, i);
}

function normalize(p) {
  const abs = p[0] === "/";
  const out = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") { if (out.length) out.pop(); continue; }
    out.push(s);
  }
  return (abs ? "/" : "") + out.join("/");
}

//  A dir ARG -> its absolute path.  Relative args count from the cwd (bee has
//  no context dir); `~` is the home shorthand.  `.`/`..` segments fold through
//  normalize, exactly as view/log.js resolves a path arg.
function absDir(arg) {
  let s = String(arg == null ? "." : arg);
  if (s === "") s = ".";
  if (s === "~" || s.slice(0, 2) === "~/") s = home() + s.slice(1);
  return normalize(s[0] === "/" ? s : io.cwd() + "/" + s);
}

function home() { return io.getenv("HOME") || ""; }
function osUser() { return io.getenv("USER") || io.getenv("LOGNAME") || ""; }

//  The Claude home — `$CLAUDE_CONFIG_DIR`, else `~/.claude` (Claude Code's own
//  rule), so a test can point the whole lookup at a scratch tree.
function claudeHome() { return io.getenv("CLAUDE_CONFIG_DIR") || (home() + "/.claude"); }

//  The project dir's log dir: the ABSOLUTE path, non-alphanumerics -> `-`
//  (the leading `/` mangles too, hence the leading `-`).
function logDirFor(dir) {
  return claudeHome() + "/projects/" + dir.replace(/[^a-zA-Z0-9]/g, "-");
}

//  LITE-022: the page name — ron60 of the top 60 bits of sha1(basename), the
//  index/index.js hashlet60 exactly; a pure function of the basename, so a
//  rerun lands on the same page with no state kept.  `ron.encode` drops the
//  leading zeros (RONutf8sFeed); RON64's zero digit is `0`, so left-pad.
function pageName(base) {
  const sha = sha1(utf8.Encode(String(base)));
  let h = 0n;
  for (let i = 0; i < 8; i++) h = (h << 8n) | BigInt(sha[i]);
  return ron.encode(h >> 4n).padStart(10, "0");
}

function pad2(n) { return (n < 10 ? "0" : "") + n; }

//  An ISO row timestamp -> `YYYY-MM-DD HH:MM` in LOCAL time; "" if unusable.
function localStamp(iso) {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return "";
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
         " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

//  The page's one piece of furniture, stamped from the FIRST row that actually
//  renders — so it lands immediately before the first turn whether that turn is
//  written by a fresh render or by an append (see convert(): a page with no
//  turns yet has an empty head, and that is exactly when the header is due).
function sessionHead(row) {
  const bits = [];
  const t = localStamp(row.timestamp);
  if (t) bits.push(t);
  const u = osUser();
  if (u) bits.push(u);
  return "#   Session" + (bits.length ? ": " + bits.join(" ") : "") + "\n\n";
}

//  Cut every machine-injected XML envelope out of a user text block.  Returns
//  "" when nothing but plumbing was there.
function clean(s) {
  let t = String(s == null ? "" : s);
  for (const tag of NOISE) {
    t = t.replace(new RegExp("<" + tag + "(?:\\s[^>]*)?>[\\s\\S]*?</" + tag + ">", "g"), "");
    t = t.replace(new RegExp("<" + tag + "(?:\\s[^>]*)?/>", "g"), "");
  }
  t = t.trim();
  if (!t) return "";
  //  Backstop: a TRUNCATED or unclosed envelope must never reach the page
  //  either — if any noise opener survived the cut, the whole block goes.
  for (const tag of NOISE) if (t.indexOf("<" + tag) >= 0) return "";
  return t;
}

//  A user turn is a blockquote: `>   ` on every line, a bare `>` for the blanks
//  (no trailing whitespace).  The quote quad is a PREFIX quad, so the quoted
//  text keeps whatever markup it carried.
function quote(text) {
  return text.split("\n").map(function (l) {
    return l.trim() === "" ? ">" : ">   " + l;
  }).join("\n");
}

//  CHAT-001: Claude prose is verbatim, so a depth-0 header / ref def / meta
//  pair — and every fence run the message never closes — takes one `\`.
const MARKS = [/^( {0,3})#{1,6}(?:[ \t]|$)/, /^( {0,3})#{4}[^#\s]/,
               /^( {0,3})\[[^\]\n]+\]:/, /^([A-Z][a-z][a-z0-9]): /];

function fenceRun(l) { const m = /^ *(`{3,})/.exec(l); return m ? m[1].length : 0; }
function fenceShut(l, n) { const m = /^ *(`{3,})[ \t]*$/.exec(l); return !!m && m[1].length >= n; }

function loose(lines) {
  const cut = {};
  for (;;) {
    let open = -1, len = 0;
    for (let i = 0; i < lines.length; i++) {
      const run = cut[i] ? 0 : fenceRun(lines[i]);
      if (!run) continue;
      if (open < 0) { open = i; len = run; }
      else if (fenceShut(lines[i], len)) open = -1;
    }
    if (open < 0) return cut;
    cut[open] = 1;
  }
}

function strict(text) {
  const lines = String(text).split("\n");
  const cut = loose(lines);
  let open = 0;
  return lines.map(function (l, i) {
    if (open) { if (fenceShut(l, open)) open = 0; return l; }   // verbatim body
    if (cut[i]) return l.replace("`", "\\`");
    const run = fenceRun(l);
    if (run) { open = run; return l; }
    for (const re of MARKS) {
      const m = re.exec(l);
      if (m) return m[1] + "\\" + l.slice(m[1].length);
    }
    return l;
  }).join("\n");
}

function oneLine(s) { return String(s).replace(/\s+/g, " ").trim(); }

//  One tool_use block -> its one-line invocation.
function invocation(b) {
  const name = String(b.name || "tool");
  const input = b.input;
  let arg = "";
  if (typeof input === "string") arg = input;
  else if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const k of ARG_KEYS)
      if (typeof input[k] === "string" && input[k].trim()) { arg = input[k]; break; }
    if (!arg) { try { arg = JSON.stringify(input); } catch (e) { arg = ""; } }
  }
  arg = oneLine(arg);
  if (arg.length > ARG_CAP) arg = arg.slice(0, ARG_CAP) + "...";
  return arg ? name + " " + arg : name;
}

//  One fence per assistant row, no info string, body one quad deeper.  Any
//  backtick run inside an invocation line is thereby BODY, never a closer.
function fence(lines) {
  return "````\n" + lines.map(function (l) { return "    " + l; }).join("\n") + "\n````";
}

//  One conversation row -> its rendered chunks, or [] when nothing survives.
//  message.content is either a plain string (a typed prompt) or a block list.
function partsOf(row, who) {
  const c = row.message.content;
  const texts = [], calls = [];
  if (typeof c === "string") texts.push(c);
  else if (Array.isArray(c)) {
    for (const b of c) {
      if (!b || typeof b !== "object") continue;
      if (b.type === "text") texts.push(b.text);
      else if (b.type === "tool_use" && who === "claude") calls.push(invocation(b));
      //  thinking / tool_result / image / anything else: dropped.
    }
  }
  const parts = [];
  if (who === "gritzko") {
    //  Every text block of the turn, de-noised, then ONE quote for the turn.
    const kept = texts.map(clean).filter(function (t) { return t; });
    if (kept.length) parts.push(quote(kept.join("\n\n")));
  } else {
    //  Claude's prose is VERBATIM — it is already markdown.
    for (const t of texts) if (String(t == null ? "" : t).trim()) parts.push(strict(t));
    if (calls.length) parts.push(fence(calls));
  }
  return parts;
}

//  A slab of whole jsonl lines -> the StrictMark turns.  Each turn is followed
//  by a blank line, so turns CONCATENATE — which is what makes the append path a
//  plain string join, and an append byte-identical to a from-scratch render.
function renderRows(text, needHead) {
  let out = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch (e) { continue; }   // not a row we know
    if (!row || row.isSidechain) continue;
    const who = row.type === "user" ? "gritzko"
              : row.type === "assistant" ? "claude" : null;
    if (!who || !row.message) continue;
    const parts = partsOf(row, who);
    if (!parts.length) continue;                 // an all-noise row adds NOTHING
    if (needHead) { out += sessionHead(row); needHead = false; }
    for (const p of parts) out += p + "\n\n";
  }
  return out;
}

//  The page's cursor line, and its inverse.  A ref def nothing links to is
//  hidden in render, so this is provenance + cursor at zero visual cost.
function logRef(src, bytes) { return "[log]: file:" + src + ' "' + bytes + '"\n'; }

//  Read a page's cursor: { src, off, head } — the jsonl the page was rendered
//  from (LITE-022: its provenance, hence its OWNER), the consumed byte count,
//  and everything BEFORE the ref def line (the header plus the turns to append
//  onto).  null when the page is absent or carries no cursor.
function readCursor(dst) {
  const text = tryText(dst);
  if (text === null) return null;
  const nl = text.lastIndexOf("\n", text.length - 2);   // start of the last line
  const at = nl < 0 ? 0 : nl + 1;
  const m = /^\[log\]: file:(\S*) "(\d+)"\s*$/.exec(text.slice(at));
  if (!m) return null;
  return { src: m[1], off: Number(m[2]), head: text.slice(0, at) };
}

function statOf(p) { try { return io.stat(p); } catch (e) { return null; } }

//  LITE-022: claim the ron60 page for THIS jsonl off its `[log]:` ref def —
//  a page owned by another jsonl is refused in plain words (60-bit birthday
//  odds), and a pre-LITE-022 `<uuid>.mkd` page is renamed to its ron60 name,
//  then appended to as before.  `old` is absent on every run after the first.
function claim(src, old, dst) {
  const own = readCursor(dst);                   // the page's own provenance
  if (own && own.src !== src)
    throw "chat: " + dst + " is the page of " + own.src + ", not of " + src +
          " — two sessions cannot share one page";
  if (old === dst || !statOf(old)) return;       // THE one extra stat
  if (own) { say("chat: " + old + " is superseded by " + dst); return; }
  if (statOf(dst))
    throw "chat: " + dst + " carries no log cursor, so it cannot be told from " +
          old + " — remove the stale page";
  io.rename(old, dst);
}

//  The offset just past the LAST complete line at/after `from`; `from` itself
//  when the tail holds no whole line yet.
function wholeLines(bytes, from) {
  for (let i = bytes.length - 1; i >= from; i--) if (bytes[i] === 10) return i + 1;
  return from;
}

//  One jsonl -> one .mkd.  Returns "skip" | "write".
function convert(src, dst) {
  const size = Number(io.stat(src).size);
  const cur = readCursor(dst);
  //  size < off: the log was rewritten -> regenerate from byte 0.
  const grew = cur && cur.off <= size;
  const from = grew ? cur.off : 0;
  const head = grew ? cur.head : "";
  if (cur && cur.off === size) return "skip";              // nothing consumed anew
  const bytes = readBytes(src);
  const end = wholeLines(bytes, from);
  if (cur && end === from) return "skip";                  // only a partial row grew
  //  An empty head means no turn has rendered yet — so the session header is
  //  still due, and it lands before the first turn either way.
  const body = end > from
    ? renderRows(utf8.Decode(bytes.subarray(from, end)), head === "") : "";
  writeFile(dst, head + body + logRef(src, end));
  return "write";
}

//  chat(args) — the verb.  `args[0]` is the project dir, `args[1]` the out dir,
//  both default `.`; a log dir that is not there is refused in plain words.
function chat(args) {
  args = args || [];
  const dir = absDir(args[0]);
  const out = absDir(args[1]);
  const logDir = logDirFor(dir);
  let names;
  try { names = io.readdir(logDir); }
  catch (e) {
    throw "chat: no Claude session logs for " + dir + " — looked in " + logDir;
  }
  const logs = names.filter(function (n) { return /\.jsonl$/.test(n); }).sort();
  if (!logs.length) { say("chat: no session logs in " + logDir); return; }
  io.mkdir(out);
  let wrote = 0, fresh = 0;
  for (const n of logs) {
    const base = n.slice(0, -".jsonl".length);
    const src = logDir + "/" + n;
    const dst = out + "/" + pageName(base) + ".mkd";     // LITE-022
    claim(src, out + "/" + base + ".mkd", dst);
    if (convert(src, dst) === "write") { say("chat: wrote " + dst); wrote++; }
    else fresh++;
  }
  say("chat: " + wrote + " page(s) written, " + fresh + " up to date -> " + out);
}

module.exports = { chat: chat, pageName: pageName };
