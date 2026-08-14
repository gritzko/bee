//  index/blob.js — LITE-017: `lite blob <hexlet>`, ported from
//  be/views/blob/blob.js (JAB-007).
//
//  THE RULING (gritzko, JAB-007): blob emits a HUNK, the way cat does — never a
//  raw dump.  So this is cat's by-OBJECT-SHA twin and nothing else: where cat
//  reads a file by path, blob reads a blob by the sha a 6..40 hexlet names, and
//  the bytes then take the SAME road — verbatim under `--plain`, one pager hunk
//  at a terminal, banner `blob <sha40>`.
//
//  The banner is the RESOLVED full sha in every case, so a short hexlet and the
//  full 40 produce byte-identical output (be's JS-082 leg).  lite has no
//  short-prefix scanner of its own to get wrong: `git.getHex` takes any 6..40
//  name, and the full sha comes back from framing the bytes — diff.js's own
//  blobSha, which is the git object-name rule and not a second copy of it.
//
//  PURE ODB: no index, no `bringUp`, so blob answers in a repo whose `.git/be`
//  was never built.  An EMPTY blob emits nothing at all (cat's own case).
"use strict";

const idx = require("./index.js");
const df = require("./diff.js");
const lg = require("./log.js");
const rd = require("./read.js");

//  blob(arg, opts) -> { uri, sha, bytes, hunks }.
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
    return { uri: uriStr, sha: sha, bytes: o.bytes, hunks: hunks };
  } finally { idx.closeRepo(ctx); }
}

module.exports = { blob: blob };
