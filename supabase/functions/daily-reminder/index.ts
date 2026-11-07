// Notifications push du jeu.
// 1. Rappel quotidien « Le mot du jour t'attend » : appelée chaque heure par pg_cron (voir supabase/schema.sql),
//    envoie le rappel aux appareils dont c'est l'heure choisie, sauf si le joueur a déjà joué le mot du jour.
// 2. Appel avec { "test": true } + jeton de connexion : envoie tout de suite une notification de test à ses appareils.
// 3. Appel avec { "result": { user_id, lang, day } } par le déclencheur de la table results (en-tête x-trigger-secret) :
//    prévient les amis qui ont fait moins bien ce jour-là (une seule fois par ami et par jour).
// Sans danger si quelqu'un l'appelle : au plus un rappel par appareil et par jour.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.4";

const TEXT: Record<string, {
  title: string;
  body: (streak: number) => string;
  test: string;
  beatTitle: (p: string) => string;
  beatBody: (p: string, theirs: string, mine: string) => string;
}> = {
  fr: {
    title: "Le Mot du jour t'attend !",
    body: (s) => (s > 0 ? `Ta série : ${s} 🔥 — ne la perds pas !` : "Un nouveau mot à deviner aujourd'hui."),
    test: "Les notifications fonctionnent ✓",
    beatTitle: (p) => `${p} a fait mieux que toi ! 🏆`,
    beatBody: (p, theirs, mine) => `Mot du jour : ${theirs} pour ${p}, ${mine} pour toi.`,
  },
  en: {
    title: "Today's word is waiting!",
    body: (s) => (s > 0 ? `Your streak: ${s} 🔥 — keep it going!` : "A new word to guess today."),
    test: "Notifications are working ✓",
    beatTitle: (p) => `${p} beat your score! 🏆`,
    beatBody: (p, theirs, mine) => `Word of the day: ${theirs} for ${p}, ${mine} for you.`,
  },
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Sub = { endpoint: string; p256dh: string; auth: string; lang: string; tz: string; hour: number; last_sent: string | null; user_id: string };
type Result = { user_id: string; won: boolean; guesses: number };

const dateIn = (tz: string, d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const hourIn = (tz: string, d: Date) =>
  Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(d));
const addDays = (day: string, n: number) => new Date(Date.parse(day + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const points = (r: Result) => (r.won ? 7 - r.guesses : 0);
const score = (r: Result) => `${r.won ? r.guesses : "X"}/6`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const { data: secrets, error } = await sb.from("app_secrets").select("name, value");
  if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
  const secret = (n: string) => secrets!.find((s) => s.name === n)?.value ?? "";
  webpush.setVapidDetails("https://mede2026.github.io/wordle-fr/", secret("vapid_public"), secret("vapid_private"));

  let sent = 0, skipped = 0, removed = 0;
  async function send(sub: Sub, payload: Record<string, string>) {
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

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  // Un ami vient de finir le mot du jour : on prévient ceux qui ont fait moins bien.
  if (body.result) {
    const key = secret("trigger_secret");
    if (!key || req.headers.get("x-trigger-secret") !== key) {
      return Response.json({ error: "forbidden" }, { status: 403, headers: CORS });
    }
    const { user_id, lang, day } = body.result;
    const [{ data: mine }, { data: links }, { data: profile }] = await Promise.all([
      sb.from("results").select("user_id, won, guesses").eq("user_id", user_id).eq("lang", lang).eq("day", day).maybeSingle(),
      sb.from("friends").select("friend_id").eq("user_id", user_id),
      sb.from("profiles").select("pseudo").eq("user_id", user_id).maybeSingle(),
    ]);
    const ids = (links ?? []).map((l) => l.friend_id);
    if (!mine?.won || !ids.length) return Response.json({ sent }, { headers: CORS });
    const { data: theirs } = await sb.from("results").select("user_id, won, guesses")
      .eq("lang", lang).eq("day", day).in("user_id", ids);
    const pseudo = profile?.pseudo ?? "?";
    for (const friend of (theirs ?? []).filter((r: Result) => points(r) < points(mine))) {
      // Une seule notification par ami et par jour (la ligne existe déjà → rien n'est renvoyé).
      const { data: fresh } = await sb.from("friend_beats")
        .upsert({ from_id: user_id, to_id: friend.user_id, lang, day }, { onConflict: "from_id,to_id,lang,day", ignoreDuplicates: true })
        .select();
      if (!fresh?.length) { skipped++; continue; }
      const { data: subs } = await sb.from("push_subscriptions").select("*")
        .eq("user_id", friend.user_id).eq("friends", true).eq("lang", lang);
      const t = TEXT[lang] ?? TEXT.fr;
      for (const sub of subs ?? []) {
        await send(sub, { title: t.beatTitle(pseudo), body: t.beatBody(pseudo, score(mine), score(friend)), url: `./#${lang}`, tag: "ami" });
      }
    }
    return Response.json({ sent, skipped, removed }, { headers: CORS });
  }

  // Mode test : seulement les appareils du joueur connecté.
  let testUser: string | null = null;
  if (body.test) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
    const { data } = await sb.auth.getUser(token);
    if (!data.user) return Response.json({ error: "not_signed_in" }, { status: 401, headers: CORS });
    testUser = data.user.id;
  }

  let query = sb.from("push_subscriptions").select("*");
  query = testUser ? query.eq("user_id", testUser) : query.eq("remind", true);
  const { data: subs } = await query;

  const now = new Date();
  for (const sub of subs ?? []) {
    let tz = sub.tz;
    try { hourIn(tz, now); } catch { tz = "UTC"; }
    const localDay = dateIn(tz, now);
    const t = TEXT[sub.lang] ?? TEXT.fr;

    if (testUser) {
      await send(sub, { title: t.title, body: t.test, url: `./#${sub.lang}`, tag: "rappel-test" });
      continue;
    }
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
    await send(sub, { title: t.title, body: t.body(alive ? st.streak ?? 0 : 0), url: `./#${sub.lang}`, tag: "rappel" });
  }
  return Response.json({ sent, skipped, removed }, { headers: CORS });
});
