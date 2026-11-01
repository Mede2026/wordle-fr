/* Compte en ligne (Supabase) : synchronise stats, archives et réglages entre appareils.
   Supabase → Project Settings → API (ou « Connect ») :
     url     = Project URL        (ex. https://abcdefgh.supabase.co)
     anonKey = clé « anon » / « publishable » (publique, faite pour être dans le site)
   Laisser vide = jeu sans compte, tout reste sur l'appareil. */
window.SUPABASE_CONFIG = {
  url: "https://yiubbduljiqnamtcjqkd.supabase.co",
  anonKey: "sb_publishable_0Pl1_nSsDFWR3ItriA5v3w_rJdxyJ9A",
  // Rappel quotidien : clé publique VAPID (la clé privée est dans la table app_secrets, côté serveur)
  vapidPublicKey: "BNrHr-QE_O0KrmWzBrf4Q0gY_sjQmiZAgDD5SBMHd9dfLM7jI55ZmhENopVF_Y7XPXfW_jS_kDzpNN-cNxJ7ol0",
};
