/* Compte en ligne (Supabase) : synchronise stats, archives et réglages entre appareils.
   Supabase → Project Settings → API (ou « Connect ») :
     url     = Project URL        (ex. https://abcdefgh.supabase.co)
     anonKey = clé « anon » / « publishable » (publique, faite pour être dans le site)
   Laisser vide = jeu sans compte, tout reste sur l'appareil. */
window.SUPABASE_CONFIG = {
  url: "",
  anonKey: "",
};
