// Rappel quotidien « Le mot du jour t'attend » (notifications push).
// Appelée chaque heure par pg_cron (voir supabase/schema.sql) : envoie le rappel aux appareils
// dont c'est l'heure choisie, sauf si le joueur a déjà joué le mot du jour.
// Appel avec { "test": true } + jeton de connexion : envoie tout de suite un rappel de test à ses appareils.
// Sans danger si quelqu'un l'appelle : au plus un rappel par appareil et par jour.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const TEXT: Record<string, { title: string; body: (streak: number) => string; test: string }> = {
  fr: {
    title: "Le Mot du jour t'attend !",
    body: (s) => (s > 0 ? `Ta série : ${s} 🔥 — ne la perds pas !` : "Un nouveau mot à deviner aujourd'hui."),
    test: "Les rappels fonctionnent ✓",
  },
  en: {
    title: "Today's word is waiting!",
    body: (s) => (s > 0 ? `Your streak: ${s} 🔥 — keep it going!` : "A new word to guess today."),
    test: "Reminders are working ✓",
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const dateIn = (tz: string, d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hourIn = (tz: string, d: Date) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d));
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: secrets, error } = await sb.from("app_secrets").select("name, value");
  if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
  const secret = (n: string) => secrets!.find((s) => s.name === n)?.value ?? "";
  webpush.setVapidDetails("https://mede2026.github.io/wordle-fr/", secret("vapid_public"), secret("vapid_private"));

  // Mode test : seulement les appareils du joueur connecté.
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  let testUser: string | null = null;
  if (body.test) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data } = await sb.auth.getUser(token);
    if (!data.user) return Response.json({ error: "not_signed_in" }, { status: 401, headers: CORS });
    testUser = data.user.id;
  }

  let query = sb.from("push_subscriptions").select("*");
  if (testUser) query = query.eq("user_id", testUser);
  const { data: subs } = await query;

  const now = new Date();
  let sent = 0, skipped = 0, removed = 0;
  for (const sub of subs ?? []) {
    let tz = sub.tz;
    try { hourIn(tz, now); } catch { tz = "UTC"; }
    const localDay = dateIn(tz, now);
    const t = TEXT[sub.lang] ?? TEXT.fr;
    let payload;

    if (testUser) {
      payload = { title: t.title, body: t.test, url: `./#${sub.lang}`, tag: "rappel-test" };
    } else {
      if (hourIn(tz, now) !== sub.hour || sub.last_sent === localDay) continue;
      // Le mot FR change à minuit heure de Paris, le mot EN à minuit heure de l'appareil.
      const gameDay = sub.lang === "fr" ? dateIn("Europe/Paris", now) : localDay;
      const [played, profile] = await Promise.all([
        sb.from("results").select("day").eq("user_id", sub.user_id).eq("lang", sub.lang).eq("day", gameDay).maybeSingle(),
        sb.from("profiles").select("stats").eq("user_id", sub.user_id).maybeSingle(),
      ]);
      await sb.from("push_subscriptions").update({ last_sent: localDay }).eq("endpoint", sub.endpoint);
      if (played.data) { skipped++; continue; }
      const st = profile.data?.stats?.[sub.lang] ?? {};
      const alive = st.last === gameDay || st.last === addDays(gameDay, -1);
      payload = { title: t.title, body: t.body(alive ? st.streak ?? 0 : 0), url: `./#${sub.lang}`, tag: "rappel" };
    }

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 3 * 3600 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) { // abonnement expiré (appli désinstallée, permission retirée…)
        await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        removed++;
      } else {
        console.error("push", code, e);
      }
    }
  }
  return Response.json({ sent, skipped, removed }, { headers: CORS });
});
