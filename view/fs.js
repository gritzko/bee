//  view/fs.js — the filesystem view (LITE-045:27:t2): a path becomes a hunk, be
//  it a file's bytes under tok.parse spans, a directory as an `F`-tagged
//  listing, or the chooser a partial reference resolves to (LITE-015).  A view
//  makes hunks and paints nothing, which is why the row geometry, the ansi
//  painter and the plain sink that once shared this file now live under
//  render/ (LITE-045:30:t2).  Only the syntax file/dir view is in scope: no
//  diff or blame wash and no URI machinery (LITE-001).
"use strict";

//  A hunk is { uri, verb:"hunk", text:Uint8Array, toks:Uint32Array, kind }:
//  the raw bytes and the packed tok32 spans a renderer indexes and paints.

//  Strip a single trailing '/' for the fs ops, which take the bare path; the
//  banner keeps the argument verbatim, so `arg` itself is never mutated.
function fsPath(path) {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

//  Build a file hunk: mmap the bytes and tok.parse them by extension.  An
//  unknown extension yields no spans, so the file still shows, unpainted.
function buildFileHunk(arg, path) {
  const bytes = io.mmap(path, "r").data();
  const ext = pathExt(path);
  let toks;
  try { toks = ext ? tok.parse(bytes, ext) : new Uint32Array(0); }
  catch (e) { toks = new Uint32Array(0); }   // a lexer miss: unpainted, still shown
  return { uri: arg, verb: "hunk", text: bytes, toks: toks, kind: "file" };
}

//  [tag, byte end] pairs -> the packed tok32 array (tag in bits 31..27, end in
//  23..0; dog/tok/TOK.h), the one packer every hand-built hunk here shares.
function packToks(tagAt) {
  const toks = new Uint32Array(tagAt.length);
  for (let i = 0; i < tagAt.length; i++)
    toks[i] = (((tagAt[i][0].charCodeAt(0) - 65) & 0x1f) << 27) | (tagAt[i][1] & 0xffffff);
  return toks;
}

//  Build a directory hunk: one line per entry, dotfiles included, a dir with a
//  trailing '/', the name tagged `F` and the slash `P`, so the pager can open
//  an entry.  An empty dir yields null, since a banner over nothing is noise.
function buildDirHunk(arg, path) {
  const entries = io.readdir(path, { hidden: true });
  if (entries.length === 0) return null;
  let text = "";
  const tagAt = [];                          // [tag, end] pairs over the text bytes
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

//  The chooser hunk (LITE-015:21:q3): one row per full path a partial reference
//  names, the visible repo-relative text and then the openable path under a
//  hidden `U` span.  `tail` is the reference's `:line(:col)?`, kept on the
//  target (LITE-024:28:4s); a row names its repo when the resolver crossed repos.
function buildChooserHunk(arg, rows, tail) {
  let text = "";
  const tagAt = [];
  for (const r of rows) {
    text += (r.repo ? r.repo + "/" : "") + r.rel;
    tagAt.push(["F", utf8.Encode(text).length]);
    text += r.full + (tail || "");              // the click target takes no column
    tagAt.push(["U", utf8.Encode(text).length]);
    text += "\n";
    tagAt.push(["W", utf8.Encode(text).length]);
  }
  return { uri: arg, verb: "hunk", text: utf8.Encode(text), toks: packToks(tagAt),
           kind: "chooser" };
}

//  The extension after the last '.' in the basename, or "" for no dot or a
//  dotfile whose only dot is leading; it selects the tok.parse language.
function pathExt(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1) : "";
}

module.exports = {
  buildFileHunk: buildFileHunk,
  buildDirHunk: buildDirHunk,
  buildChooserHunk: buildChooserHunk,     // the several-hits view (LITE-015)
  packToks: packToks,
  fsPath: fsPath,
  pathExt: pathExt,
};
