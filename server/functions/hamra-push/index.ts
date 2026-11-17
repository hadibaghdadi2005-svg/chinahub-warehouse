/* Phone notifications for Hamra clients.
 *
 * Two ways in:
 *  - No body (called every 30 seconds by pg_cron while alerts are queued):
 *    claims every unsent row in hamra_alerts, and sends ONE notification
 *    summing them up to every phone that turned notifications on.
 *  - {"test": true} with the caller's own sign-in token: sends a test
 *    notification to that person's own phones only.
 *
 * Nothing in a request decides who is told or what it says: the text comes
 * from the database, so calling this from outside can only flush the queue.
 */
import webpush from "npm:web-push@3.6.7";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

type Sub = { endpoint: string; p256dh: string; auth: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } });

  const { data: keys, error: kerr } = await sb.from("app_secrets").select("name,value")
    .in("name", ["vapid_public", "vapid_private", "vapid_subject"]);
  if (kerr) return json({ error: kerr.message }, 500);
  const k = Object.fromEntries((keys || []).map((r) => [r.name, r.value]));
  webpush.setVapidDetails(k.vapid_subject, k.vapid_public, k.vapid_private);

  let body: { test?: boolean } = {};
  try { body = await req.json(); } catch (_) { /* cron sends {} */ }

  let subs: Sub[] = [];
  let payload: Record<string, string>;
  let claimed = 0;

  if (body.test) {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(token);
    if (!u?.user) return json({ error: "Sign in first" }, 401);
    const { data } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth").eq("user_id", u.user.id);
    subs = data || [];
    payload = { title: "Hamra notifications are on", body: "This phone will be told when a Hamra client's parcel arrives.", tag: "hamra-test", url: "./?tab=hamra" };
  } else {
    const { data: rows, error } = await sb.from("hamra_alerts")
      .update({ sent_at: new Date().toISOString() }).is("sent_at", null)
      .select("barcode,client_id,customer");
    if (error) return json({ error: error.message }, 500);
    if (!rows || !rows.length) return json({ sent: 0, alerts: 0 });
    claimed = rows.length;
    const by = new Map<string, { name: string; n: number }>();
    for (const r of rows) {
      const key = r.client_id || r.barcode;
      const c = by.get(key) || { name: (r.customer || r.client_id || "A client").trim(), n: 0 };
      c.n++; by.set(key, c);
    }
    const names = [...by.values()].sort((a, b) => b.n - a.n).map((c) => c.name + (c.n > 1 ? " (" + c.n + ")" : ""));
    const shown = names.slice(0, 4).join(", ") + (names.length > 4 ? " and " + (names.length - 4) + " more" : "");
    payload = {
      title: claimed === 1 ? "Parcel for a Hamra client" : claimed + " parcels for Hamra clients",
      body: shown + " — received at the warehouse, not at Hamra yet.",
      tag: "hamra",
      url: "./?tab=hamra",
    };
    const { data } = await sb.from("push_subscriptions").select("endpoint,p256dh,auth");
    subs = data || [];
  }

  let sent = 0, gone = 0, failed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload), { TTL: 86400, urgency: "high" });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { gone++; await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint); }
      else failed++;
    }
  }));
  return json({ alerts: claimed, phones: subs.length, sent, gone, failed });
});
