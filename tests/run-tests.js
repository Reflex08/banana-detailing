/* Banana Detailing CRM — test gate.
 *
 *   node tests/run-tests.js            (from the repo root)
 *
 * The app is one HTML file whose script expects a browser, so the gate pulls the script
 * out, stubs the handful of globals it touches at load time, and then exercises the real
 * functions. No framework, no dependencies — same house style as the Flyra gate.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) { pass++; return; }
  fails.push(name + (detail ? "  — " + detail : ""));
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     "got " + JSON.stringify(got) + ", wanted " + JSON.stringify(want));
}

/* ---------- load the app ---------- */
const script = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"));

/* Top-level `const`/`let` never become properties of a vm global the way `function` and
   `var` do, and the module's own `db` binding is likewise unreachable from outside. This
   snippet runs in the same scope and hands both out. */
const shim = script + `
;globalThis.__k = {DEFAULT_SERVICES,DEFAULT_TEMPLATES,DEFAULT_SETTINGS,QA_SERVICES,GOAL,KEY,OLDKEY,RELAY};
;globalThis.__setDb = v => { db = v; };
`;

// Minimal DOM: every lookup returns an inert node, so render paths run without throwing.
const node = new Proxy({}, {
  get(t, k) {
    if (k === "style" || k === "dataset" || k === "classList") return node;
    if (k === "value" || k === "textContent" || k === "innerHTML") return "";
    if (k === "files") return [];
    if (Symbol.toPrimitive === k || k === "toString") return () => "";
    return typeof k === "string" ? () => node : undefined;
  },
  set() { return true; },
});
const store = new Map();
const sandbox = {
  console,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
  document: {
    querySelector: () => node,
    querySelectorAll: () => [],
    getElementById: () => node,
    addEventListener() {},
    createElement: () => node,
    documentElement: node,
    body: node,
    hidden: false,
  },
  navigator: { standalone: false },
  indexedDB: null,
  fetch: () => Promise.reject(new Error("no network in the gate")),
  setTimeout: () => 0,
  setInterval: () => 0,
  clearTimeout() {},
  btoa: s => Buffer.from(s, "binary").toString("base64"),
  atob: s => Buffer.from(s, "base64").toString("binary"),
  location: { href: "", search: "" },
  URL,
  Blob: function () {},
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addListener() {}, addEventListener() {} }),
  devicePixelRatio: 1,
  confirm: () => true,
  alert() {},
  prompt: () => "",
  crypto: { getRandomValues: a => a },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
try {
  vm.createContext(sandbox);
  vm.runInContext(shim, sandbox, { timeout: 15000 });
} catch (e) {
  console.error("FATAL: the app script threw on load —", e.message);
  process.exit(1);
}
const A = sandbox;
const K = sandbox.__k;

/* ---------- dates ---------- */
eq("weekDates returns 7 consecutive days", A.weekDates("2026-10-18"),
   ["2026-10-18","2026-10-19","2026-10-20","2026-10-21","2026-10-22","2026-10-23","2026-10-24"]);
eq("weekDates rolls across a month end", A.weekDates("2026-10-29")[6], "2026-11-04");
eq("weekDates starts at the given day, not Sunday", A.weekDates("2026-10-21")[0], "2026-10-21");
eq("localISO is local, not UTC", A.localISO(new Date(2026, 0, 1, 23, 30)), "2026-01-01");

/* ---------- money ---------- */
eq("jobBalance ignores jobs that aren't done",
   A.jobBalance({ status: "scheduled", price: 250, collected: 0 }), 0);
eq("jobBalance is price minus collected once done",
   A.jobBalance({ status: "completed", price: 250, collected: 100 }), 150);
eq("jobBalance never goes negative",
   A.jobBalance({ status: "completed", price: 100, collected: 250 }), 0);
eq("payState partial", A.payState({ price: 250, collected: 100 }), "partial");
eq("payState paid", A.payState({ price: 250, collected: 250 }), "paid");

/* ---------- the detailing service catalogue ---------- */
const svcNames = K.DEFAULT_SERVICES.map(s => s.name);
ok("services are detailing, not window cleaning",
   svcNames.includes("Full Detail (In & Out)") && !svcNames.some(n => /window|gutter/i.test(n)),
   svcNames.join(", "));
ok("every service has a price", K.DEFAULT_SERVICES.every(s => +s.price > 0));
eq("monthly goal is $5,000", K.GOAL, 5000);

/* ---------- quick add ----------
   These are the regressions worth pinning: "interior"/"exterior" used to be eaten as notes
   before the service matcher saw them, and "washed" collided with Express Wash & Wax. */
const qa = line => A.quickParseLine(line);
eq("quick add: interior resolves to Interior Detail",
   qa("Dana tomorrow at 2 for 150 interior").items[0].service, "Interior Detail");
eq("quick add: exterior resolves to Exterior Detail",
   qa("Dana tomorrow at 2 for 140 exterior").items[0].service, "Exterior Detail");
eq("quick add: 'full detail' beats the bare 'detail' catch-all",
   qa("Marcus friday 250 full detail").items[0].service, "Full Detail (In & Out)");
eq("quick add: wash maps to Express Wash & Wax",
   qa("Tyler monday 60 wash").items[0].service, "Express Wash & Wax");
eq("quick add: ceramic maps to Ceramic Coating",
   qa("Dana 650 ceramic").items[0].service, "Ceramic Coating");
eq("quick add: price is picked up", qa("Marcus friday 250 full detail").items[0].price, 250);
ok("quick add: a bare name with no price stays a lead", !qa("Marcus 416 555 0100").job);
ok("quick add: an empty line parses to nothing", qa("   ") === null);

/* ---------- seed + sample wipe ---------- */
const seeded = A.seed();
ok("seed ships sample customers", seeded.customers.length > 0);
ok("every seeded record is tagged sample",
   seeded.customers.every(c => c.sample) && seeded.jobs.every(j => j.sample));
ok("seed marks itself so a wipe is permanent", seeded.seeded === true);
ok("seeded jobs point at seeded customers",
   seeded.jobs.every(j => seeded.customers.some(c => c.id === j.customerId)));
ok("seeded jobs carry a vehicle", seeded.jobs.every(j => typeof j.vehicle === "string" && j.vehicle));

/* ---------- confirm link ---------- */
A.__setDb(A.normalize({
  customers: [{ id: 1, name: "Marcus Webb", phone: "+15550102", street: "41 Granger Ave", log: [] }],
  jobs: [{ id: 7, customerId: 1, service: "Full Detail (In & Out)", vehicle: "2021 Audi A4",
           price: 250, date: "2026-10-22", time: "13:00", status: "scheduled" }],
  settings: K.DEFAULT_SETTINGS(), seqC: 2, seqJ: 8,
}));
const link = A.confirmLink(7);
ok("confirmLink builds without a business phone", !!link, String(link));
ok("confirmLink points at the hosted confirm page",
   link.indexOf("/banana-detailing/confirm.html?d=") > 0, link);
const payload = JSON.parse(Buffer.from(
  link.split("?d=")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
eq("payload carries the job id so the tick can come back", payload.j, [7]);
eq("payload carries the vehicle", payload.v, "2021 Audi A4");
eq("payload carries the price", payload.p, 250);
eq("payload carries the notify address", payload.e, "koncurigor2008@gmail.com");
ok("payload stays short enough for any SMS app", link.length < 500, link.length + " chars");

/* ---------- vehicle memory ---------- */
eq("new job prefills the vehicle from the customer's last job", A.lastVehicle(1), "2021 Audi A4");
eq("unknown customer prefills nothing", A.lastVehicle(999), "");
eq("no customer prefills nothing", A.lastVehicle(null), "");

/* ---------- storage namespace ---------- */
ok("storage namespace is banana, never servicepro",
   K.KEY.startsWith("banana.") && !script.includes("servicepro"), K.KEY);
ok("no legacy key is adopted", K.OLDKEY === "");

/* ---------- things that should no longer exist ---------- */
for (const [name, token] of [
  ["the AI quick add is gone", "AI_KEY"],
  ["the Anthropic call is gone", "api.anthropic.com"],
  ["the quote sheet is gone", "openQuote"],
  ["the signature pad is gone", "signPad"],
  ["the commissions leaderboard is gone", "leaderboardPanel"],
  ["the baked contact import is gone", "CONTACTS_IMPORT"],
  ["the day timeline is gone", "renderDayTimeline"],
  ["the schedule view switcher is gone", "schedView"],
]) ok(name, !script.includes(token));
ok("no real phone numbers are baked into the app",
   !/\+1(?!555)\d{10}/.test(script));

/* ---------- report ---------- */
const total = pass + fails.length;
if (fails.length) {
  console.log("\n" + fails.length + " of " + total + " checks FAILED:\n");
  fails.forEach(f => console.log("  ✗ " + f));
  process.exit(1);
}
console.log("\n✓ all " + total + " checks pass\n");
