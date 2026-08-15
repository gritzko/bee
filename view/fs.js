//  view/fs.js — LITE-045: the FILESYSTEM view.  A path becomes a hunk: a file's
//  bytes with tok.parse's spans over them, a directory's entries as an
//  'F'-tagged listing, or the LITE-015 chooser a partial reference resolves to.
//  Pure JS over the quickjab-shared bindings: io.mmap/stat/readdir, tok.parse
//  (-> tok32), utf8.
//
//  A VIEW, like view/list.js or view/log.js: it makes hunks and paints
//  nothing.  Which is why the row index, the ansi painter and the plain sink
//  that used to share this file with it now live under render/.
//
//  LITE-001: the SYNTAX file/dir view only — the be/ diff two-pass renderer,
//  the why/blame wash, the elastic `B` field, the TLV/table sinks and the URI
//  machinery are all out of the lite floor.
"use strict";

//  A hunk: { uri, verb:"hunk", text:Uint8Array, toks:Uint32Array, kind }.
//  text/toks are the raw bytes + packed tok32 the renderer indexes & paints.

//  Strip a single trailing '/' for FS ops (stat/mmap/readdir take the bare
//  path); the banner keeps the arg verbatim, so we never mutate `arg`.
function fsPath(path) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

//  Build a FILE hunk: mmap the bytes, tok.parse by extension (best-effort —
//  an unknown ext yields no toks, exactly like BROTokenize's KnownExt gate).
function buildFileHunk(arg, path) {
  const bytes = io.mmap(path, "r").data();
  const ext = pathExt(path);
  let toks;
  try { toks = ext ? tok.parse(bytes, ext) : new Uint32Array(0); }
  catch (e) { toks = new Uint32Array(0); }   // lex miss → no highlight, still cat
  return { uri: arg, verb: "hunk", text: bytes, toks: toks, kind: "file" };
}

//  [tag, byte end] pairs -> the packed tok32 array (tag in [31..27], end in
//  [23..0]) — the one packer every hand-built hunk here shares.
function packToks(tagAt) {
  const toks = new Uint32Array(tagAt.length);
  for (let i = 0; i < tagAt.length; i++)
    toks[i] = (((tagAt[i][0].charCodeAt(0) - 65) & 0x1f) << 27) | (tagAt[i][1] & 0xffffff);
  return toks;
}

//  Build a DIR hunk: one line per entry (basename, dirs get a trailing '/'),
//  tagged 'F' (filename) + 'P' for the slash, in FILEScanDir order.  Mirrors
//  BROListDir / listdir_emit (FILE_SCAN_ALL = include dotfiles).  An empty dir
//  yields NULL — BROListDir emits no hunk (no banner) for it.
function buildDirHunk(arg, path) {
  const entries = io.readdir(path, { hidden: true });
  if (entries.length === 0) return null;
  let text = "";
  const tagAt = [];                          // [{tag, end}] over the text bytes
  for (const e of entries) {
    const isDir = e.endsWith("/");
    const name = isDir ? e.slice(0, -1) : e;
    text += name;
    tagAt.push(["F", utf8.Encode(text).length]);
    if (isDir) { text += "/"; tagAt.push(["P", utf8.Encode(text).length]); }
    text += "\n";
    tagAt.push(["W", utf8.Encode(text).length]);
  }
  return { uri: arg, verb: "hunk", text: utf8.Encode(text), toks: packToks(tagAt),
           kind: "dir" };
}

//  LITE-015: the CHOOSER hunk — one row per full path a PARTIAL names: the
//  visible repo-relative text, then the openable path under a hidden `U` span.
//  LITE-024: `tail` is the ref's `:line(:col)?` — the hidden target keeps it, so
//  the chosen row re-enters the door suffixed and lands on the line.
function buildChooserHunk(arg, rows, tail) {
  let text = "";
  const tagAt = [];
  for (const r of rows) {
    text += r.rel;
    tagAt.push(["F", utf8.Encode(text).length]);
    text += r.full + (tail || "");              // the click target, no column
    tagAt.push(["U", utf8.Encode(text).length]);
    text += "\n";
    tagAt.push(["W", utf8.Encode(text).length]);
  }
  return { uri: arg, verb: "hunk", text: utf8.Encode(text), toks: packToks(tagAt),
           kind: "chooser" };
}

//  ---- path ext (PATHu8sExt) ----------------------------------------------
//  The extension after the last '.' in the basename, or "" (no dot, or a
//  dotfile whose only dot is leading).  Drives the tok.parse language.
function pathExt(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

module.exports = {
  buildFileHunk: buildFileHunk,
  buildDirHunk: buildDirHunk,
  buildChooserHunk: buildChooserHunk,     // LITE-015: the several-hits view
  packToks: packToks,
  fsPath: fsPath,
  pathExt: pathExt,
};
