// Service worker : met en cache les fichiers du jeu pour qu'il marche hors-ligne.
// (Actif seulement quand le site est servi en http/https, pas en ouvrant index.html directement.)
const CACHE = "le-mot-v8";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// « Réseau d'abord, cache en secours » : toujours la dernière version quand on est en ligne.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req))
  );
});

// ---------- Rappel quotidien (notification push envoyée par Supabase) ----------
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Le Mot", {
    body: data.body || "",
    icon: "assets/img/icon_192x192.png",
    badge: "assets/img/icon_96x96.png",
    tag: data.tag || "rappel",       // un seul rappel affiché à la fois
    data: { url: data.url || "./" },
  }));
});

// Clic sur la notification : on revient sur le jeu (onglet déjà ouvert si possible).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data.url, self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      return open ? open.focus() : self.clients.openWindow(url);
    })
  );
});
