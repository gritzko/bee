//  bee/test/kv/find.js — BEE-024: the `find` door as a line-per-path filter, so
//  run.sh can ask the lane a question without a CLI verb existing yet (the
//  board BEE-025 is the real door).  Clauses come in `$KV_ARGS`, space-separated:
//    `Now=OPEN`         exact          `Due~26819`   a ron60 prefix range
//    `Who`              presence       `yaml:status=open`  a preamble key
"use strict";
const kv = require("index/kv.js");

function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }

const filters = [];
for (const a of (io.getenv("KV_ARGS") || "").split(" ")) {
  if (a === "") continue;
  let s = a, yaml = false;
  if (s.slice(0, 5) === "yaml:") { yaml = true; s = s.slice(5); }
  const eq = s.indexOf("="), tl = s.indexOf("~");
  if (eq > 0) filters.push({ key: s.slice(0, eq), value: s.slice(eq + 1), yaml: yaml });
  else if (tl > 0) filters.push({ key: s.slice(0, tl), prefix: s.slice(tl + 1), yaml: yaml });
  else filters.push({ key: s, any: true, yaml: yaml });
}
for (const p of kv.find(io.cwd(), filters).files) w1(p + "\n");
