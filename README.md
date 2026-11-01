# Le Mot / Wordle — FR & EN

Jeu de mots du jour (style Wordle) en **français** 🇫🇷 et en **anglais** 🇬🇧.

## Jouer

**Ouvre simplement `index.html` dans ton navigateur** (double-clic) — aucun serveur, aucune installation, aucune compilation.

Au premier lancement, choisis ta langue. Tu peux la changer avec le bouton **FR / EN** en haut à droite, dans les paramètres, ou directement par l'adresse : `index.html#fr` ou `index.html#en`.

## Fonctions

- Un mot par jour et par langue
  - **FR : le même mot que [wordle.louan.me](https://wordle.louan.me)** (même liste, même calcul `seedrandom`, minuit heure de Paris = 18 h au Québec)
  - EN : liste mélangée une fois, aucun mot ne revient avant que toute la liste soit passée (minuit heure locale)
- Statistiques séparées FR / EN (parties, % de victoires, séries, distribution)
- Mode **Archives** : rejoue les mots des jours précédents (progression sauvegardée, ✓ quand fini)
- La ligne en cours est sauvegardée si tu fermes la page
- Flèches **← →** (ou clic sur une case) pour corriger une lettre au milieu du mot
- **Compte en ligne** (optionnel) : stats, archives et réglages synchronisés sur tous tes appareils
  - état de synchro clair (pastille orange sur ⚙️ hors-ligne, tout est renvoyé au retour du réseau)
  - mot de passe oublié (lien par courriel)
- **Classement entre amis** 👥 : score du jour, série 🔥 et record 🏆 de chacun ; on s'ajoute avec un code ami
- Mode **difficile**, mode **daltonien**, **thème clair**
- Claviers AZERTY, BÉPO, QWERTY, QWERTZ (FR) — QWERTY, AZERTY, DVORAK (EN)
- Accents ignorés au clavier (é → E)
- Partage du résultat en emojis 🟩🟨⬛
- Hors-ligne (PWA) quand le site est hébergé (ex. GitHub Pages)

## Compte et synchronisation (Supabase)

Optionnel : sans configuration, le jeu marche comme avant (tout reste sur l'appareil).

1. Crée un projet gratuit sur [supabase.com](https://supabase.com).
2. **SQL Editor → New query** : colle le contenu de [`supabase/schema.sql`](supabase/schema.sql) puis **Run**
   (sauvegardes, profils, amis, résultats ; tout est protégé par RLS).
3. **Authentication → Sign In / Providers → Email** : le fournisseur **Email** doit être **activé**,
   et **Confirm email** **désactivé** → **Save**
   (sinon chaque inscription envoie un courriel, et le plan gratuit en envoie très peu).
4. **Authentication → URL Configuration** : *Site URL* = l'adresse du jeu sur GitHub Pages
   (ex. `https://mede2026.github.io/wordle-fr/`) — c'est là que mène le lien « mot de passe oublié ».
5. **Project Settings → API** (ou bouton **Connect**) : copie la *Project URL* et la clé *anon* / *publishable*
   dans [`assets/js/config.js`](assets/js/config.js). Ces deux valeurs sont publiques, c'est normal
   (la table est protégée : chacun ne voit que sa propre sauvegarde).

Ensuite, dans le jeu : ⚙️ Paramètres → **Compte** → *Créer un compte* (courriel + mot de passe).
Sur un autre appareil, *Se connecter* avec les mêmes identifiants : les données des deux appareils sont fusionnées
(aucune partie perdue) et se resynchronisent à chaque retour sur la page.

## Mettre en ligne (GitHub Pages)

Sur GitHub : **Settings → Pages → Build and deployment → Source : Deploy from a branch**,
branche `main`, dossier `/ (root)` → **Save**. Le jeu sera sur `https://<utilisateur>.github.io/wordle-fr/`
(mis à jour à chaque `git push`).

## Tests

```
node --test
```

(ou `npm test`) — vérifie les couleurs (lettres en double), le mode difficile, la fusion des sauvegardes entre appareils, le mot du jour FR (identique à wordle.louan.me), les listes de mots, les dates et les stats. Aucune installation nécessaire, juste [Node.js](https://nodejs.org).

## Structure

```
index.html            page unique (choix de langue + jeu)
assets/css/style.css  style
assets/js/game.js     interface (affichage, clavier, sauvegarde)
assets/js/logic.js    règles pures (couleurs, mode difficile, mot du jour, stats)
assets/js/i18n.js     textes, claviers et réglages FR / EN
assets/js/config.js   adresse et clé publique Supabase (compte en ligne, optionnel)
assets/js/words-*.js  listes de mots, chargées seulement pour la langue choisie
assets/js/vendor/     seedrandom (MIT) — même tirage que wordle.louan.me ; supabase-js 2.49.4 (MIT)
tests/                tests automatiques (node --test)
supabase/schema.sql   table de sauvegarde en ligne (à coller dans Supabase)
assets/icons, img     icônes
sw.js, manifest.json  mode hors-ligne / installation (PWA)
```

## Crédits

- Version FR basée sur [louanben/wordle-fr](https://github.com/louanben/wordle-fr) (GPL-3.0)
- Listes de mots anglaises tirées de [everurstruly/The-New-York-Times-Wordle-Clone](https://github.com/everurstruly/The-New-York-Times-Wordle-Clone)
- Concept original : **Wordle** par Josh Wardle
