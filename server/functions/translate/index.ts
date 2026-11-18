/* Chinese product names → English, for the sale stock.
 *
 * Signed-in staff only (the platform checks the token). Takes up to 20 short
 * texts and returns them translated, in the same order. Only product names
 * are sent — never a client's name, phone or anything else.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

/* Two free translators: Google's dictionary endpoint first, MyMemory if that
   one refuses. Neither needs a key; both can be slow or say no, in which case
   the name is left for someone to type. */
async function google(q: string): Promise<string> {
  const r = await fetch("https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=en&q=" +
    encodeURIComponent(q));
  if (!r.ok) throw new Error("google " + r.status);
  const j = await r.json();
  const t = Array.isArray(j?.[0]) ? j[0][0] : j?.[0];
  if (typeof t !== "string" || !t.trim()) throw new Error("google: empty");
  return t.trim();
}
async function mymemory(q: string): Promise<string> {
  const r = await fetch("https://api.mymemory.translated.net/get?langpair=zh-CN|en&q=" + encodeURIComponent(q.slice(0, 150)));
  if (!r.ok) throw new Error("mymemory " + r.status);
  const j = await r.json();
  const t = j?.responseData?.translatedText;
  if (typeof t !== "string" || !t.trim() || /MYMEMORY WARNING|QUERY LENGTH/i.test(t)) throw new Error("mymemory: " + (j?.responseDetails || "empty"));
  return t.trim();
}
async function one(text: string): Promise<string> {
  const q = text.slice(0, 400);
  if (!/[㐀-鿿]/.test(q)) return q;          // already not Chinese
  try { return await google(q); } catch (e1) {
    try { return await mymemory(q); } catch (e2) {
      throw new Error((e1 as Error).message + "; " + (e2 as Error).message);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  let body: { texts?: unknown } = {};
  try { body = await req.json(); } catch (_) { /* empty */ }
  const texts = Array.isArray(body.texts) ? body.texts.slice(0, 20).map((t) => String(t ?? "")) : [];
  if (!texts.length) return json({ error: "Nothing to translate" }, 400);
  try {
    const errs: string[] = [];
    const en = await Promise.all(texts.map((t) => one(t).catch((e) => { errs.push(String(e?.message || e)); return ""; })));
    return json(errs.length ? { en, errors: errs.slice(0, 3) } : { en });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 502);
  }
});
