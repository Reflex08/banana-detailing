/* Drives confirm.html's click handler in a stubbed DOM so the four delivery outcomes are
   checked for real, not read off the source. */
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let pass = 0, fail = 0;
const ok = (what, cond, extra) => {
  if (cond) { pass++; } else { fail++; console.log("  FAIL " + what + (extra ? "  <" + extra + ">" : "")); }
};

// the payload a real link carries
const payload = (over = {}) => Object.assign({
  b: "Banana Detailing", ph: "+15550101", n: "Marcus", s: "Full Detail",
  dt: "2026-11-10", t: "09:00", p: 150, a: "12 Elm St", e: "owner@example.com",
  f: 20, j: [1], c: 1, r: "https://relay.example.workers.dev",
}, over);

const b64url = o =>
  Buffer.from(JSON.stringify(o), "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/* The smallest DOM the page actually touches. innerHTML is kept as a string -- the page
   never reads structure back out of it, only writes and looks up two fixed ids. */
function makeDom() {
  const nodes = {};
  const mk = id => (nodes[id] = {
    id, innerHTML: "", textContent: "", style: {}, disabled: false,
    checked: false, onclick: null, onchange: null, onerror: null,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
                 toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
                 contains(c) { return this._s.has(c); } },
  });
  ["app", "cta", "warn", "chk", "rev", "go", "terms", "logo", "wm"].forEach(mk);
  return {
    nodes,
    document: {
      getElementById: id => nodes[id] || null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };
}

async function run(fork, fetchImpl, over) {
  const html = fs.readFileSync(path.join(ROOT, "confirm.html"), "utf8");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join("\n");
  const dom = makeDom();
  const calls = [], bodies = [];
  const sandbox = {
    document: dom.document,
    location: { search: "?d=" + b64url(payload(over)), href: "" },
    navigator: { userAgent: "node", clipboard: null },
    setTimeout, clearTimeout, console, Promise, JSON, Date, Math, encodeURIComponent,
    decodeURIComponent, escape, unescape, atob: s => Buffer.from(s, "base64").toString("binary"),
    Intl, AbortController, URLSearchParams, URL, RegExp, String, Number, Array, Object, Error,
    fetch: (url, opts) => {
      calls.push(url);
      try { if (opts && opts.body) bodies.push(JSON.parse(opts.body)); } catch (e) {}
      return fetchImpl(url, opts);
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox);

  // the page renders on load; tick the box and press the button
  dom.nodes.chk.checked = true;
  if (dom.nodes.chk.onchange) dom.nodes.chk.onchange();
  await dom.nodes.go.onclick();
  // let the promise chain settle
  for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r));
  return { warn: dom.nodes.warn.innerHTML, cta: dom.nodes.cta.innerHTML, calls,
           body: bodies[0] || null };
}

const res = (status, body, ct) => Promise.resolve({
  ok: status >= 200 && status < 300,
  json: () => (ct === "json" ? Promise.resolve(body) : Promise.reject(new Error("not json"))),
});

(async () => {
  for (const fork of ["confirm.html"]) {

    // 1. the relay takes it and reports back as JSON
    let r = await run(fork, () => res(200, { ok: true, mail: "sent" }, "json"));
    ok("relay accepted -> no warning", r.warn === "", r.warn);
    ok("only the relay is contacted now", r.calls.length === 1 && !r.calls.join(",").includes("formsubmit"),
       r.calls.join(","));
    ok("the detail the email needs goes with it",
       ["service","when","address","price","terms"].every(k => r.body && k in r.body),
       JSON.stringify(r.body));
    ok("the client's record is not padded with the business line", !(r.body && "phone" in r.body),
       JSON.stringify(r.body));

    // 2. an older relay that answers in plain text still counts as a yes
    r = await run(fork, () => res(200, null, "text"));
    ok("plain-text relay reply -> no warning", r.warn === "", r.warn);

    // 3. relay unreachable
    r = await run(fork, () => Promise.reject(new Error("dns")));
    ok("relay down -> client is warned", /could not reach the office/.test(r.warn), r.warn);
    ok("the warning carries the phone number", /tel:15550101/.test(r.warn), r.warn);

    // 4. relay up but refusing the record
    r = await run(fork, () => res(500, null));
    ok("relay error -> client is warned", /could not reach the office/.test(r.warn), r.warn);

    // 5. no relay configured
    r = await run(fork, () => { throw new Error("should not be called"); }, { r: "", e: "" });
    ok("no channels configured -> client is warned", /could not reach the office/.test(r.warn), r.warn);
    ok("no request is made when nothing is configured", r.calls.length === 0, r.calls.join(","));

    // the success panel is unchanged in every case
    ok("panel still just the tick and the headline", /Confirmed/.test(r.cta) && !/sms:/.test(r.cta), r.cta);
  }
  console.log("\n" + (fail ? "FAIL " + fail + " of " + (pass + fail) : "ok  all " + pass + " behaviour checks pass"));
  process.exit(fail ? 1 : 0);
})();
