#!/bin/sh
#  LITE-030: regenerate mark/*.js from a commonmark.js checkout — the parse
#  half only, ESM->CJS, specifiers rooted at the require base, npm deps stubbed.
#
#   sh mark/vendor.sh [/path/to/commonmark.js]      (default ~/src/commonmark.js)
#
#  The five vendored files stay BYTE-FAITHFUL to upstream apart from the
#  mechanical rewrites below, so drift stays reviewable against a checkout:
#
#   1. `import X from "./y.js"` -> `var X = require("mark/y.js")`.  lite's
#      runtime builds a module with new Function("module","exports","require"),
#      so `import`/`export` will not parse; and a bareword specifier resolves
#      against THE ONE require base (quickjab/require.c, QJAB-002), never
#      against the importing file — hence "mark/y.js", never "./y.js".
#   2. `export default X` -> `module.exports = X`; `export {..}` -> `module.exports = {..}`.
#   3. mdurl/encode.js: dropped.  normalizeURI becomes the identity — it
#      percent-encodes link destinations inside the PARSE path, and our emitter
#      must re-emit the source URL bytes, not a rewritten form.
#   4. entities.decodeHTMLStrict: replaced by an INTERIM stub in common.js
#      (numeric refs in full + a short named table, every other &name; left
#      verbatim), re-exported from common.js so inlines.js takes it from there.
#      The full table is ~2100 entries of binary bloat; ruling still owed.
#   5. minimist: not vendored at all, it went with bin/.
#
#  render/, bin/, dingus/, bench/ and test/spec.txt are out of scope.
set -eu

SRC=${1:-$HOME/src/commonmark.js}
DST=$(cd "$(dirname "$0")" && pwd)
VER=0.31.2

[ -f "$SRC/lib/blocks.js" ] || {
    echo "vendor: no commonmark.js lib/ under '$SRC'" >&2; exit 2; }
grep -q "\"version\": \"$VER\"" "$SRC/package.json" || {
    echo "vendor: '$SRC' is not v$VER — check the rewrites below still apply" >&2; }

mkdir -p "$HOME/tmp"
TMP=$(mktemp -d "$HOME/tmp/mark-vendor.XXXXXX") || exit 2
trap 'rm -rf "$TMP"' EXIT

#  The one hand-written chunk: the entities stub, spliced into common.js where
#  its `import ... from "entities"` was.
cat > "$TMP/entities.js" <<'STUB'
//  LITE-030: entities.decodeHTMLStrict, an INTERIM stub — numeric references
//  in full, a short named table, every other `&name;` left verbatim as-is.
var fromCodePoint = require("mark/from-code-point.js");

var NAMED = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    nbsp: " ", ensp: " ", emsp: " ", thinsp: " ",
    shy: "­", ndash: "–", mdash: "—", hellip: "…",
    lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
    laquo: "«", raquo: "»", bull: "•", middot: "·",
    dagger: "†", Dagger: "‡", permil: "‰", sect: "§",
    para: "¶", copy: "©", reg: "®", trade: "™",
    deg: "°", plusmn: "±", times: "×", divide: "÷",
    minus: "−", ne: "≠", le: "≤", ge: "≥",
    frac12: "½", frac14: "¼", frac34: "¾",
    micro: "µ", sup2: "²", sup3: "³",
    cent: "¢", pound: "£", yen: "¥", euro: "€",
    curren: "¤", iexcl: "¡", iquest: "¿", not: "¬",
    larr: "←", uarr: "↑", rarr: "→", darr: "↓",
    harr: "↔", infin: "∞", ll: "≪", gg: "≫",
    alpha: "α", beta: "β", gamma: "γ", delta: "δ",
    lambda: "λ", mu: "μ", pi: "π", sigma: "σ",
    omega: "ω", Omega: "Ω", Delta: "Δ", Sigma: "Σ",
    agrave: "à", aacute: "á", acirc: "â", atilde: "ã",
    auml: "ä", aring: "å", aelig: "æ", AElig: "Æ",
    ccedil: "ç", egrave: "è", eacute: "é", ecirc: "ê",
    euml: "ë", igrave: "ì", iacute: "í", ntilde: "ñ",
    ograve: "ò", oacute: "ó", ouml: "ö", oslash: "ø",
    ugrave: "ù", uacute: "ú", uuml: "ü", szlig: "ß",
    Eacute: "É", Ouml: "Ö", Auml: "Ä", Uuml: "Ü"
};

var decodeHTMLStrict = function(s) {
    if (s.charCodeAt(0) !== 38 || s.charCodeAt(s.length - 1) !== 59) {
        return s;
    }
    var body = s.slice(1, -1);
    if (body.charCodeAt(0) === 35) {
        var hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88;
        var cp = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!(cp > 0) || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
            cp = 0xfffd;
        }
        return fromCodePoint(cp);
    }
    if (Object.prototype.hasOwnProperty.call(NAMED, body)) {
        return NAMED[body];
    }
    return s;
};
STUB

#  ---- node.js: one export, nothing else -----------------------------------
sed 's|^export default Node;$|module.exports = Node;|' \
    "$SRC/lib/node.js" > "$DST/node.js"

#  ---- from-code-point.js: the default export becomes a plain function ------
sed 's|^export default function fromCodePoint(_) {$|function fromCodePoint(_) {|' \
    "$SRC/lib/from-code-point.js" > "$DST/from-code-point.js"
printf '\nmodule.exports = fromCodePoint;\n' >> "$DST/from-code-point.js"

#  ---- common.js: both deps die here, and the stub is re-exported ----------
awk -v stub="$TMP/entities.js" '
    $0 == "import encode from \"mdurl/encode.js\";" { next }
    $0 == "import { decodeHTMLStrict } from \"entities\";" {
        while ((getline line < stub) > 0) print line
        next
    }
    $0 == "var normalizeURI = function(uri) {" { skip = 1 }
    skip && $0 == "};" {
        skip = 0
        print "//  LITE-030: mdurl dropped — normalizeURI is the identity, so a link"
        print "//  destination keeps its source bytes for the emitter to re-emit."
        print "var normalizeURI = function(uri) {"
        print "    return uri;"
        print "};"
        next
    }
    skip { next }
    $0 == "export {" { print "module.exports = {"; print "    decodeHTMLStrict,"; next }
    { print }
' "$SRC/lib/common.js" > "$DST/common.js"

#  ---- blocks.js -----------------------------------------------------------
sed \
 -e 's|^import Node from "./node.js";$|var Node = require("mark/node.js");|' \
 -e 's|^import { unescapeString, OPENTAG, CLOSETAG } from "./common.js";$|var { unescapeString, OPENTAG, CLOSETAG } = require("mark/common.js");|' \
 -e 's|^import InlineParser from "./inlines.js";$|var InlineParser = require("mark/inlines.js");|' \
 -e 's|^export default Parser;$|module.exports = Parser;|' \
    "$SRC/lib/blocks.js" > "$DST/blocks.js"

#  ---- inlines.js ----------------------------------------------------------
sed \
 -e 's|^import Node from "./node.js";$|var Node = require("mark/node.js");|' \
 -e 's|^import \* as common from "./common.js";$|var common = require("mark/common.js");|' \
 -e 's|^import fromCodePoint from "./from-code-point.js";$|var fromCodePoint = require("mark/from-code-point.js");|' \
 -e 's|^import { decodeHTMLStrict } from "entities";$|var decodeHTMLStrict = common.decodeHTMLStrict;|' \
 -e 's|^export default InlineParser;$|module.exports = InlineParser;|' \
    "$SRC/lib/inlines.js" > "$DST/inlines.js"

#  Nothing may survive of the ESM syntax or of the three npm names.
for f in node from-code-point common blocks inlines; do
    if grep -nE '^(import|export)[ {]|"mdurl|"entities"|minimist' "$DST/$f.js"; then
        echo "vendor: $f.js still carries ESM syntax or an npm dep (above)" >&2
        exit 1
    fi
    if grep -n 'require("\./' "$DST/$f.js"; then
        echo "vendor: $f.js has a file-relative specifier (above)" >&2
        exit 1
    fi
done

wc -l "$DST/node.js" "$DST/common.js" "$DST/from-code-point.js" \
      "$DST/inlines.js" "$DST/blocks.js"
echo "vendor: commonmark.js v$VER parse half -> $DST"
