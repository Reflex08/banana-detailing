/* Banana Detailing — confirm relay.

   The CRM is a static page with no backend, so a client tapping "Confirm" on the hosted
   confirmation page has no way to tell the app. This worker is the one hop in between:

     POST /confirm                           open; the public confirm page posts here
     GET  /confirms?since=<ms>&k=<READ_KEY>  the CRM polls this once a minute

   Records expire after 30 days. This is a relay, not a database — the CRM remains the
   system of record, and losing this worker loses nothing but the automatic tick. */

const cors = {
  "Access-Control-Allow-Origin": "https://reflex08.github.io",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const text = (s, status = 200) => new Response(s, { status, headers: cors });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    // Open on purpose: the poster is a client's phone, which can hold no secret. The worst a
    // stranger can do is file a confirmation for a job id that may not exist. Ids are capped
    // and records expire, so there is nothing here worth stealing and nowhere for it to grow.
    if (req.method === "POST" && url.pathname === "/confirm") {
      let b;
      try { b = await req.json(); } catch { return text("bad json", 400); }
      const ids = (Array.isArray(b.jobIds) ? b.jobIds : [])
        .map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 20);
      if (!ids.length) return text("no job ids", 400);
      const rec = { jobIds: ids, cid: +b.cid || 0, name: clip(b.name, 60), t: Date.now() };
      const key = "c:" + String(rec.t).padStart(15, "0") + ":" + Math.random().toString(36).slice(2, 8);
      await env.CONF.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 30 });
      return text("ok");
    }

    if (req.method === "GET" && url.pathname === "/confirms") {
      if (url.searchParams.get("k") !== env.READ_KEY) return text("forbidden", 403);
      const since = +url.searchParams.get("since") || 0;
      const list = await env.CONF.list({ prefix: "c:" });
      const out = [];
      for (const k of list.keys) {
        // the timestamp is in the key, so stale records are skipped without reading them
        if ((+k.name.split(":")[1] || 0) <= since) continue;
        const v = await env.CONF.get(k.name);
        if (v) out.push(JSON.parse(v));
      }
      out.sort((a, b) => a.t - b.t);
      return json(out);
    }

    return text("Banana Detailing relay");
  },
};
