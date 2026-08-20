//  render/theme.js — the STATIC, PLUGGABLE colour theme (gritzko's ruling:
//  "palette and theme as a static JS object, pluggable").  ONE place an SGR is
//  spelled — the renderer paints with what this module hands back.
//
//  --- the model (mirrors dog/THEME.h + abc/ANSI.{h,c}) --------------------
//  Native single-sources every colour as an `ansi64` slot indexed by a tag
//  letter, then spells it per cell via ANSIu8sFeedDelta(want, prev).  We mirror
//  what that emitter spells, as ready-made SGR PARAMETER strings: a basic fg
//  ("34" → ESC[34m), a 256 fg ("38;5;56"), the bold flag ("1").
//  The reset BACK to default fg is ESC[39m (default-fg, NOT ESC[0m) — so a
//  painted column is `ESC[<sgr>m` + bytes + `ESC[39m`; a bold-only slot resets
//  with ESC[22m.  The banner band closes with ESC[0m (it sets a bg, so `39`
//  alone would not clear it).
"use strict";

const ESC = "\x1b[";

//  --- slot palettes (dog/THEME.c) -----------------------------------------
//  Each map: tag letter → SGR parameter string (what ANSIu8sFeedDelta spells
//  going DEFAULT → slot).  Lite renders the SYNTAX view only, so the table is
//  the tok-syntax tags; an absent tag ('S' default, 'A' sentinel) paints nothing.
//  LITE-034: W/E/X/Q complete the table — the whitespace/body slot and the
//  STATUS-verb slots `list` marks its rows with (dog/THEME.c THEME16TBL).
const SLOTS_16 = {
  D: "90", G: "32", L: "96", H: "35", R: "94", P: "90",
  N: "1",  C: "1",  F: "38;5;56", T: "38;5;56",
  W: "32", E: "33", X: "38;5;94", Q: "90",
  //  BEE-022: the quad's own four (I/J/K/V) + M, never a borrowed tag slot.
  I: "38;5;33", J: "38;2;126;211;44", K: "38;5;178", V: "38;2;248;147;7", M: "91",
  //  The `Sev:` quartet (ruling gritzko 2026-08-20), 24-bit and the SAME in
  //  every palette — a severity is not a matter of taste.  Orange and green
  //  were already the quad's V and J, so only red and yellow are new slots.
  Y: "38;2;223;32;43", Z: "38;2;241;229;14",
};

const SLOTS_DARK = {
  D: "38;5;240", G: "38;5;37", L: "38;5;33", H: "38;5;166", R: "38;5;64",
  P: "38;5;240", N: "38;5;33;1", C: "38;5;33;1", F: "38;5;61", T: "38;5;61",
  W: "32", E: "33", X: "38;5;94", Q: "38;5;240",
  I: "38;5;33", J: "38;2;126;211;44", K: "38;5;178", V: "38;2;248;147;7", M: "38;5;160",
  Y: "38;2;223;32;43", Z: "38;2;241;229;14",     // the `Sev:` quartet, as above
};

const SLOTS_LIGHT = {
  D: "38;5;245", G: "38;5;37", L: "38;5;33", H: "38;5;166", R: "38;5;64",
  P: "38;5;245", N: "38;5;33;1", C: "38;5;33;1", F: "38;5;61", T: "38;5;61",
  W: "32", E: "33", X: "38;5;94", Q: "38;5;245",
  I: "38;5;33", J: "38;2;126;211;44", K: "38;5;178", V: "38;2;248;147;7", M: "38;5;160",
  Y: "38;2;223;32;43", Z: "38;2;241;229;14",     // the `Sev:` quartet, as above
};

//  --- banner band (dog/THEME.h THEME_BANNER) ------------------------------
//  Status/header band: black fg (256:0) on pale-yellow bg (256:230); native
//  space-fills to the terminal width.
const BANNER_SGR = "38;5;0;48;5;230";

//  --- diff wash (render/ansi.js WASH_IN / WASH_RM, LITE-010) -----------------
//  The changed-token BACKGROUNDS, as SGR parameters: salad green on the
//  to-side, salmon on the from-side.  LITE-034's HTML painter spells its
//  stylesheet out of THIS module alone, so the wash is named here too.
const WASH_IN_SGR = "48;5;157", WASH_RM_SGR = "48;5;217";
//  BEE-021: the PALE pair — a changed token painted inline, or seen from the
//  other split pass (be view/theme.js:126 inPale/rmPale).
const WASH_IN_PALE_SGR = "48;5;194", WASH_RM_PALE_SGR = "48;5;224";

//  --- the BUTTON palette (BEE-035, be view/theme.js:141) ------------------
//  A clickable button is TWO CELLS carrying its tone as FOREGROUND over a VERY
//  PALE wash of that same tone — never an inversion.  Both colours are
//  TRUECOLOR and ride the button's own hidden `O` (BEE-034), so a button needs
//  no tok tag of its own; a DISABLED one is plain grey, no wash.  The tones are
//  the SAME in every palette, like the `Sev:` quartet above.
const BTN = {
  status: "#0085ca",   // Pantone Process Blue  — `status`, face " i"
  log:    "#ffd02e",   // Pantone Dandelion     — `log`,    face " ≡"
  commit: "#00a95c",   // Hexachrome Green      — `commit`, face " ✓"
  //  The COUNT buttons: position says which slot, colour says which KIND of
  //  change (be's blue/green/red triad, then the ahead/behind pair).
  chg:    "#3647c9",   // blue   — changed
  add:    "#47c936",   // green  — new
  del:    "#c7384d",   // red    — deleted
  push:   "#1fe084",   // green  — ahead
  pull:   "#ef8310",   // orange — behind
  merge:  "#8420df",   // violet — diverged, the one act that joins two lines
  go:     "#ff6d2b",   // Shocking Orange — the one CREATE act on a board
  done:   "#3bc43d",   // green — ` ✓` closes
  dont:   "#c2803d",   // ochre — ` ✗` shelves
};
//  The wash is DERIVED, never hand-picked: mix the tone toward white by
//  BTN_PALE, once, for every button in every view — retune the factor here and
//  every wash moves with it, so a new tone can never ship without one.
//  Memoized: a board asks per button per row.
const BTN_PALE = 0.88;
const PALE_MEMO = Object.create(null);
function pale(hex) {
  const key = String(hex);
  if (PALE_MEMO[key] !== undefined) return PALE_MEMO[key];
  const v = parseInt(key.slice(1), 16);
  let out = "#";
  for (let sh = 16; sh >= 0; sh -= 8) {
    const c = (v >> sh) & 0xff;
    out += Math.round(c + (255 - c) * BTN_PALE).toString(16).padStart(2, "0");
  }
  return (PALE_MEMO[key] = out);
}

//  The FALLBACK tok tag per button — the nearest slot of the palettes above.
//  A face is emitted on this tag and its `O` OVERRIDES it with the truecolor
//  pair, so a reader that never gets the O still shows the button in its class
//  colour; it may never degrade to grey (D/P/Q), which is the DISABLED signal.
const BTN_TAG = { status: "I", log: "E", commit: "G", chg: "I", add: "W",
                  del: "M", push: "G", pull: "V", merge: "H", go: "V",
                  done: "W", dont: "X" };

//  The button FACES — a face is exactly two cells: a space plus an icon, or a
//  two-digit count.  Faces are THEME data like the tones, never view-local
//  literals, so one place answers what a button looks like.
const BTN_FACE = { status: " i", log: " ≡", commit: " ✓", go: "go",
                   done: " ✓", dont: " ✗" };
//  A COUNT face is two cells too: the class SIGIL plus the digit under ten
//  (`~3`, `+2`, `-9`), the bare digits from ten up, clamped at 99.  The sigil
//  is what keeps a single-digit count from reading as a bare number.
const BTN_SIGIL = { chg: "~", add: "+", del: "-", push: "^", pull: "v" };
function countFace(sigil, n) {
  const v = n < 99 ? n : 99;
  return v < 10 ? sigil + v : String(v);
}

//  --- a theme object ------------------------------------------------------
//  paint(slotLetter)  → ESC[<sgr>m for that slot, or "" (default/no paint).
//  reset(slotLetter)  → the closing SGR: ESC[22m for a bold-only slot (N/C —
//                       the on-code was the bold flag), else ESC[39m (default
//                       fg), "" when the cell wasn't painted.  Mirrors
//                       ANSIu8sFeedDelta spelling the slot→DEFAULT delta.
//  bannerOpen()/bannerClose() → the header band wrap.
//  loadOpen()/loadClose()     → the LOADING address bar — the SAME band (black
//                       on pale yellow), aliased, never a new pair.
function makeTheme(name, slots) {
  function bannerOpen() { return ESC + BANNER_SGR + "m"; }
  function bannerClose() { return ESC + "0m"; }
  function sgr(letter) {
    const s = slots[letter];
    return s ? ESC + s + "m" : "";
  }
  function paint(letter) { return sgr(letter); }
  function reset(letter) {
    const s = slots[letter];
    if (!s) return "";                       // not painted → no reset
    //  bold-only slot (no colour digits, just "1") resets with 22.
    return s === "1" ? ESC + "22m" : ESC + "39m";
  }
  return {
    name: name,
    slots: slots,
    //  LITE-034: the band and the wash as RAW SGR PARAMETERS — what a non-ANSI
    //  sink (the HTML painter) needs, next to the ESC-wrapped spellings below.
    banner: BANNER_SGR,
    washIn: WASH_IN_SGR,
    washRm: WASH_RM_SGR,
    washInPale: WASH_IN_PALE_SGR,
    washRmPale: WASH_RM_PALE_SGR,
    paint: paint,
    reset: reset,
    bannerOpen: bannerOpen,
    bannerClose: bannerClose,
    loadOpen: bannerOpen,
    loadClose: bannerClose,
  };
}

const THEME16 = makeTheme("16", SLOTS_16);
const THEMEDARK = makeTheme("dark", SLOTS_DARK);
const THEMELIGHT = makeTheme("light", SLOTS_LIGHT);

//  Named themes + a default.  PLUGGABLE: swap `DEFAULT` or pass a chosen
//  theme into the renderer to repaint without touching the render code.
const THEMES = { "16": THEME16, dark: THEMEDARK, light: THEMELIGHT };

//  Pick by name (env $BRO_THEME, else "16") — mirrors THEMESelect's fallback.
function select(name) {
  if (!name) name = (typeof io !== "undefined" && io.getenv && io.getenv("BRO_THEME")) || "16";
  return THEMES[name] || THEME16;
}

module.exports = {
  THEMES: THEMES,
  DEFAULT: THEME16,
  THEME16: THEME16,
  THEMEDARK: THEMEDARK,
  THEMELIGHT: THEMELIGHT,
  //  BEE-035: the button look — tones, the ONE wash derivation, the fallback
  //  tags and the 2-cell faces.  Palette-independent, hence not on a theme.
  BTN: BTN, BTN_PALE: BTN_PALE, pale: pale,
  BTN_TAG: BTN_TAG, BTN_FACE: BTN_FACE, BTN_SIGIL: BTN_SIGIL,
  countFace: countFace,
  select: select,
  makeTheme: makeTheme,
};
