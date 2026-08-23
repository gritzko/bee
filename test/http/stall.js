//  bee/test/http/stall.js — CODE-036: the request ASSEMBLY deadline.
//  A trickle client opens a POST, promises a body it never delivers and
//  dribbles a byte at a time so no idle timer would ever see it as stalled.
//  The server must refuse it in words and drop the connection itself; an
//  unfixed server parks that fd for as long as the client cares to wait, so
//  this leg's own hard stop is what ends the run.
//
//  $BEE_PORT is the loopback port test/http/run.sh already has a server on.
"use strict";
const PORT = Number(io.getenv("BEE_PORT") || "18034");
const GRACE = 15000;             // the client's hard stop: past this, it parked

let n = 0, bad = 0;
function w1(s) { const b = utf8.Encode(s); const x = io.buf(b.length + 8); x.feed(b); io.writeAll(1, x); }
function check(name, cond, got) {
  n++;
  if (cond) { w1("ok   " + name + "\n"); return; }
  bad++;
  w1("FAIL " + name + "\n");
  if (got !== undefined) w1("     got: " + String(got) + "\n");
}

const t0 = pol.now();
function ms() { return Math.round((pol.now() - t0) / 1e6); }

let got = "", parked = false, iv = 0, hard = 0, spoke = false;
const c = net.connect(PORT, "127.0.0.1", function () {
  //  A well-formed POST head promising 64 body bytes — one arrives now, the
  //  rest never do.
  c.write("POST /repo/act HTTP/1.1\r\nHost: 127.0.0.1:" + PORT + "\r\n" +
          "Content-Type: application/x-www-form-urlencoded\r\n" +
          "Content-Length: 64\r\n\r\na");
  iv = setInterval(function () { if (!spoke) c.write("b"); }, 1000);
});
c.on("error", function () { });
c.on("data", function (chunk) { spoke = true; got += utf8.Decode(chunk); });
c.on("close", function () {
  clearInterval(iv); clearTimeout(hard);
  check("the trickle POST is dropped by the server", !parked,
        "still connected after " + ms() + " ms");
  if (!parked) {
    check("it is refused in words: 408 Request Timeout", got.indexOf("408") >= 0,
          got.slice(0, 120));
    check("and only after a real wait, not on connect", ms() >= 500, ms() + " ms");
  }
  w1((bad ? "FAILED " : "DONE ") + n + " checks, the socket went at " + ms() + " ms\n");
});
hard = setTimeout(function () {
  parked = true; clearInterval(iv);
  c.destroy();                   // 'close' reports the failure
}, GRACE);
