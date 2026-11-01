/* =========================================================================
   Logique « pure » du jeu : aucune dépendance à la page (pas de DOM).
   Utilisée par le navigateur (window.WordleLogic) ET par les tests Node.
   ========================================================================= */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WordleLogic = api;
})(typeof self !== "undefined" ? self : this, function (root) {
  "use strict";

  const NB_LETTERS = 5;
  const NB_ATTEMPTS = 6;

  // seedrandom : déjà chargé dans le navigateur (Math.seedrandom), sinon via require (Node).
  const seedrandom = typeof Math.seedrandom === "function"
    ? Math.seedrandom
    : typeof require === "function" ? require("./vendor/seedrandom.min.js") : null;

  // ---------- Dates (format AAAA-MM-JJ) ----------
  const pad = (n) => String(n).padStart(2, "0");
  const utc = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 864e5);
  function addDays(k, n) {
    const d = new Date(utc(k) + n * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function timeParts(timeZone, now) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(now);
    const o = {};
    parts.forEach((p) => (o[p.type] = p.value));
    return o;
  }

  /** Date du jour dans un fuseau horaire (undefined = heure de l'appareil). */
  function todayKey(timeZone, now = new Date()) {
    const p = timeParts(timeZone, now);
    return `${p.year}-${p.month}-${p.day}`;
  }

  /** Secondes avant le prochain minuit dans ce fuseau horaire. */
  function secondsToMidnight(timeZone, now = new Date()) {
    const p = timeParts(timeZone, now);
    return 86400 - (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second));
  }

  // ---------- Hasard déterministe ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const hash = (str) => [...str].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 7);

  /** Copie mélangée d'une liste, toujours dans le même ordre pour une même graine. */
  function shuffled(list, seedText) {
    const rnd = mulberry32(hash(seedText));
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  const chunk5 = (str) => str.match(/.{5}/g) || [];

  /**
   * Mot du jour.
   * - pick "seedrandom" : même calcul que wordle.louan.me (graine = date « AAAA-M-J »).
   * - pick "shuffle"    : liste mélangée une fois, un mot par jour, sans répétition.
   */
  function wordFor(cfg, answers, dateKey, order) {
    if (cfg.specialDays && cfg.specialDays[dateKey]) return cfg.specialDays[dateKey];
    if (cfg.pick === "seedrandom") {
      const [y, m, d] = dateKey.split("-").map(Number);
      return answers[Math.floor(seedrandom(`${y}-${m}-${d}`)() * answers.length)];
    }
    order = order || shuffled(answers, "le-mot-" + cfg.id);
    const idx = daysBetween(cfg.firstDay, dateKey);
    return order[((idx % order.length) + order.length) % order.length];
  }

  // ---------- Règles ----------
  /** Couleur de chaque lettre. 2 passages pour bien gérer les lettres en double. */
  function evaluate(guess, answer) {
    const res = Array(NB_LETTERS).fill("incorrect");
    const left = answer.split("");
    for (let i = 0; i < NB_LETTERS; i++) {
      if (guess[i] === answer[i]) { res[i] = "correct"; left[i] = null; }
    }
    for (let i = 0; i < NB_LETTERS; i++) {
      if (res[i] === "correct") continue;
      const j = left.indexOf(guess[i]);
      if (j !== -1) { res[i] = "partial"; left[j] = null; }
    }
    return res;
  }

  /**
   * Mode difficile : renvoie null si l'essai est permis, sinon
   * { type: "place", letter, pos } ou { type: "contain", letter }.
   */
  function hardModeError(guesses, answer, guess) {
    for (const prev of guesses) {
      const res = evaluate(prev, answer);
      for (let i = 0; i < NB_LETTERS; i++) {
        if (res[i] === "correct" && guess[i] !== prev[i]) return { type: "place", letter: prev[i], pos: i + 1 };
      }
      const need = {};
      res.forEach((r, i) => { if (r !== "incorrect") need[prev[i]] = (need[prev[i]] || 0) + 1; });
      for (const l in need) {
        if (guess.split(l).length - 1 < need[l]) return { type: "contain", letter: l };
      }
    }
    return null;
  }

  /** Stats à partir de { "AAAA-MM-JJ": { won, n } }. */
  function computeStats(games, today) {
    const days = Object.keys(games).sort();
    const s = { played: days.length, wins: 0, streak: 0, maxStreak: 0, dist: Array(NB_ATTEMPTS + 1).fill(0) };
    let run = 0, prev = null;
    for (const d of days) {
      const g = games[d];
      if (g.won) {
        s.wins++;
        s.dist[g.n - 1]++;
        run = prev && addDays(prev, 1) === d && games[prev].won ? run + 1 : 1;
      } else {
        s.dist[NB_ATTEMPTS]++;
        run = 0;
      }
      s.maxStreak = Math.max(s.maxStreak, run);
      prev = d;
    }
    // La série actuelle compte seulement si la dernière partie est d'aujourd'hui ou d'hier.
    s.streak = prev && (prev === today || prev === addDays(today, -1)) ? run : 0;
    return s;
  }

  /**
   * Fusionne deux sauvegardes (cet appareil + le compte en ligne) sans rien perdre :
   * stats et archives de tous les jours, la partie la plus avancée, les réglages les plus récents.
   */
  function mergeStores(a, b) {
    a = a || {}; b = b || {};
    const [older, newer] = (a.updatedAt || 0) > (b.updatedAt || 0) ? [b, a] : [a, b];
    const progress = (slot) => (slot && slot.guesses ? slot.guesses.length : -1);
    // À égalité, on garde la version la plus récente.
    const bestSlot = (o, n) => (progress(o) > progress(n) ? o : n || o);
    const out = Object.assign({}, older, newer);
    out.settings = Object.assign({}, older.settings, newer.settings);
    out.updatedAt = Math.max(a.updatedAt || 0, b.updatedAt || 0);

    for (const key of new Set(Object.keys(a).concat(Object.keys(b)))) {
      const o = older[key], n = newer[key];
      const isLang = (x) => x && typeof x === "object" && ("stats" in x || "archives" in x || "game" in x);
      if (!isLang(o) && !isLang(n)) continue;
      const lo = o || {}, ln = n || {};
      const archives = Object.assign({}, lo.archives);
      for (const d in ln.archives) archives[d] = bestSlot(archives[d], ln.archives[d]);
      let game = ln.game || lo.game || null;
      if (lo.game && ln.game) {
        if (lo.game.date !== ln.game.date) game = lo.game.date > ln.game.date ? lo.game : ln.game;
        else game = bestSlot(lo.game, ln.game);
      }
      out[key] = Object.assign({}, lo, ln, {
        stats: Object.assign({}, lo.stats, ln.stats),
        archives,
        game,
      });
    }
    return out;
  }

  /** Résumé partagé avec les amis : { streak, maxStreak, played, wins, last }. */
  function statsSummary(games, today) {
    const s = computeStats(games, today);
    const days = Object.keys(games).sort();
    return { streak: s.streak, maxStreak: s.maxStreak, played: s.played, wins: s.wins, last: days[days.length - 1] || null };
  }

  /**
   * Classement entre amis pour une langue.
   * players : [{ id, pseudo, me, today: { won, guesses } | null, stats: statsSummary | undefined }]
   * Ordre : gagné aujourd'hui (moins d'essais d'abord), puis perdu, puis pas encore joué ;
   * à égalité, la plus longue série.
   */
  function rankFriends(players, today) {
    const yesterday = addDays(today, -1);
    const score = (p) => (!p.today ? 99 : p.today.won ? p.today.guesses : 50);
    return players
      .map((p) => {
        const st = p.stats || {};
        // Une série dont la dernière partie date d'avant-hier est cassée.
        const alive = st.last === today || st.last === yesterday;
        return Object.assign({}, p, { streak: alive ? st.streak || 0 : 0, maxStreak: st.maxStreak || 0 });
      })
      .sort((a, b) => score(a) - score(b) || b.streak - a.streak || a.pseudo.localeCompare(b.pseudo));
  }

  /** Points d'une partie : 6 en 1 essai … 1 en 6 essais, 0 si perdu. */
  const points = (r) => (r && r.won ? NB_ATTEMPTS + 1 - r.guesses : 0);

  /**
   * Classement sur les 7 derniers jours (aujourd'hui compris).
   * players : [{ id, pseudo, me, days: [{ day, won, guesses }] }]
   */
  function rankWeek(players, today) {
    const from = addDays(today, -6);
    return players
      .map((p) => {
        const week = (p.days || []).filter((d) => d.day >= from && d.day <= today);
        return Object.assign({}, p, {
          points: week.reduce((sum, d) => sum + points(d), 0),
          wins: week.filter((d) => d.won).length,
          played: week.length,
        });
      })
      .sort((a, b) => b.points - a.points || b.wins - a.wins || a.pseudo.localeCompare(b.pseudo));
  }

  return {
    NB_LETTERS, NB_ATTEMPTS,
    pad, daysBetween, addDays, todayKey, secondsToMidnight,
    shuffled, chunk5, wordFor, evaluate, hardModeError, computeStats, mergeStores,
    statsSummary, rankFriends, points, rankWeek,
  };
});
