//  bee/test/btnpaint/btnpaint.js — BEE-035: the button LOOK, headless.  A button
//  is two cells of its tone over a VERY PALE wash of that same tone, both riding
//  the face's own hidden `O` (BEE-034's channel), so the golden row below pins
//  the four looks — lit, info, disabled, blank — in one paint, and the html twin
//  is asked for the same pair.  The theme tables are checked as DATA: one
//  formula for the wash, a 2-cell face, a non-grey fallback tag.
"use strict";
const theme = require("render/theme.js");
const wrap = require("render/wrap.js");
const ansi = require("render/ansi.js");
const plain = require("render/plain.js");
const html = require("render/html.js");
const fixture = require(__dirname + "/fixture.js");

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function esc(s) { return String(s).replace(/\x1b/g, "\\e").replace(/\n/g, "\\n"); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + esc(got) + "\n");
}

//  ---- the theme tables ------------------------------------------------------
const NAMES = ["status", "log", "chg", "add", "del", "commit",
               "done", "dont", "go", "push", "pull", "merge"];
check("every button name has a tone",
      NAMES.every(function (k) { return /^#[0-9a-f]{6}$/.test(theme.BTN[k] || ""); }),
      JSON.stringify(theme.BTN));
check("...and a legacy fallback tag",
      NAMES.every(function (k) { return /^[A-Z]$/.test(theme.BTN_TAG[k] || ""); }),
      JSON.stringify(theme.BTN_TAG));
//  A lost prefix must degrade to the face's CLASS colour; grey is the DISABLED
//  signal and must stay unambiguous (be views/todo/todo.js:732).
check("...that paints, and never grey",
      NAMES.every(function (k) {
        const t = theme.BTN_TAG[k];
        return theme.THEME16.slots[t] && "DPQ".indexOf(t) < 0;
      }), JSON.stringify(theme.BTN_TAG));
check("every face is exactly 2 cells",
      Object.keys(theme.BTN_FACE).every(function (k) {
        return Array.from(theme.BTN_FACE[k]).length === 2; }),
      JSON.stringify(theme.BTN_FACE));
check("the faces are be's", theme.BTN_FACE.status === " i" &&
      theme.BTN_FACE.log === " ≡" && theme.BTN_FACE.commit === " ✓" &&
      theme.BTN_FACE.dont === " ✗" && theme.BTN_FACE.go === "go",
      JSON.stringify(theme.BTN_FACE));
//  ONE derivation, not a table: the tone mixed toward white by BTN_PALE.
check("pale() mixes the tone toward white, once",
      theme.pale("#000000") === "#e0e0e0" && theme.pale("#ffffff") === "#ffffff",
      theme.pale("#000000") + " " + theme.pale("#ffffff"));
check("...so every tone ships with its wash",
      NAMES.every(function (k) { return /^#[0-9a-f]{6}$/.test(theme.pale(theme.BTN[k])); }));
check("the status wash is the derived one",
      theme.pale(theme.BTN.status) === "#e0f0f9", theme.pale(theme.BTN.status));

//  ---- the `O` look grammar (render/wrap.js, beside oSpell) ------------------
check("a pair prefix reads as bg + fg",
      JSON.stringify(wrap.oLook("#e0f0f9#0085ca status //wt")) ===
      '{"bg":"#e0f0f9","fg":"#0085ca"}',
      JSON.stringify(wrap.oLook("#e0f0f9#0085ca status //wt")));
check("...an fg-only prefix names no wash",
      JSON.stringify(wrap.oLook("##0085ca ")) === '{"bg":"","fg":"#0085ca"}',
      JSON.stringify(wrap.oLook("##0085ca ")));
check("...and a bare spell no colour at all",
      wrap.oLook("status //wt") === null, JSON.stringify(wrap.oLook("status //wt")));
check("the spell still sheds the whole look",
      wrap.oSpell(fixture.LIT + "status //wt") === "status //wt",
      wrap.oSpell(fixture.LIT + "status //wt"));

//  ---- the GOLDEN row --------------------------------------------------------
//  `[ i ~3  ✓  ]`: `[`/`]` on the grey D tag, the LIT ` i` painted by its O's
//  pair (#0085ca over the derived #e0f0f9), the INFO `~3` by its O's fg alone
//  (no bg — the delta spells no 48), the DISABLED ` ✓` by the bare grey tag,
//  the blank slot unpainted.  Every cell of a face wears the face's colour.
const h = fixture.hunk();
const rows = wrap.indexRows(h, wrap.NO_CLAMP, false);
const got = ansi.paintRow(h, rows[0].off, rows[0].end, true, wrap.PASS_NORMAL);
const E = "\x1b[";
const LIT_SGR  = E + "38;2;0;133;202;48;2;224;240;249m";
const INFO_SGR = E + "38;2;54;71;201m";
const GOLD = E + "90m[" + LIT_SGR + " i" + E + "39;49m " +
             INFO_SGR + "~3" + E + "39m " + E + "90m ✓" +
             E + "39m  " + E + "90m]" + E + "0m";
check("the golden button row", got === GOLD, got);
check("the LIT face: the tone over its pale wash",
      got.indexOf(LIT_SGR + " i") >= 0, got);
check("the INFO face: the tone, no wash",
      got.indexOf(INFO_SGR + "~3") >= 0 && INFO_SGR.indexOf("48;2") < 0, got);
check("the DISABLED face: the grey tag, no pair",
      got.indexOf(E + "90m ✓") >= 0, got);
check("the BLANK slot paints nothing of its own",
      got.indexOf(E + "39m  " + E + "90m]") >= 0, got);
//  The prefix is the LOOK, not content — no `#` of it may reach the screen.
check("no look byte is painted",
      got.indexOf(fixture.LIT) < 0 && got.indexOf(fixture.INFO) < 0, got);

//  A face with NO `O` at all falls back to its own tag — the pair is an
//  override, never the only thing that colours a button.
const bare = { uri: "b", text: utf8.Encode(" i"), kind: "b",
               toks: new Uint32Array([(8 << 27) | 2]) };
check("a face with no `O` paints by its tag",
      ansi.paintRow(bare, 0, 2, true, wrap.PASS_NORMAL) === E + "38;5;33m i" + E + "0m",
      ansi.paintRow(bare, 0, 2, true, wrap.PASS_NORMAL));

//  EVERY cell of a face clicks — a button has no dead padding to mis-hit.
const p = new (require("pager.js").Pager)(-1, { tty: -1, color: false });
const face = utf8.Decode(h.text).indexOf(" i");
check("both cells of the face run the same spell",
      p._spellAt(h, face) === "status //wt" &&
      p._spellAt(h, face + 1) === "status //wt",
      p._spellAt(h, face) + " | " + p._spellAt(h, face + 1));

//  ---- plain and the pipe stay byte-clean ------------------------------------
const pl = utf8.Decode(plain.render([h]));
check("plain is the face bytes, verbatim", pl === fixture.VISIBLE, pl);
check("...with no SGR and no look", pl.indexOf("\x1b") < 0 && pl.indexOf("#") < 0, pl);
const pipe = utf8.Decode(ansi.render([h], { cols: 40 }));
check("the piped paint hides the `O` cells too",
      pipe.indexOf(fixture.LIT) < 0 && pipe.indexOf("status //wt") < 0, pipe);

//  ---- the html twin ---------------------------------------------------------
const css = html.stylesheet(theme.THEME16);
check("the stylesheet generates a class per button tone",
      css.indexOf(".btn-status{color:#0085ca;background:#e0f0f9}") >= 0, css);
check("...for every name",
      NAMES.every(function (k) { return css.indexOf(".btn-" + k + "{") >= 0; }), css);
const page = utf8.Decode(html.render([h], { link: function (t) { return "/go/" + t; } }));
function spanOf(face) {
  const i = page.indexOf(">" + face + "</span>");
  if (i < 0) return "(no such face)";
  return page.slice(page.lastIndexOf("<span", i), i + 1);
}
check("the LIT face wears the pair as inline style",
      spanOf(" i").indexOf('style="color:#0085ca;background:#e0f0f9"') >= 0, spanOf(" i"));
check("...and still clicks its shed spell",
      page.indexOf('<a href="/go/status //wt"') >= 0, page);
check("the INFO face wears the tone alone",
      spanOf("~3").indexOf('style="color:#3647c9"') >= 0 &&
      spanOf("~3").indexOf("background") < 0, spanOf("~3"));
check("the DISABLED face is the grey tag class, no style",
      spanOf(" ✓").indexOf('class="tok-D"') >= 0 &&
      spanOf(" ✓").indexOf("style") < 0, spanOf(" ✓"));
check("no look byte reaches the page", page.indexOf(fixture.LIT) < 0, page);

w1((bad ? "FAILED " : "DONE ") + n + " checks\n");
