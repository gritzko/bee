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
};

const SLOTS_DARK = {
  D: "38;5;240", G: "38;5;37", L: "38;5;33", H: "38;5;166", R: "38;5;64",
  P: "38;5;240", N: "38;5;33;1", C: "38;5;33;1", F: "38;5;61", T: "38;5;61",
  W: "32", E: "33", X: "38;5;94", Q: "38;5;240",
};

const SLOTS_LIGHT = {
  D: "38;5;245", G: "38;5;37", L: "38;5;33", H: "38;5;166", R: "38;5;64",
  P: "38;5;245", N: "38;5;33;1", C: "38;5;33;1", F: "38;5;61", T: "38;5;61",
  W: "32", E: "33", X: "38;5;94", Q: "38;5;245",
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
  select: select,
  makeTheme: makeTheme,
};
