//  view/blob.js — `bee blob <hexlet>`: a blob by object name, emitted as a
//  hunk the way cat does, never as a raw dump (the ruling at LITE-017:14:Cv).
//  The banner carries the resolved sha40, so a short hexlet and the full name
//  print identical bytes; the sha comes from framing the bytes (view/diff.js
//  blobSha) rather than from a second prefix scanner.  Only the ODB is read,
//  so the verb works in a repo whose .git/be was never built.
"use strict";

const idx = require("index/index.js");
const df = require("./diff.js");
const lg = require("./log.js");
const rd = require("index/read.js");

//  blob(arg, opts) -> { uri, sha, hunks }; an empty blob yields no hunk.
function blob(arg, opts) {
  opts = opts || {};
  const hexlet = String(arg === undefined || arg === null ? "" : arg);
  if (!lg.HEXARG.test(hexlet))
    throw "blob: " + (hexlet || "blob") +
          " is not an object name — give 6 to 40 hex digits";
  const ctx = idx.openRepo(opts.from || io.cwd(), true);
  try {
    const o = idx.object(ctx.r, hexlet.toLowerCase());
    if (o === null) throw "blob: no object in this repository is named " + arg;
    if (o.type !== "blob") throw "blob: " + arg + " is a " + o.type + ", not a file";
    const sha = df.blobSha(o.bytes);
    const uriStr = "blob " + sha;
    const hunks = o.bytes.length === 0 ? []
                : [rd.textHunk(uriStr, o.bytes, "", "blob")];
    return { uri: uriStr, sha: sha, hunks: hunks };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { blob: blob };
