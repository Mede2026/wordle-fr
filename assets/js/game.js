/* =========================================================================
   Le Mot / Wordle — FR & EN
   Interface du jeu (affichage, clavier, sauvegarde). Les règles sont dans logic.js.
   ========================================================================= */
(function () {
  "use strict";

  const G = window.WordleLogic;
  const { NB_LETTERS, NB_ATTEMPTS, pad, addDays, daysBetween, evaluate } = G;
  const STORAGE_KEY = "lemot:v3";
  const FLIP_MS = 300; // délai entre chaque case qui se retourne

  // ---------- Petits utilitaires ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  // ---------- Listes de mots : chargées seulement quand la langue est choisie ----------
  // (une balise <script> ajoutée à la volée marche aussi en ouvrant index.html sans serveur)
  const loading = {};
  function loadScript(src) {
    return (loading[src] = loading[src] || new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { delete loading[src]; s.remove(); reject(new Error(src)); };
      document.head.appendChild(s);
    }));
  }
  function loadWords(lang) {
    if (window.WORDS && window.WORDS[lang]) return Promise.resolve();
    return loadScript(`assets/js/words-${lang}.js`);
  }

  const dict = {};
  function getDict(lang) {
    if (dict[lang]) return dict[lang];
    const src = window.WORDS[lang];
    const answers = G.chunk5(src.answers);
    const cfg = window.LANGS[lang];
    return (dict[lang] = {
      answers,
      order: cfg.pick === "shuffle" ? G.shuffled(answers, "le-mot-" + lang) : null,
      valid: new Set(answers.concat(G.chunk5(src.valid))), // Set = recherche instantanée
    });
  }

  // ---------- Sauvegarde (localStorage) ----------
  function withDefaults(s) {
    s.settings = Object.assign({ colorBlind: false, webShare: false, hardMode: false, theme: null, layout: {} }, s.settings);
    s.settings.layout = Object.assign({}, s.settings.layout);
    for (const lang of Object.keys(window.LANGS)) {
      s[lang] = Object.assign({ game: null, stats: {}, archives: {} }, s[lang]);
    }
    return s;
  }
  function loadStore() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { /* données abîmées */ }
    return withDefaults(s);
  }
  const store = loadStore();
  const writeLocal = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (e) { /* mode privé */ } };
  const save = () => {
    store.updatedAt = Date.now();
    writeLocal();
    schedulePush(); // compte en ligne (s'il y en a un)
  };

  // ---------- État de la partie en cours ----------
  const state = {
    lang: null,
    date: null,
    archive: false,
    answer: "",
    guesses: [],   // mots déjà validés
    current: "",   // mot en train d'être tapé (" " = case vide)
    cursor: 0,     // case sélectionnée dans la ligne en cours (flèches ← →)
    finished: false,
    won: false,
    busy: false,   // vrai pendant l'animation (on bloque le clavier)
    hardMode: false,
  };
  let L = null; // config de la langue active (window.LANGS[lang])
  const T = (key, ...args) => { const v = L.t[key]; return typeof v === "function" ? v(...args) : v; };
  const today = () => G.todayKey(L.timeZone);

  const wordFor = (dateKey) => {
    const d = getDict(state.lang);
    return G.wordFor(L, d.answers, dateKey, d.order);
  };
  const wordNumber = () => daysBetween(L.firstDay, state.date) + L.numberOffset;

  // ---------- Chargement / sauvegarde d'une partie ----------
  // Partie du jour : store[lang].game — Archives : store[lang].archives[date]
  function savedSlot() {
    const s = store[state.lang];
    if (state.archive) return s.archives[state.date];
    return s.game && s.game.date === state.date ? s.game : null;
  }

  function loadGame() {
    state.answer = wordFor(state.date);
    state.busy = false;
    const saved = savedSlot();
    // On ignore une sauvegarde faite pour un autre mot (ex. : ancienne version du jeu).
    if (saved && saved.answer === state.answer) {
      state.guesses = saved.guesses.slice();
      state.current = saved.current || "";
      state.hardMode = !!saved.hardMode;
    } else {
      state.guesses = [];
      state.current = "";
      state.hardMode = store.settings.hardMode;
    }
    state.won = state.guesses.includes(state.answer);
    state.finished = state.won || state.guesses.length >= NB_ATTEMPTS;
    if (state.finished) state.current = "";
    const gap = state.current.indexOf(" ");
    state.cursor = gap >= 0 ? gap : state.current.length;
    renderAll();
  }

  function persistGame() {
    const s = store[state.lang];
    const slot = { answer: state.answer, guesses: state.guesses, current: state.current, hardMode: state.hardMode };
    if (state.archive) {
      s.archives[state.date] = slot; // gardé, mais ne compte pas dans les stats
    } else {
      s.game = Object.assign({ date: state.date }, slot);
      if (state.finished) s.stats[state.date] = { won: state.won, n: state.guesses.length, hard: state.hardMode };
    }
    save();
  }

  // ---------- Affichage ----------
  const gridEl = $("#grid");
  const kbEl = $("#keyboard");
  const tiles = [];

  function buildGrid() {
    for (let r = 0; r < NB_ATTEMPTS; r++) {
      const row = el("div", "row");
      const rowTiles = [];
      for (let c = 0; c < NB_LETTERS; c++) {
        const t = el("div", "tile");
        row.appendChild(t);
        rowTiles.push(t);
      }
      gridEl.appendChild(row);
      tiles.push(rowTiles);
    }
  }

  function renderGrid(animateRow) {
    for (let r = 0; r < NB_ATTEMPTS; r++) {
      const word = r < state.guesses.length ? state.guesses[r] : r === state.guesses.length ? state.current : "";
      const res = r < state.guesses.length ? evaluate(word, state.answer) : null;
      for (let c = 0; c < NB_LETTERS; c++) {
        const t = tiles[r][c];
        const letter = (word[c] || "").trim();
        t.textContent = letter;
        t.className = "tile";
        t.style.animationDelay = t.style.transitionDelay = "";
        if (letter) t.classList.add("filled");
        if (!state.finished && r === state.guesses.length && c === state.cursor) t.classList.add("cursor");
        if (res) {
          t.classList.add(res[c]);
          if (r === animateRow) {
            t.classList.add("reveal");
            t.style.animationDelay = `${c * FLIP_MS}ms`;
            t.style.transitionDelay = `${c * FLIP_MS + 250}ms`;
          }
        }
      }
    }
  }

  function buildKeyboard() {
    kbEl.innerHTML = "";
    const layoutName = store.settings.layout[state.lang] || L.defaultLayout;
    const rows = L.layouts[layoutName] || L.layouts[L.defaultLayout];
    rows.forEach((line) => {
      const row = el("div", "kb-row");
      for (const ch of line) {
        const key = el("button", "key");
        if (ch === "<" || ch === ">") {
          const isEnter = ch === "<";
          key.classList.add("big");
          key.dataset.key = isEnter ? "Enter" : "Backspace";
          key.setAttribute("aria-label", isEnter ? L.enter : L.del);
          const img = el("img", "icon");
          img.src = `assets/icons/${isEnter ? "entrer" : "suppr"}.svg`;
          img.alt = "";
          key.appendChild(img);
        } else {
          key.dataset.key = ch;
          key.textContent = ch;
        }
        row.appendChild(key);
      }
      kbEl.appendChild(row);
    });
  }

  function renderKeyboard() {
    const rank = { incorrect: 1, partial: 2, correct: 3 };
    const best = {};
    state.guesses.forEach((g) => evaluate(g, state.answer).forEach((r, i) => {
      if (!best[g[i]] || rank[r] > rank[best[g[i]]]) best[g[i]] = r;
    }));
    kbEl.querySelectorAll(".key").forEach((k) => {
      k.classList.remove("correct", "partial", "incorrect");
      if (best[k.dataset.key]) k.classList.add(best[k.dataset.key]);
    });
  }

  function archiveDone(dateKey) {
    const a = store[state.lang].archives[dateKey];
    return !!a && a.answer === wordFor(dateKey) && (a.guesses.includes(a.answer) || a.guesses.length >= NB_ATTEMPTS);
  }

  function renderHeader() {
    $("#game-title").hidden = state.archive;
    $("#archives-selector").hidden = !state.archive;
    $("#btn-archives").classList.toggle("pressed", state.archive);
    if (state.archive) {
      const first = L.firstDay;
      const last = addDays(today(), -1);
      $("#archive-date-label").textContent = state.date + (archiveDone(state.date) ? " ✓" : "");
      const input = $("#archive-date-input");
      input.min = first; input.max = last; input.value = state.date;
      $("#archive-prev").disabled = state.date <= first;
      $("#archive-next").disabled = state.date >= last;
    }
  }

  function renderAll(animateRow) {
    renderHeader();
    renderGrid(animateRow);
    renderKeyboard();
  }

  // ---------- Messages (toast) ----------
  let toastTimer;
  function toast(msg, ms = 1200) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  function shakeRow() {
    const row = gridEl.children[state.guesses.length];
    row.classList.remove("shake");
    void row.offsetWidth; // relance l'animation
    row.classList.add("shake");
  }

  // ---------- Saisie ----------
  function onKey(key) {
    if (state.finished || state.busy || !L) return;
    if (key === "Enter") return submit();
    // La ligne en cours = 5 cases ; on écrit / efface à la position du curseur.
    const cells = state.current.padEnd(NB_LETTERS, " ").split("");
    let popAt = -1;
    if (key === "ArrowLeft") {
      state.cursor = Math.max(0, state.cursor - 1);
    } else if (key === "ArrowRight") {
      if (state.cursor < NB_LETTERS - 1) state.cursor++;
    } else if (key === "Backspace") {
      // Case vide (ou fin de ligne) → on recule d'abord, comme un traitement de texte.
      if (state.cursor > 0 && (state.cursor === NB_LETTERS || cells[state.cursor] === " ")) state.cursor--;
      if (cells[state.cursor] === " ") return renderGrid();
      cells[state.cursor] = " ";
    } else if (/^[A-Z]$/.test(key) && state.cursor < NB_LETTERS) {
      cells[state.cursor] = key;
      popAt = state.cursor++;
    } else {
      return;
    }
    const current = cells.join("").trimEnd();
    const changed = current !== state.current;
    state.current = current;
    renderGrid();
    if (popAt >= 0) tiles[state.guesses.length][popAt].classList.add("pop");
    if (changed) persistGame(); // la ligne en cours survit à une fermeture de la page
  }

  // Clic sur une case de la ligne en cours → le curseur y va.
  gridEl.addEventListener("click", (e) => {
    const t = e.target.closest(".tile");
    if (!t || state.finished || state.busy) return;
    const row = tiles[state.guesses.length];
    if (!row || !row.includes(t)) return;
    state.cursor = row.indexOf(t);
    renderGrid();
  });

  function submit() {
    const guess = state.current;
    if (guess.length < NB_LETTERS || guess.includes(" ")) { toast(T("notEnough")); return shakeRow(); }
    if (!getDict(state.lang).valid.has(guess)) { toast(T("notInList")); return shakeRow(); }
    if (state.hardMode) {
      const err = G.hardModeError(state.guesses, state.answer, guess);
      if (err) {
        toast(err.type === "place" ? T("mustPlace", err.letter, err.pos) : T("mustContain", err.letter));
        return shakeRow();
      }
    }

    const row = state.guesses.length;
    state.guesses.push(guess);
    state.current = "";
    state.cursor = 0;
    state.won = guess === state.answer;
    state.finished = state.won || state.guesses.length >= NB_ATTEMPTS;
    persistGame();

    state.busy = true;
    renderGrid(row);
    const revealTime = FLIP_MS * (NB_LETTERS - 1) + 500;
    setTimeout(() => {
      state.busy = false;
      renderKeyboard();
      if (!state.finished) return;
      renderHeader(); // ✓ dans les archives
      if (state.won) {
        toast(T("wins")[row], 2000);
        tiles[row].forEach((t, i) => { t.style.animationDelay = `${i * 100}ms`; t.classList.remove("reveal"); t.classList.add("win"); });
      } else {
        toast(state.answer, 2500);
      }
      setTimeout(() => openModal("stats"), 1800);
    }, revealTime);
  }

  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") return closeModals();
    if (document.querySelector(".modal:not([hidden])") || !$("#lang-picker").hidden) return;
    if (e.target.tagName === "INPUT") return;
    if (["Enter", "Backspace", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      return onKey(e.key);
    }
    // « é » → « E », etc.
    const k = e.key.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
    if (/^[A-Z]$/.test(k)) onKey(k);
  });

  kbEl.addEventListener("click", (e) => {
    const k = e.target.closest(".key");
    if (k) { onKey(k.dataset.key); k.blur(); }
  });

  // ---------- Statistiques ----------
  function renderStats() {
    const body = $("#stats-body");
    const graph = $("#graph");
    body.innerHTML = "";
    graph.innerHTML = "";
    $("#dist-title").hidden = state.archive;

    if (state.archive) {
      body.appendChild(el("p", "muted", T("archiveNoStats")));
    } else {
      const s = G.computeStats(store[state.lang].stats, today());
      const box = el("div", "stats-grid");
      [[s.played, "played"], [s.played ? Math.round((s.wins / s.played) * 100) : 0, "winPct"], [s.streak, "streak"], [s.maxStreak, "maxStreak"]]
        .forEach(([v, k]) => {
          const item = el("div", "stat");
          item.append(el("div", "stat-figure", v), el("div", "stat-label", T(k)));
          box.appendChild(item);
        });
      body.appendChild(box);

      const max = Math.max(1, ...s.dist);
      s.dist.forEach((count, i) => {
        const line = el("div", "graph-line");
        const label = el("div", "graph-label");
        if (i < NB_ATTEMPTS) label.textContent = i + 1;
        else { const img = el("img", "icon"); img.src = "assets/icons/skull.svg"; img.alt = "✗"; label.appendChild(img); }
        const bar = el("div", "graph-bar", count);
        bar.style.width = `${Math.max(8, (count / max) * 100)}%`;
        const isToday = state.finished && (state.won ? i === state.guesses.length - 1 : i === NB_ATTEMPTS);
        if (isToday) bar.classList.add("best");
        line.append(label, bar);
        graph.appendChild(line);
      });
    }

    $("#solution").hidden = !state.finished;
    $("#countdown-box").hidden = !state.finished || state.archive;
    if (state.finished) {
      $("#solution-word").textContent = state.answer;
      $("#btn-definition").href = L.definitionUrl(state.answer);
      $("#share-label").textContent = T("share");
    }
  }

  function tick() {
    if (!L) return;
    const s = G.secondsToMidnight(L.timeZone);
    $("#countdown").textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    // Nouveau jour pendant que la page est ouverte → on charge le nouveau mot.
    if (!state.archive && state.date !== today() && !state.busy) { state.date = today(); loadGame(); }
  }
  setInterval(tick, 1000);

  // ---------- Partage ----------
  function shareText() {
    const cb = store.settings.colorBlind;
    const light = document.body.classList.contains("light");
    const emoji = { correct: cb ? "🟧" : "🟩", partial: cb ? "🟦" : "🟨", incorrect: light ? "⬜" : "⬛" };
    const score = state.won ? state.guesses.length : "X";
    const tag = state.archive ? ` (${state.date})` : "";
    const lines = state.guesses.map((g) => evaluate(g, state.answer).map((r) => emoji[r]).join(""));
    return `${L.shareName} #${wordNumber()}${tag} ${score}/${NB_ATTEMPTS}${state.hardMode ? "*" : ""}\n\n${lines.join("\n")}`;
  }

  async function share() {
    const text = shareText();
    const copied = () => {
      $("#share-label").textContent = T("copied");
      setTimeout(() => ($("#share-label").textContent = T("share")), 3000);
    };
    if (store.settings.webShare && navigator.share) {
      try { await navigator.share({ text }); return; } catch (e) { /* annulé → copie */ }
    }
    try {
      await navigator.clipboard.writeText(text);
      copied();
    } catch (e) {
      // Plan B pour les vieux navigateurs / file://
      const ta = el("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand("copy");
      ta.remove();
      ok ? copied() : toast(T("copyFail"));
    }
  }
  $("#btn-share").addEventListener("click", share);

  // ---------- Fenêtres (modales) ----------
  function openModal(name) {
    closeModals();
    if (name === "stats") renderStats();
    if (name === "settings") renderSettings();
    if (name === "friends") renderFriends();
    $(`#modal-${name}`).hidden = false;
  }
  function closeModals() { $$(".modal").forEach((m) => (m.hidden = true)); }

  $$(".modal").forEach((m) => m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) closeModals();
  }));
  $("#btn-help").addEventListener("click", () => openModal("help"));
  $("#btn-stats").addEventListener("click", () => openModal("stats"));
  $("#btn-settings").addEventListener("click", () => openModal("settings"));
  $("#btn-friends").addEventListener("click", () => openModal("friends"));

  // ---------- Paramètres ----------
  const isLight = () => store.settings.theme === "light"; // sombre par défaut (look original)

  function renderSettings() {
    const values = {
      hardMode: state.hardMode,
      colorBlind: store.settings.colorBlind,
      webShare: store.settings.webShare,
      lightTheme: isLight(),
    };
    $$(".toggle").forEach((t) => {
      const on = !!values[t.dataset.setting];
      t.classList.toggle("on", on);
      t.setAttribute("aria-checked", on);
    });
    const current = store.settings.layout[state.lang] || L.defaultLayout;
    const box = $("#layout-buttons");
    box.innerHTML = "";
    Object.keys(L.layouts).forEach((name) => {
      const b = el("button", name === current ? "selected" : "", name);
      b.addEventListener("click", () => {
        store.settings.layout[state.lang] = name;
        save();
        buildKeyboard();
        renderKeyboard();
        renderSettings();
      });
      box.appendChild(b);
    });
    $$("#modal-settings [data-lang]").forEach((b) => b.classList.toggle("selected", b.dataset.lang === state.lang));
    renderAccount();
  }

  $$(".toggle").forEach((t) => t.addEventListener("click", () => {
    const key = t.dataset.setting;
    if (key === "hardMode") {
      // On ne peut pas activer/désactiver le mode difficile au milieu d'une partie.
      if (state.guesses.length && !state.finished) return toast(T("hardLocked"));
      state.hardMode = store.settings.hardMode = !state.hardMode;
      persistGame();
    } else if (key === "lightTheme") {
      store.settings.theme = isLight() ? "dark" : "light";
      save();
    } else {
      store.settings[key] = !store.settings[key];
      save();
    }
    applyLook();
    renderSettings();
  }));

  function applyLook() {
    const light = isLight();
    document.body.classList.toggle("light", light);
    document.body.classList.toggle("color-blind", !!store.settings.colorBlind);
    $('meta[name="theme-color"]').content = light ? "#ffffff" : "#1d1d20";
  }

  // ---------- Compte en ligne (Supabase) ----------
  // Courriel + mot de passe. La sauvegarde complète (store) est une ligne de la table « saves ».
  // À chaque connexion, retour sur la page ou retour du réseau : on récupère, on fusionne (mergeStores), on renvoie.
  // Pour les amis : un profil (pseudo, code ami, résumé des séries) + les résultats des derniers jours.
  const CFG = window.SUPABASE_CONFIG || {};
  const account = {
    sb: null,
    user: null,
    profile: null,      // { pseudo, friend_code }
    state: "idle",      // idle | syncing | synced | error
    syncedAt: null,
    dirty: false,       // modifications pas encore envoyées
    version: 0,         // +1 à chaque sauvegarde (pour savoir si un envoi est toujours à jour)
    message: "",        // message du formulaire (erreur de connexion, courriel envoyé…)
    recovery: false,    // arrivé par le lien « mot de passe oublié »
    pushTimer: null,
    sentSummary: "",    // derniers stats/résultats envoyés aux amis
  };
  const online = () => navigator.onLine !== false;

  function syncText() {
    if (!L || !account.user) return "";
    if (!online()) return T(account.dirty ? "offlinePending" : "offline");
    if (account.state === "syncing") return T("syncing");
    if (account.state === "error") return T("syncError");
    if (account.syncedAt) return T("syncedAt", account.syncedAt.toLocaleTimeString(L.dateLocale, { hour: "2-digit", minute: "2-digit" }));
    return "";
  }

  function renderAccount() {
    // Pastille sur ⚙️ : hors-ligne ou synchro en échec.
    const badge = $("#sync-badge");
    badge.hidden = !account.user || (online() && account.state !== "error");
    badge.title = syncText();
    $("#btn-friends").hidden = !CFG.url;
    $("#account").hidden = !CFG.url;
    if (!CFG.url || !L) return;
    const ready = !!account.sb;
    $("#account-form").hidden = !ready || !!account.user || account.recovery;
    $("#account-info").hidden = !account.user || account.recovery;
    $("#account-newpass").hidden = !account.recovery;
    if (account.user) $("#account-email").textContent = account.user.email;
    $("#account-status").textContent = account.message || (ready ? syncText() : T("offlineNoAccount"));
    $("#account-status").classList.toggle("warn", !online() || account.state === "error");
  }

  function setMessage(key, ...args) {
    account.message = key ? T(key, ...args) : "";
    renderAccount();
  }

  function schedulePush() {
    if (!account.user) return;
    account.dirty = true;
    account.version++;
    clearTimeout(account.pushTimer);
    account.pushTimer = setTimeout(push, 1500); // on regroupe les sauvegardes rapprochées
  }

  async function push() {
    clearTimeout(account.pushTimer);
    account.pushTimer = null;
    if (!account.user || !online()) return renderAccount(); // renvoyé au retour du réseau
    const version = account.version;
    account.state = "syncing";
    renderAccount();
    const { error } = await account.sb.from("saves")
      .upsert({ user_id: account.user.id, data: store, updated_at: new Date().toISOString() });
    account.state = error ? "error" : "synced";
    if (!error) {
      account.syncedAt = new Date();
      if (account.version === version) account.dirty = false;
    }
    renderAccount();
    if (!error) shareResults();
  }

  async function pull() {
    if (!account.user || !online()) return renderAccount();
    account.state = "syncing";
    renderAccount();
    const { data, error } = await account.sb.from("saves").select("data").eq("user_id", account.user.id).maybeSingle();
    if (error) {
      account.state = "error";
      return renderAccount();
    }
    const merged = withDefaults(G.mergeStores(store, data && data.data));
    merged.lang = store.lang; // on reste dans la langue affichée
    for (const k of Object.keys(store)) delete store[k];
    Object.assign(store, merged);
    writeLocal();
    applyLook();
    if (L && !state.busy) {
      buildKeyboard();
      loadGame();
    }
    if (!$("#modal-settings").hidden) renderSettings();
    await push();
  }

  // ----- Amis : profil, résultats, classement -----
  async function ensureProfile() {
    if (account.profile) return account.profile;
    const id = account.user.id;
    let { data } = await account.sb.from("profiles").select("pseudo, friend_code").eq("user_id", id).maybeSingle();
    if (!data) {
      const pseudo = (account.user.email || "").split("@")[0].slice(0, 20) || "Joueur";
      ({ data } = await account.sb.from("profiles").insert({ user_id: id, pseudo }).select("pseudo, friend_code").single());
    }
    return (account.profile = data || null);
  }

  const langToday = (lang) => G.todayKey(window.LANGS[lang].timeZone);

  /** Envoie le résumé des séries (profil) et les résultats des 7 derniers jours, s'ils ont changé. */
  async function shareResults() {
    const id = account.user.id;
    const stats = {};
    const rows = [];
    for (const lang of Object.keys(window.LANGS)) {
      const games = store[lang].stats;
      const day0 = langToday(lang);
      stats[lang] = G.statsSummary(games, day0);
      for (let i = 0; i < 7; i++) {
        const day = addDays(day0, -i);
        const g = games[day];
        if (g) rows.push({ user_id: id, lang, day, won: !!g.won, guesses: g.n, hard: !!g.hard });
      }
    }
    const summary = JSON.stringify([id, stats, rows]);
    if (summary === account.sentSummary) return;
    if (!(await ensureProfile())) return;
    const [a, b] = await Promise.all([
      rows.length ? account.sb.from("results").upsert(rows) : { error: null },
      account.sb.from("profiles").update({ stats }).eq("user_id", id),
    ]);
    if (!a.error && !b.error) account.sentSummary = summary;
  }

  async function renderFriends() {
    const signedIn = !!account.user;
    $("#friends-signedout").hidden = signedIn;
    $("#friends-body").hidden = !signedIn;
    $("#friends-lang").textContent = state.lang.toUpperCase();
    if (!signedIn) return;
    const status = $("#friends-status");
    const list = $("#friends-list");
    if (!online()) {
      status.textContent = T("offlineFriends");
      return;
    }
    status.textContent = T("loading");
    const profile = await ensureProfile();
    if (!profile) { status.textContent = T("syncError"); return; }
    $("#my-code").textContent = profile.friend_code;
    if (document.activeElement !== $("#pseudo")) $("#pseudo").value = profile.pseudo;

    const me = account.user.id;
    const lang = state.lang;
    const day = langToday(lang);
    const { data: links, error } = await account.sb.from("friends").select("friend_id");
    if (error) { status.textContent = T("syncError"); return; }
    const ids = [me].concat(links.map((l) => l.friend_id));
    const [profiles, results] = await Promise.all([
      account.sb.from("profiles").select("user_id, pseudo, stats").in("user_id", ids),
      account.sb.from("results").select("user_id, won, guesses").eq("lang", lang).eq("day", day).in("user_id", ids),
    ]);
    if (profiles.error || results.error) { status.textContent = T("syncError"); return; }

    // Pour soi, on prend la version locale (toujours à jour, même avant l'envoi).
    const mine = store[lang].stats[day];
    const players = profiles.data.map((p) => p.user_id === me
      ? { id: me, me: true, pseudo: p.pseudo, today: mine ? { won: mine.won, guesses: mine.n } : null, stats: G.statsSummary(store[lang].stats, day) }
      : { id: p.user_id, pseudo: p.pseudo, today: results.data.find((r) => r.user_id === p.user_id) || null, stats: (p.stats || {})[lang] });

    list.innerHTML = "";
    G.rankFriends(players, day).forEach((p, i) => {
      const row = el("div", "friend-row" + (p.me ? " me" : ""));
      const res = !p.today ? el("span", "friend-score none", T("notPlayed"))
        : el("span", "friend-score " + (p.today.won ? "won" : "lost"), (p.today.won ? p.today.guesses : "X") + "/" + NB_ATTEMPTS);
      const name = el("span", "friend-name", p.pseudo);
      if (p.me) name.appendChild(el("small", "", " (" + T("you") + ")"));
      const streak = el("span", "friend-streak", (p.streak ? "🔥 " : "") + p.streak);
      streak.title = T("streakTitle", p.streak, p.maxStreak);
      const rec = el("span", "friend-record", "🏆 " + p.maxStreak);
      rec.title = T("maxStreak");
      row.append(el("span", "friend-rank", i + 1), name, res, streak, rec);
      if (!p.me) {
        const rm = el("button", "friend-remove", "×");
        rm.title = rm.ariaLabel = T("removeFriend", p.pseudo);
        rm.addEventListener("click", async () => {
          if (!confirm(T("removeFriend", p.pseudo) + " ?")) return;
          await account.sb.rpc("remove_friend", { other: p.id });
          renderFriends();
        });
        row.appendChild(rm);
      } else {
        row.appendChild(el("span", "friend-remove"));
      }
      list.appendChild(row);
    });
    status.textContent = players.length < 2 ? T("noFriends") : "";
  }

  $("#friend-add").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#friend-code").value.trim();
    if (!code || !account.user) return;
    const { data, error } = await account.sb.rpc("add_friend", { code });
    if (error) {
      const msg = /code_not_found/.test(error.message) ? "codeNotFound" : /own_code/.test(error.message) ? "ownCode" : "syncError";
      return toast(T(msg), 2500);
    }
    $("#friend-code").value = "";
    toast(T("friendAdded", data), 2000);
    renderFriends();
  });

  $("#pseudo-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pseudo = $("#pseudo").value.trim().slice(0, 20);
    if (!pseudo || !account.user) return;
    const { error } = await account.sb.from("profiles").update({ pseudo }).eq("user_id", account.user.id);
    if (error) return toast(T("syncError"), 2500);
    account.profile.pseudo = pseudo;
    toast(T("saved"));
    renderFriends();
  });

  $("#btn-copy-code").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("#my-code").textContent); toast(T("codeCopied")); }
    catch (e) { toast(T("copyFail")); }
  });
  $("#friends-goto-account").addEventListener("click", () => {
    openModal("settings");
    $("#account").scrollIntoView();
  });

  // ----- Connexion -----
  async function initAccount() {
    if (!CFG.url || !CFG.anonKey || account.sb) return; // pas configuré : jeu 100 % local
    try {
      await loadScript("assets/js/vendor/supabase.min.js");
    } catch (e) {
      return renderAccount(); // hors-ligne au démarrage : on réessaiera au retour du réseau
    }
    account.sb = window.supabase.createClient(CFG.url, CFG.anonKey);
    account.sb.auth.onAuthStateChange((event, session) => {
      const user = session ? session.user : null;
      const changed = (user && user.id) !== (account.user && account.user.id);
      account.user = user;
      if (event === "PASSWORD_RECOVERY") {
        account.recovery = true;
        if (L) setTimeout(() => openModal("settings"), 0);
      }
      if (!user) Object.assign(account, { profile: null, dirty: false, syncedAt: null, state: "idle", sentSummary: "" });
      // (pas d'appel Supabase directement dans ce callback : on décale)
      if (changed && user) setTimeout(pull, 0);
      renderAccount();
    });
    renderAccount();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") pull();
    else if (account.pushTimer) push(); // on envoie avant que la page parte en arrière-plan
  });
  window.addEventListener("online", () => {
    initAccount();
    if (account.user) { toast(T("backOnline"), 2000); pull(); }
    renderAccount();
  });
  window.addEventListener("offline", () => {
    if (account.user && L) toast(T("wentOffline"), 3000);
    renderAccount();
  });

  function lockForm(form, locked) { $$(`#${form} button, #${form} input`).forEach((b) => (b.disabled = locked)); }

  function showAuthError(error) {
    const known = {
      invalid_credentials: "badLogin", user_already_exists: "alreadyUser", weak_password: "weakPassword",
      over_email_send_rate_limit: "tooManyEmails", email_provider_disabled: "emailDisabled", signup_disabled: "emailDisabled",
    };
    if (error.name === "AuthRetryableFetchError" || !online()) setMessage("offlineNoAccount");
    else if (known[error.code]) setMessage(known[error.code]);
    else { account.message = error.message; renderAccount(); }
  }

  $("#account-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!account.sb) return;
    const signUp = e.submitter && e.submitter.dataset.mode === "up";
    const creds = { email: $("#acc-email").value.trim(), password: $("#acc-password").value };
    lockForm("account-form", true);
    setMessage("signingIn");
    const { data, error } = signUp ? await account.sb.auth.signUp(creds) : await account.sb.auth.signInWithPassword(creds);
    lockForm("account-form", false);
    if (error) return showAuthError(error);
    if (signUp && !data.session) return setMessage("confirmOn"); // « Confirm email » encore activé
    $("#acc-password").value = "";
    setMessage("");
  });

  $("#btn-forgot").addEventListener("click", async () => {
    const email = $("#acc-email").value.trim();
    if (!email) { setMessage("enterEmail"); return $("#acc-email").focus(); }
    lockForm("account-form", true);
    const { error } = await account.sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    lockForm("account-form", false);
    if (error) return showAuthError(error);
    setMessage("resetSent");
  });

  $("#account-newpass").addEventListener("submit", async (e) => {
    e.preventDefault();
    lockForm("account-newpass", true);
    const { error } = await account.sb.auth.updateUser({ password: $("#acc-newpass").value });
    lockForm("account-newpass", false);
    if (error) return showAuthError(error);
    $("#acc-newpass").value = "";
    account.recovery = false;
    setMessage("passwordChanged");
  });

  $("#btn-signout").addEventListener("click", async () => {
    if (account.pushTimer) await push();
    await account.sb.auth.signOut(); // les données restent sur cet appareil
    setMessage("");
  });

  // ---------- Archives ----------
  $("#btn-archives").addEventListener("click", () => {
    if (state.busy) return;
    state.archive = !state.archive;
    state.date = state.archive ? addDays(today(), -1) : today();
    loadGame();
  });
  const goArchive = (k) => {
    if (state.busy || !k || k < L.firstDay || k > addDays(today(), -1)) return;
    state.date = k;
    loadGame();
  };
  $("#archive-prev").addEventListener("click", () => goArchive(addDays(state.date, -1)));
  $("#archive-next").addEventListener("click", () => goArchive(addDays(state.date, 1)));
  $("#archive-date-input").addEventListener("change", (e) => goArchive(e.target.value));

  // ---------- Langue ----------
  function applyTexts() {
    document.documentElement.lang = L.htmlLang;
    document.title = L.docTitle;
    $$("[data-i18n]").forEach((e) => (e.textContent = T(e.dataset.i18n)));
    $$("[data-i18n-html]").forEach((e) => (e.innerHTML = T(e.dataset.i18nHtml)));
    $$("[data-i18n-placeholder]").forEach((e) => (e.placeholder = T(e.dataset.i18nPlaceholder)));
    $$("[data-i18n-title]").forEach((e) => { e.title = T(e.dataset.i18nTitle); e.setAttribute("aria-label", e.title); });
    $("#btn-lang").textContent = state.lang.toUpperCase();

    // Titre en cases colorées
    const title = $("#game-title");
    title.innerHTML = "";
    L.title.forEach(([ch, cls]) => title.appendChild(ch === " " ? el("span", "gap") : el("span", "tile " + (cls || ""), ch)));

    // Aide : {{ex:MOT:position:couleur}} → exemple en cases
    $("#help-content").innerHTML = T("helpHtml").replace(/\{\{ex:(\w+):(\d):(\w+)\}\}/g, (_, word, pos, cls) =>
      `<div class="example">${[...word].map((ch, i) => `<span class="tile filled ${i === +pos ? cls : ""}">${ch}</span>`).join("")}</div>`);
  }

  let langRequest = 0;
  async function setLang(lang) {
    if (!window.LANGS[lang]) return;
    const req = ++langRequest;
    try {
      await loadWords(lang);
    } catch (e) {
      alert("Impossible de charger les mots / Could not load word list.");
      return;
    }
    if (req !== langRequest) return; // un autre choix a été fait entre-temps

    state.lang = store.lang = lang;
    L = window.LANGS[lang];
    save();
    state.archive = false;
    state.date = today();
    applyTexts();
    buildKeyboard();
    $("#lang-picker").hidden = true;
    $("#game").hidden = false;
    closeModals();
    loadGame();
    tick();
    if (location.hash !== "#" + lang && !location.hash.includes("=")) history.replaceState(null, "", "#" + lang);
  }

  function showPicker() {
    closeModals();
    $("#game").hidden = true;
    $("#lang-picker").hidden = false;
  }

  $$("[data-lang]").forEach((b) => b.addEventListener("click", () => setLang(b.dataset.lang)));
  $("#btn-lang").addEventListener("click", showPicker);
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (window.LANGS[h] && h !== state.lang) setLang(h);
  });

  // ---------- Démarrage ----------
  buildGrid();
  applyLook();
  const fromHash = location.hash.slice(1);
  if (window.LANGS[fromHash]) setLang(fromHash);
  else if (store.lang && window.LANGS[store.lang]) setLang(store.lang);
  else showPicker();
  initAccount();

  // Mode hors-ligne (seulement si le site est servi en http/https)
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
