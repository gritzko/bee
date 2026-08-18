//  view/mark.js — `bee mark <page.mkd>` writes ONE rendered page to stdout, the
//  port of beagle's mark CLI (beagle/mark/README.mkd) minus its file writing:
//  `> page.html` or a shell loop is the site build, so the verb owns no output
//  policy of its own.
//
//  The parsers and the emitter are http.js's own (http.js:301:dX); the SHELL is
//  this file's, since a dumped page wears the host site's stylesheet.  With no
//  server to resolve against, a page link takes the `.html` name rendered beside
//  its source, which is what makes a dumped tree link up.
"use strict";

const html = require("render/html.js");
const fs = require("view/fs.js");

//  The site's stylesheet, hardcoded (gritzko's ruling 2026-08-17): a dumped
//  page wears the HOST site's css, not bee's own terminal palette.
const STYLE = "/assets/css/style.css";

//  The page shell.  No chrome and no bee classes — the body is the emitted
//  fragment as it stands, so the site's stylesheet is the only one styling it.
function doc(title, body) {
  return '<!DOCTYPE html>\n<html><head><meta charset="utf-8">' +
         '<meta name="viewport" content="width=device-width,initial-scale=1">' +
         "<title>" + html.esc(title) + "</title>" +
         '<link rel="stylesheet" href="' + STYLE + '">' +
         "</head><body>\n" + body + "</body></html>\n";
}

//  A dialect's parser+emitter, or null for a file this verb cannot render.
//  `.mkd` renders here though http.js:301:dX keeps serving it painted — StrictMark
//  IS what this verb is asked for.
function toHtmlOf(ext) {
  if (ext === "rst") return require("mark/rst.js").toHtml;
  if (ext === "mkd" || ext === "md" || ext === "markdown")
    return require("mark/html.js").toHtml;
  return null;
}

//  A link to a PAGE lands on the page rendered beside it; everything else rides
//  verbatim, there being no door here to resolve it through.  The URI is split
//  by the parser, never by hand, and only its path's extension is swapped.
function pageHref(dest) {
  const s = String(dest);
  let u = null;
  try { u = uri._parse(s); } catch (e) { u = null; }
  if (u === null || u.scheme || u.authority || !u.path) return s;
  if (s.slice(0, u.path.length) !== u.path) return s;
  const ext = fs.pathExt(u.path);
  if (toHtmlOf(ext) === null) return s;
  return u.path.slice(0, u.path.length - ext.length) + "html" + s.slice(u.path.length);
}

//  The page TITLE is the file's own name, extension dropped — beagle's mark
//  titles a page the same way (beagle/mark/MARK.cli.c:63).
function titleOf(path) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const ext = fs.pathExt(base);
  return ext ? base.slice(0, base.length - ext.length - 1) : base;
}

//  ---- the verb -------------------------------------------------------------
//  mark(paths, opts) -> the HTML document text.  ONE page per run: stdout has
//  room for one document, so a second path is a refusal, not a concatenation.
function mark(paths) {
  if (!paths || paths.length !== 1)
    throw "mark: needs ONE page — try: bee mark <file.mkd>";
  const path = String(paths[0]);
  const toHtml = toHtmlOf(fs.pathExt(path));
  if (toHtml === null) throw "mark: " + path + " is no .mkd, .md or .rst page";
  const full = fs.fsPath(path);
  let st = null;
  try { st = io.stat(full); } catch (e) { st = null; }
  if (st === null || st.kind !== "reg") throw "mark: there is no readable " + path;
  //  An EMPTY page renders empty — mmap of zero bytes has nothing to map.
  let src = "";
  try { if (st.size) src = utf8.Decode(io.mmap(full, "r").data()); }
  catch (e) { throw "mark: there is no readable " + path; }
  return doc(titleOf(path), toHtml(src, { href: pageHref }));
}

module.exports = { mark: mark, pageHref: pageHref, titleOf: titleOf };
