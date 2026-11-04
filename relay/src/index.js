/* Banana Detailing — confirm relay.

   The CRM is a static page with no backend, so a client tapping "Confirm" on the hosted
   confirmation page has no way to tell the app. This worker is the one hop in between:

     POST /confirm                           open; the public confirm page posts here
     GET  /confirms?since=<ms>&k=<READ_KEY>  the CRM polls this once a minute

   A confirmation also emails the owner, from here rather than from the client's phone,
   so the sending key stays server-side and the send does not depend on the client
   keeping the page open.

   Records expire after 30 days. This is a relay, not a database — the CRM remains the
   system of record, and losing this worker loses nothing but the automatic tick and
   the email. */

const cors = {
  "Access-Control-Allow-Origin": "https://reflex08.github.io",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const text = (s, status = 200) => new Response(s, { status, headers: cors });
const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* The owner's copy. Brevo's free tier needs one verified sender address and will then send
   to anyone, so SENDER_EMAIL is the address that was verified and NOTIFY_TO is the owner.
   Both are config, never request data: this endpoint is public, and a recipient read off
   the body would turn the worker into an open relay for whoever found the URL. */
async function notify(env, det) {
  const to = String(env.NOTIFY_TO || "").trim();
  const from = String(env.SENDER_EMAIL || "").trim();
  if (!to || !from || !env.BREVO_KEY) return "not-configured";

  // Public endpoint, so the day's volume is capped: a flood can neither empty the sending
  // quota nor bury the owner's inbox. The counter is a KV key that ages out on its own.
  const day = "n:" + new Date().toISOString().slice(0, 10);
  const used = +(await env.CONF.get(day)) || 0;
  if (used >= 60) return "capped";
  await env.CONF.put(day, String(used + 1), { expirationTtl: 60 * 60 * 48 });

  const row = (k, v) => v
    ? '<tr><td style="padding:6px 14px 6px 0;color:#6b665e">' + esc(k) +
      '</td><td style="padding:6px 0;font-weight:600">' + esc(v) + "</td></tr>"
    : "";
  const html =
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;color:#231f1a">' +
    "<p><b>" + esc(det.name || "A client") + "</b> confirmed the appointment and accepted the terms.</p>" +
    '<table style="border-collapse:collapse;font-size:14px">' +
    row("Client", det.name) + row("Service", det.service) + row("When", det.when) +
    row("Where", det.address) + row("Price", det.price) +
    row("Agreed at", new Date().toUTCString()) +
    "</table>" +
    '<p style="color:#6b665e;font-size:13px">Terms shown at the time: ' +
    esc(det.terms || "the service terms on the confirmation page") + "</p></div>";

  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": env.BREVO_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { email: from, name: String(env.BIZ_NAME || "Confirmations").slice(0, 60) },
      to: [{ email: to }],
      subject: "CONFIRMED \u2014 " + (det.name || "Client") +
               (det.service ? " (" + det.service + ")" : ""),
      htmlContent: html,
    }),
  });
  return r.ok ? "sent" : "failed-" + r.status;
}

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

      // Only the tick is stored. The readable detail is used for the owner's email and
      // then dropped, so the relay keeps holding as little client data as it ever did.
      let mail = "not-configured";
      try {
        mail = await notify(env, {
          name: rec.name, service: clip(b.service, 80), when: clip(b.when, 60),
          address: clip(b.address, 120), price: clip(b.price, 20),
          terms: clip(b.terms, 1200),
        });
      } catch (e) { mail = "error"; }

      // The client is told only whether the confirmation landed. Whether the owner's email
      // went out is the owner's problem -- the CRM tick already covers him.
      return json({ ok: true, mail });
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
