/* Creating a warehouse sign-in.
 *
 * Making an auth user needs the service key, and a service key in the app
 * would hand every scanner the whole database. So it lives here instead: the
 * app sends the admin's own token, this checks that token really belongs to an
 * active admin, and only then does the privileged work.
 *
 * The admin check is made against the database, not against anything the
 * caller sent. A forged body cannot promote anyone.
 */
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const ROLES = ["scanner", "office", "admin"];

/* Read aloud across a warehouse and written on paper, so the letters that get
   confused for each other are left out: no O/0, no I/l/1. */
function firstPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  /* Who is calling? */
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in." }, 401);
  const { data: caller, error: whoErr } = await admin.auth.getUser(token);
  if (whoErr || !caller?.user) return json({ error: "Not signed in." }, 401);

  const { data: me } = await admin
    .from("profiles").select("role, active").eq("id", caller.user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin")
    return json({ error: "Only an admin may add staff." }, 403);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Bad request." }, 400); }

  if (body.action !== "create") return json({ error: "Unknown action." }, 400);

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "scanner");

  if (!name) return json({ error: "A name is needed." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ error: "That does not look like an email address." }, 400);
  if (!ROLES.includes(role)) return json({ error: "That is not one of the roles." }, 400);

  const password = firstPassword();
  const { data: made, error: makeErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { name },
  });
  if (makeErr || !made?.user) {
    const m = String(makeErr?.message ?? "");
    if (/already been registered|already exists|duplicate/i.test(m))
      return json({ error: "Someone already has that email address." }, 409);
    return json({ error: m || "Could not create the sign-in." }, 400);
  }

  const { error: profErr } = await admin
    .from("profiles").insert({ id: made.user.id, name, role });
  if (profErr) {
    /* Without a profile the account could sign in and see nothing, which is a
       confusing half-made state — so undo it rather than leave it. */
    await admin.auth.admin.deleteUser(made.user.id).catch(() => {});
    return json({ error: "Could not set up the profile: " + profErr.message }, 400);
  }

  return json({ name, email, password, role });
});
