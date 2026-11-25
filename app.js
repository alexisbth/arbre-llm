/* arbre-llm — proof of concept (POC), v3
 *
 * Overall approach
 * 1. Data: a flat list of nodes { id, parent, q, a, kw, sum, ico }.
 *    q = question, a = answer, kw = keyword, sum = short summary, ico = optional emoji.
 *    The "parent" field alone describes the whole tree.
 * 2. Merging: a group is a connected list of nodes, displayed as a single box.
 *    So we first compute the "visible" tree, whose boxes (units) are nodes or groups.
 * 3. Layout: y = depth; x = leaf rank, each parent centred above its children.
 * 4. Drawing: an SVG rebuilt on every change, with an arrow at the end of each link.
 * 5. Gestures: drag = pan, pinch or wheel = zoom, tap = select (or expand a group).
 * 6. Panel: conversation thread, compact context sent to the LLM, token gauges.
 * 7. LLM: with an Anthropic API key (kept on the device), the question is sent to Claude with the
 *    compact context; the answer streams in, then a small model fills in the node's card
 *    (keyword, emoji, summary). Without a key: simulated answers (demo mode).
 * Security: all text is inserted with textContent (never innerHTML), no third-party script.
 */
{
  // ---------- Settings ----------
  const NB_ECHANGES_COMPLETS = 2;      // last exchanges of the path sent in full to the LLM
  const CARACTERES_PAR_TOKEN = 4;      // rough estimate: 1 token ≈ 4 characters
  const FENETRES = [200000, 128000, 32000, 100];    // context sizes offered (100: tiny, to see the alert in the demo)
  const SEUIL_ALERTE = 0.8;            // share of the window above which the gauge turns orange
  const ECART_X = 160;                 // horizontal gap between two leaves (px)
  const ECART_Y = 100;                 // vertical gap between two levels (px)
  const LARGEUR_NOEUD = 140;
  const HAUTEUR_NOEUD = 40;
  const RECUL_FLECHE = 7;              // the line stops before the box to leave room for the arrowhead
  const DECALAGE_PILE = 5;             // offset of a group's "shadow" box
  const LONGUEUR_MOT_CLE = 14;         // characters shown in a box
  const LONGUEUR_RESUME = 90;
  const ZOOM_MIN = 0.2, ZOOM_MAX = 3, ZOOM_MAX_CADRAGE = 1.2;
  const SENSIBILITE_MOLETTE = 0.0015;
  const SEUIL_TOUCHER = 8;             // px: below this, the gesture is a tap, not a drag
  const DELAI_REPONSE_SIMULEE = 600;   // ms
  const DELAI_CONFIRMATION = 3000;     // ms
  const DUREE_TOAST = 2200;            // ms
  const CLE_STOCKAGE = 'arbre-llm-v2';
  const RACINE = 'racine';
  const SELECTION_INITIALE = 'n3';

  // ---------- LLM: Claude through the Anthropic API ----------
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2026-10-21';
  const MODELES = [                    // [id, label]; the first one is the default model
    ['claude-sonnet-5-5', 'Sonnet 5.5 (équilibré)'],
    ['claude-haiku-5-5', 'Haiku 5.5 (rapide, économique)'],
    ['claude-opus-5-5', 'Opus 5.5 (le plus puissant)'],
  ];
  const MODELE_FICHE = 'claude-haiku-5-5';   // small model for the keyword, emoji and summary
  const MAX_TOKENS_REPONSE = 4096;
  const MAX_TOKENS_FICHE = 300;
  const LONGUEUR_MAX_FICHE = 6000;     // characters of the answer sent to build the card
  const LONGUEUR_MOT_CLE_MAX = 30;     // characters kept for an LLM-generated keyword
  const CLE_REGLAGES = 'arbre-llm-reglages';
  const CONSIGNE = "Tu réponds dans une application de conversation en arbre. Réponds dans la langue de la question, " +
    "en texte brut, sans Markdown ni LaTeX : écris les formules en notation lisible (Unicode) et définis chaque notation.";

  // ---------- Example tree (hand-written answers) ----------
  const EXEMPLE = [
    { id: RACINE, parent: null, ico: '🌱', kw: 'Début', q: '', a: '', sum: 'Début de la conversation.' },
    { id: 'n1', parent: RACINE, ico: '⚖️', kw: 'CVA', q: "Qu'est-ce que la CVA ?",
      a: "La CVA (Credit Valuation Adjustment) est l'ajustement de valeur d'un portefeuille de dérivés lié au risque de défaut de la contrepartie : c'est le prix de ce risque.",
      sum: 'Définition : la CVA est le prix du risque de défaut de la contrepartie.' },
    { id: 'n2', parent: 'n1', ico: '🧮', kw: 'Calcul CVA', q: 'Comment la calcule-t-on ?',
      a: "CVA = (1 − R) × Σᵢ EE(tᵢ) × PD(tᵢ₋₁, tᵢ) × DF(tᵢ)\nR : taux de recouvrement ; EE(tᵢ) : exposition attendue à la date tᵢ ; PD(tᵢ₋₁, tᵢ) : probabilité de défaut entre tᵢ₋₁ et tᵢ ; DF(tᵢ) : facteur d'actualisation.",
      sum: 'Formule discrète : recouvrement, exposition attendue, probabilités de défaut, actualisation.' },
    { id: 'n3', parent: 'n2', ico: '🎲', kw: 'Monte Carlo', q: "Comment obtenir l'exposition attendue ?",
      a: "On simule les facteurs de marché sur une grille de dates, on revalorise le portefeuille dans chaque scénario, puis on fait la moyenne de la partie positive des valeurs.",
      sum: 'EE par Monte Carlo : diffusion, revalorisation, moyenne des expositions positives.' },
    { id: 'n4', parent: 'n2', ico: '🛡️', kw: 'Collatéral', q: 'Et avec un collatéral ?',
      a: "Le collatéral réduit l'exposition. Il reste un risque pendant le délai de marge (MPoR, Margin Period of Risk), durant lequel l'exposition évolue sans appel de marge.",
      sum: "Le collatéral réduit l'EE ; le MPoR laisse un risque résiduel." },
    { id: 'n5', parent: 'n1', ico: '🪞', kw: 'DVA', q: 'Quelle différence avec la DVA ?',
      a: "La DVA est le symétrique de la CVA : elle valorise le risque de son propre défaut.",
      sum: 'DVA : symétrique de la CVA, liée à son propre défaut.' },
    { id: 'n6', parent: RACINE, ico: '🎓', kw: 'Cours', q: "Peux-tu m'aider à préparer un cours ?",
      a: "Oui : donne-moi le public, la durée et les prérequis, et je te propose un plan.",
      sum: 'Préparation de cours : public, durée, prérequis demandés.' },
    { id: 'n7', parent: 'n6', ico: '🗂️', kw: 'Plan XVA', q: 'Master 2, trois heures, sur les XVA.',
      a: "1) Pourquoi les XVA depuis 2008. 2) CVA et DVA, avec un exemple chiffré. 3) FVA, KVA, MVA et leurs débats.",
      sum: 'Plan XVA en trois parties pour un master 2.' },
  ];

  // Temporary icons for new questions: word stem (without accents) → emoji.
  // With an API key, the emoji is then replaced by the one the LLM chooses.
  const ICONES = [
    ['arbre', '🌳'], ['foret', '🌲'], ['cours', '🎓'], ['ecole', '🎓'], ['etudiant', '🎓'], ['banque', '🏦'],
    ['argent', '💶'], ['prix', '💶'], ['cout', '💶'], ['risque', '⚠️'], ['calcul', '🧮'], ['formule', '🧮'],
    ['date', '📅'], ['temps', '⏱️'], ['code', '💻'], ['programm', '💻'], ['donnee', '📊'], ['graph', '📈'],
    ['marche', '📈'], ['securite', '🔒'], ['chiffr', '🔒'], ['train', '🚂'], ['locomotive', '🚂'],
    ['voiture', '🚗'], ['livre', '📚'], ['musique', '🎵'], ['recette', '🍳'], ['cuisine', '🍳'],
    ['voyage', '✈️'], ['maison', '🏠'], ['climat', '🌍'], ['carbone', '🌍'], ['energie', '⚡'],
    ['robot', '🤖'], ['llm', '🤖'], ['ia', '🤖'], ['couvr', '☂️'], ['assurance', '☂️'], ['contrat', '📝'],
    ['mail', '✉️'],
  ];

  // ---------- Helpers ----------
  const $ = id => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const copie = x => JSON.parse(JSON.stringify(x));
  const abreger = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const sansAccents = s => s.normalize('NFD').replace(/\p{M}/gu, '');
  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const etiquette = n => (n.ico ? n.ico + ' ' : '') + n.kw;
  const formatCompact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });
  function svgEl(nom, attrs) {
    const e = document.createElementNS(SVGNS, nom);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function htmlEl(nom, classe, texte) {
    const e = document.createElement(nom);
    if (classe) e.className = classe;
    if (texte != null) e.textContent = texte;
    return e;
  }
  let minuteurToast;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(minuteurToast);
    minuteurToast = setTimeout(() => t.classList.remove('on'), DUREE_TOAST);
  }

  // ---------- Local storage (stays on the device) ----------
  function charger() {
    try {
      const e = JSON.parse(localStorage.getItem(CLE_STOCKAGE));
      if (e && Array.isArray(e.noeuds) && e.noeuds.some(n => n.id === RACINE)) return e;
    } catch { /* storage unavailable: start again from the example */ }
    return null;
  }
  function sauver() {
    try { localStorage.setItem(CLE_STOCKAGE, JSON.stringify({ noeuds, selection, groupes, fenetre })); } catch { /* ignored */ }
  }

  // ---------- State ----------
  const etat = charger() || {};
  let noeuds = etat.noeuds || copie(EXEMPLE);
  let selection = etat.selection || SELECTION_INITIALE;
  let groupes = etat.groupes || [];            // [{ id, membres: [ids of the merged nodes] }]
  let fenetre = FENETRES.includes(etat.fenetre) ? etat.fenetre : FENETRES[0];
  for (const n of noeuds) {                    // answer cut off because the app was closed
    if (n.enCours) Object.assign(n, { enCours: false, erreur: true, a: n.a || 'Réponse interrompue.' });
  }
  let modeSelection = false;
  const choixFusion = new Set();               // boxes tapped in selection mode
  const vue = { x: 0, y: 0, k: 1 };            // translation (x, y) and scale k of the map
  let S, P;                                    // visible tree and positions, recomputed on every draw

  // ---------- Reading the tree ----------
  const noeud = id => noeuds.find(n => n.id === id);
  const enfants = id => noeuds.filter(n => n.parent === id);
  function chemin(id) {                        // nodes from the root down to id
    const c = [];
    for (let n = noeud(id); n; n = noeud(n.parent)) c.unshift(n);
    return c;
  }
  if (!noeud(selection)) selection = RACINE;

  // Visible tree: each node belongs to a box (itself, or the group that contains it)
  function structure() {
    const groupeDe = {};
    for (const g of groupes) for (const m of g.membres) groupeDe[m] = g;
    const unite = id => (groupeDe[id] ? groupeDe[id].id : id);
    const unites = new Map();                  // box id → { id, rep, groupe, parent }
    for (const n of noeuds) {
      const g = groupeDe[n.id];
      const sommet = !g || !g.membres.includes(n.parent);   // topmost node of its group
      if (sommet) unites.set(unite(n.id), { id: unite(n.id), rep: n, groupe: g || null, parent: n.parent == null ? null : unite(n.parent) });
    }
    const enfantsU = {};
    for (const u of unites.values()) if (u.parent != null) (enfantsU[u.parent] ||= []).push(u.id);
    return { unite, unites, enfantsU };
  }

  // ---------- Layout ----------
  function disposer(s) {
    const pos = {};
    let feuille = 0;
    (function placer(u, profondeur) {
      const k = s.enfantsU[u] || [];
      k.forEach(e => placer(e, profondeur + 1));
      const x = k.length ? (pos[k[0]].x + pos[k[k.length - 1]].x) / 2 : (feuille++) * ECART_X;
      pos[u] = { x, y: profondeur * ECART_Y };
    })(s.unite(RACINE), 0);
    return pos;
  }

  // ---------- Drawing the map ----------
  function dessiner() {
    S = structure();
    P = disposer(S);
    const surChemin = new Set(chemin(selection).map(n => S.unite(n.id)));
    const uChoisie = S.unite(selection);
    const aFusionner = modeSelection ? completer() : new Set();
    const calque = $('calque');
    calque.textContent = '';

    const liens = [...S.unites.values()].filter(u => u.parent != null)
      .sort((a, b) => surChemin.has(a.id) - surChemin.has(b.id));
    for (const u of liens) {
      const a = P[u.parent], b = P[u.id];
      const y0 = a.y + HAUTEUR_NOEUD / 2, y1 = b.y - HAUTEUR_NOEUD / 2 - RECUL_FLECHE, my = (y0 + y1) / 2;
      const actif = surChemin.has(u.id);
      calque.append(svgEl('path', {
        d: `M${a.x},${y0} C${a.x},${my} ${b.x},${my} ${b.x},${y1}`,
        class: actif ? 'lien actif' : 'lien',
        'marker-end': actif ? 'url(#fleche-actif)' : 'url(#fleche)',
      }));
    }

    const L = LARGEUR_NOEUD, H = HAUTEUR_NOEUD;
    for (const u of S.unites.values()) {
      const membres = u.groupe ? u.groupe.membres : [u.id];
      const classes = ['noeud'];
      if (membres.includes(RACINE)) classes.push('racine');
      if (u.groupe) classes.push('groupe');
      if (u.id === uChoisie) classes.push('choisi');
      else if (surChemin.has(u.id)) classes.push('chemin');
      if (membres.some(m => aFusionner.has(m))) classes.push('coche', ...(membres.some(m => choixFusion.has(m)) ? [] : ['auto']));
      const g = svgEl('g', { class: classes.join(' '), transform: `translate(${P[u.id].x},${P[u.id].y})`, 'data-id': u.id });
      if (u.groupe) g.append(svgEl('rect', { class: 'pile', x: -L / 2 + DECALAGE_PILE, y: -H / 2 + DECALAGE_PILE, width: L, height: H, rx: H / 2 }));
      g.append(svgEl('rect', { class: 'fond', x: -L / 2, y: -H / 2, width: L, height: H, rx: H / 2 }));
      const t = svgEl('text', { 'text-anchor': 'middle', dy: '0.35em' });
      t.textContent = (u.rep.ico ? u.rep.ico + ' ' : '') + abreger(u.rep.kw, LONGUEUR_MOT_CLE);
      const titre = svgEl('title', {});
      titre.textContent = u.groupe ? membres.map(m => noeud(m).kw).join(' → ') : u.rep.kw;
      g.append(t, titre);
      if (u.groupe) {                          // "+N" badge: number of hidden boxes
        g.append(svgEl('circle', { class: 'badge', cx: L / 2 - 4, cy: -H / 2 + 2, r: 13 }));
        const nb = svgEl('text', { class: 'nb', x: L / 2 - 4, y: -H / 2 + 2, 'text-anchor': 'middle', dy: '0.35em' });
        nb.textContent = '+' + (membres.length - 1);
        g.append(nb);
      }
      calque.append(g);
    }
    appliquerVue();
    remplirPanneau();
  }
  function appliquerVue() {
    $('calque').setAttribute('transform', `translate(${vue.x},${vue.y}) scale(${vue.k})`);
  }

  // Map area not covered by the top bar and the panel
  function zoneVisible() {
    const haut = $('barre').getBoundingClientRect().bottom;
    const p = $('panneau').getBoundingClientRect();
    const lateral = p.top <= haut + 1;          // large screen: panel on the right
    return lateral ? { haut, w: p.left, h: innerHeight - haut } : { haut, w: innerWidth, h: p.top - haut };
  }
  function cadrer() {                           // whole tree visible
    const pos = Object.values(P);
    const xs = pos.map(p => p.x), ys = pos.map(p => p.y);
    const x0 = Math.min(...xs) - LARGEUR_NOEUD, x1 = Math.max(...xs) + LARGEUR_NOEUD;
    const y0 = Math.min(...ys) - HAUTEUR_NOEUD, y1 = Math.max(...ys) + HAUTEUR_NOEUD;
    const z = zoneVisible();
    vue.k = Math.min(z.w / (x1 - x0), z.h / (y1 - y0), ZOOM_MAX_CADRAGE);
    vue.x = (z.w - (x0 + x1) * vue.k) / 2;
    vue.y = z.haut + (z.h - (y0 + y1) * vue.k) / 2;
    appliquerVue();
  }
  function centrerSur(id) {
    const p = P[S.unite(id)], z = zoneVisible();
    vue.x = z.w / 2 - p.x * vue.k;
    vue.y = z.haut + z.h / 2 - p.y * vue.k;
    appliquerVue();
  }
  function estVisible(id) {                     // is the box in the uncovered part of the screen?
    const p = P[S.unite(id)], z = zoneVisible();
    const sx = p.x * vue.k + vue.x, sy = p.y * vue.k + vue.y;
    return sx > 0 && sx < z.w && sy > z.haut && sy < z.haut + z.h;
  }
  function zoomerAutour(cx, cy, facteur) {      // zoom while keeping point (cx, cy) fixed on screen
    const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, vue.k * facteur));
    const f = k / vue.k;
    vue.x = cx - (cx - vue.x) * f;
    vue.y = cy - (cy - vue.y) * f;
    vue.k = k;
  }

  // ---------- Gestures on the map ----------
  const svg = $('carte');
  const pointeurs = new Map();                  // fingers (or mouse) currently down
  let depart = null, pincement = null;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const milieu = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  svg.addEventListener('pointerdown', e => {
    const cible = e.target.closest('[data-id]');
    svg.setPointerCapture(e.pointerId);
    pointeurs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointeurs.size === 1) depart = { x: e.clientX, y: e.clientY, cible, bouge: false };
    if (pointeurs.size === 2) {
      const [a, b] = [...pointeurs.values()];
      pincement = { d: distance(a, b), m: milieu(a, b) };
      if (depart) depart.bouge = true;
    }
  });
  svg.addEventListener('pointermove', e => {
    const avant = pointeurs.get(e.pointerId);
    if (!avant) return;
    const apres = { x: e.clientX, y: e.clientY };
    pointeurs.set(e.pointerId, apres);
    if (pointeurs.size === 1) {
      vue.x += apres.x - avant.x;
      vue.y += apres.y - avant.y;
      if (depart && distance(apres, depart) > SEUIL_TOUCHER) depart.bouge = true;
    } else if (pointeurs.size === 2 && pincement) {
      const [a, b] = [...pointeurs.values()];
      const d = distance(a, b), m = milieu(a, b);
      zoomerAutour(m.x, m.y, d / pincement.d);
      vue.x += m.x - pincement.m.x;
      vue.y += m.y - pincement.m.y;
      pincement = { d, m };
    }
    appliquerVue();
  });
  function relacher(e) {
    if (!pointeurs.delete(e.pointerId)) return;
    if (pointeurs.size < 2) pincement = null;
    if (pointeurs.size === 0) {
      if (depart && !depart.bouge && depart.cible) toucher(depart.cible.getAttribute('data-id'));
      depart = null;
    }
  }
  svg.addEventListener('pointerup', relacher);
  svg.addEventListener('pointercancel', relacher);
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    zoomerAutour(e.clientX, e.clientY, Math.exp(-e.deltaY * SENSIBILITE_MOLETTE));
    appliquerVue();
  }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());   // Safari: block page zoom

  // Tapping a box: select it, expand a group, or tick it in selection mode
  function toucher(idCase) {
    const u = S.unites.get(idCase);
    if (!u) return;
    if (modeSelection) {
      const ids = u.groupe ? u.groupe.membres : [u.id];
      const dejaCoches = ids.every(i => choixFusion.has(i));
      ids.forEach(i => (dejaCoches ? choixFusion.delete(i) : choixFusion.add(i)));
      majBoutonFusion();
      dessiner();
      return;
    }
    if (u.groupe) { eclater(u.groupe.id); return; }
    choisir(u.id, false);
  }

  // ---------- Selecting a node ----------
  function choisir(id, recentrer) {
    selection = id;
    sauver();
    dessiner();
    if (recentrer || !estVisible(id)) centrerSur(id);
  }

  // ---------- Merging and expanding ----------
  // Adds to the ticked boxes the ones that connect them: start from their lowest common
  // ancestor and add every node on the paths leading down from it to them.
  function completer() {
    const chemins = [...choixFusion].filter(noeud).map(id => chemin(id).map(n => n.id));
    if (!chemins.length) return new Set();
    let k = 0;                                  // length of the prefix shared by all paths
    while (chemins.every(c => k < c.length && c[k] === chemins[0][k])) k++;
    const groupe = new Set();
    for (const c of chemins) c.slice(k - 1).forEach(id => groupe.add(id));
    return groupe;
  }
  function majBoutonFusion() {
    $('b-fusionner').textContent = `Fusionner (${completer().size})`;
  }
  function passerEnSelection(actif) {
    modeSelection = actif;
    choixFusion.clear();
    document.body.classList.toggle('mode-selection', actif);
    $('sous-titre').textContent = actif ? 'Touche les cases à fusionner' : libelleMode();
    fermerMenu();
    majBoutonFusion();
    dessiner();
  }
  function fusionner() {
    const membres = completer();
    if (membres.size < 2) { toast('Choisis au moins deux cases.'); return; }
    const autres = [];
    for (const g of groupes) {                  // an existing group that touches the selection is absorbed
      if (g.membres.some(m => membres.has(m))) g.membres.forEach(m => membres.add(m));
      else autres.push(g);
    }
    groupes = [...autres, { id: 'g' + nouvelId(), membres: [...membres] }];
    sauver();
    passerEnSelection(false);
    toast(`${membres.size} cases fusionnées. Touche la case pour l'éclater.`);
  }
  function eclater(idGroupe) {
    groupes = groupes.filter(g => g.id !== idGroupe);
    sauver();
    dessiner();
    toast('Case éclatée');
  }

  // ---------- Panel: thread, context, gauges ----------
  function remplirPanneau() {
    const n = noeud(selection);
    $('p-kw').textContent = etiquette(n);
    $('p-sum').textContent = n.id === RACINE ? 'Pose une première question pour démarrer une nouvelle branche.' : n.sum;
    $('question').placeholder = `Après « ${abreger(n.kw, LONGUEUR_MOT_CLE)} »…`;

    const c = chemin(selection).filter(m => m.id !== RACINE);
    const fil = $('fil');
    fil.textContent = '';
    if (!c.length) fil.append(htmlEl('p', 'vide', 'Aucun échange sur ce chemin pour le moment.'));
    c.forEach((m, i) => {
      if (i > 0) fil.append(htmlEl('div', 'fleche-fil', '↓'));
      const bloc = htmlEl('article', 'echange' + (m.id === selection ? ' courant' : '') + (m.erreur ? ' erreur' : ''));
      bloc.dataset.id = m.id;
      bloc.append(htmlEl('p', 'kw', etiquette(m)), htmlEl('p', 'q', m.q), htmlEl('p', 'a', texteReponse(m)));
      if (m.erreur) {
        const b = htmlEl('button', 'reessayer', 'Réessayer');
        b.type = 'button';
        b.dataset.reessayer = m.id;
        bloc.append(b);
      }
      fil.append(bloc);
    });
    const suites = enfants(selection);
    if (suites.length) {
      const d = htmlEl('div', 'suites');
      d.append(htmlEl('p', null, 'Suites déjà explorées depuis ce nœud :'));
      for (const s of suites) {
        const b = htmlEl('button', null, etiquette(s));
        b.type = 'button';
        b.dataset.id = s.id;
        d.append(b);
      }
      fil.append(d);
    }
    requestAnimationFrame(() => fil.querySelector('.courant')?.scrollIntoView({ block: 'nearest' }));
    remplirContexte(c);
    remplirJauges(c);
  }

  const texteReponse = n => n.a || (n.enCours ? 'Réponse en cours…' : '');
  const tokens = nbCar => Math.ceil(nbCar / CARACTERES_PAR_TOKEN);
  const somme = (liste, f) => liste.reduce((s, n) => s + f(n), 0);
  const tailleEchange = n => n.q.length + n.a.length;
  // Tokens of an exchange: actual answer count returned by the API when known, otherwise an estimate
  const tokensEchange = n => (n.usage ? tokens(n.q.length) + n.usage.sortie : tokens(tailleEchange(n)));

  // Splits a path: earlier steps (summary only) and the last NB_ECHANGES_COMPLETS exchanges
  function decouper(c) {
    const coupe = Math.max(0, c.length - NB_ECHANGES_COMPLETS);
    return { resumes: c.slice(0, coupe), complets: c.slice(coupe) };
  }

  // Compact context: summary of earlier steps + the last NB_ECHANGES_COMPLETS exchanges in full
  function remplirContexte(c) {
    const ctx = $('ctx');
    ctx.textContent = '';
    if (!c.length) {
      ctx.append(htmlEl('p', 'vide', 'Rien à envoyer : une question posée ici partira sans contexte.'));
      return;
    }
    const { resumes, complets } = decouper(c);
    const compact = somme(resumes, n => n.kw.length + n.sum.length) + somme(complets, tailleEchange);
    const complet = somme(c, tailleEchange);

    const stat = htmlEl('div', 'stat');
    const chiffre = htmlEl('p', 'chiffre');
    chiffre.append(htmlEl('mark', null, `≈ ${tokens(compact)} tokens`));
    stat.append(chiffre, htmlEl('p', null,
      `envoyés au LLM pour une question posée ici, contre ≈ ${tokens(complet)} tokens pour tout le chemin en entier (${c.length} échange${c.length > 1 ? 's' : ''}).`));
    ctx.append(stat);

    if (resumes.length) {
      ctx.append(htmlEl('h3', null, 'Étapes anciennes : résumé seulement'));
      const ul = htmlEl('ul');
      for (const n of resumes) ul.append(htmlEl('li', null, `${etiquette(n)} : ${n.sum}`));
      ctx.append(ul);
    }
    const pl = complets.length > 1 ? 's' : '';
    ctx.append(htmlEl('h3', null, `Dernier${pl} échange${pl} : en entier`));
    complets.forEach((n, i) => {
      if (i > 0) ctx.append(htmlEl('div', 'fleche-fil', '↓'));
      const b = htmlEl('div', 'echange');
      b.append(htmlEl('p', 'q', n.q), htmlEl('p', 'a', n.a));
      ctx.append(b);
    });
    ctx.append(htmlEl('p', 'note',
      `Règle : les ${NB_ECHANGES_COMPLETS} derniers échanges en entier, le résumé des précédents, rien des branches voisines. Estimation : 1 token ≈ ${CARACTERES_PAR_TOKEN} caractères.`));
  }

  // Two gauges: tokens of the current path and of the whole tree, relative to the model's window
  function remplirJauges(c) {
    const ratioChemin = majJauge('j-chemin', somme(c, tokensEchange));
    majJauge('j-arbre', somme(noeuds, tokensEchange));
    $('b-repartir').hidden = !(ratioChemin >= SEUIL_ALERTE && c.length > 0);
  }
  function majJauge(id, nbTokens) {
    const ratio = nbTokens / fenetre;
    const j = $(id);
    j.querySelector('i').style.width = Math.min(100, ratio * 100) + '%';
    j.querySelector('.val').textContent = `${formatCompact.format(nbTokens)} / ${formatCompact.format(fenetre)}`;
    j.classList.toggle('alerte', ratio >= SEUIL_ALERTE);
    return ratio;
  }
  $('jauges').addEventListener('click', () => {
    fenetre = FENETRES[(FENETRES.indexOf(fenetre) + 1) % FENETRES.length];
    sauver();
    remplirPanneau();
    toast(`Contexte maximal du modèle : ${formatCompact.format(fenetre)} tokens`);
  });

  // Restart from the summary: a new conversation whose starting point is the path's summary
  $('b-repartir').addEventListener('click', () => {
    const origine = noeud(selection);
    const c = chemin(selection).filter(m => m.id !== RACINE);
    const n = { id: 'n' + nouvelId(), parent: RACINE, ico: '♻️', kw: 'Reprise',
      q: `Reprise de « ${origine.kw} » dans une nouvelle conversation`,
      a: c.map(m => `${etiquette(m)} : ${m.sum}`).join('\n'),
      sum: `Nouvelle conversation qui part du résumé de « ${origine.kw} ».` };
    noeuds.push(n);
    choisir(n.id, true);
    toast('Nouvelle conversation créée à partir du résumé');
  });

  $('fil').addEventListener('click', e => {
    const r = e.target.closest('[data-reessayer]');
    if (r) { repondre(noeud(r.dataset.reessayer)); return; }
    const c = e.target.closest('[data-id]');
    if (c) choisir(c.dataset.id, true);
  });
  $('poignee').addEventListener('click', () => {
    const ouvert = $('panneau').classList.toggle('replie') === false;
    $('poignee').setAttribute('aria-expanded', String(ouvert));
    centrerSur(selection);
    if (ouvert) requestAnimationFrame(() => $('fil').querySelector('.courant')?.scrollIntoView({ block: 'nearest' }));
  });
  document.querySelectorAll('[data-onglet]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-onglet]').forEach(o => {
      const actif = o === b;
      o.setAttribute('aria-selected', String(actif));
      $(o.dataset.onglet).hidden = !actif;
    });
  }));

  // ---------- New question ----------
  const MOTS_VIDES = new Set(['comment', 'pourquoi', 'quelle', 'quelles', 'quels', 'quel', 'dans', 'avec',
    'pour', 'sans', 'faire', 'peux', 'peut', 'cette', 'entre', 'sont', 'what', 'with', 'that', 'this', 'does', 'from']);
  function motCle(q) {                // temporary: the longest meaningful word (replaced by the LLM's card)
    const mots = q.match(/[\p{L}\p{N}'-]+/gu) || [];
    const m = mots.filter(w => w.length >= 4 && !MOTS_VIDES.has(w.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0] || mots[0] || 'Question';
    return m[0].toUpperCase() + m.slice(1);
  }
  function icone(q) {                 // temporary: first word found in ICONES, otherwise no icon
    const mots = sansAccents(q.toLowerCase()).match(/[a-z0-9]+/g) || [];
    for (const [racine, ico] of ICONES) {
      if (mots.some(m => (racine.length <= 3 ? m === racine : m.startsWith(racine)))) return ico;
    }
    return '';
  }
  const reponseSimulee = q => `Mode démo : réponse simulée à « ${q} ».\nPour de vraies réponses, ajoute ta clé API Anthropic dans ⋯ → Réglages du LLM.`;

  const champ = $('question');
  champ.addEventListener('input', () => {
    champ.style.height = 'auto';
    champ.style.height = champ.scrollHeight + 'px';
  });
  champ.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      $('saisie').requestSubmit();
    }
  });
  $('saisie').addEventListener('submit', e => {
    e.preventDefault();
    const q = champ.value.trim();
    if (!q) return;
    // Temporary keyword, icon and summary, replaced by the LLM's card once the answer has arrived
    const n = { id: 'n' + nouvelId(), parent: selection, q, a: '',
      ico: icone(q), kw: motCle(q), sum: 'Question : ' + abreger(q, LONGUEUR_RESUME) };
    noeuds.push(n);
    champ.value = '';
    champ.style.height = '';
    repondre(n);
    choisir(n.id, true);
  });

  // ---------- Answer: Claude if a key is set, otherwise a simulated answer ----------
  async function repondre(n) {
    Object.assign(n, { enCours: true, erreur: false, a: '' });
    delete n.usage;
    if (selection === n.id) remplirPanneau();
    if (!reglages.cle) {
      setTimeout(() => {
        Object.assign(n, { enCours: false, a: reponseSimulee(n.q) });
        sauver();
        if (selection === n.id) remplirPanneau();
      }, DELAI_REPONSE_SIMULEE);
      return;
    }
    try {
      await demanderClaude(n);
      n.enCours = false;
      sauver();
      if (selection === n.id) remplirPanneau();
      try { await ficherEchange(n); } catch { /* card is optional: keep the temporary keyword */ }
    } catch (err) {
      Object.assign(n, { enCours: false, erreur: true, a: '⚠️ ' + err.message });
      toast('Le LLM a renvoyé une erreur');
    }
    sauver();
    dessiner();
  }

  function enTetes() {
    const h = {
      'content-type': 'application/json',
      'x-api-key': reglages.cle,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',   // allows calling the API directly from a browser
    };
    if (reglages.espace) h['anthropic-workspace-id'] = reglages.espace;
    return h;
  }
  async function erreurApi(r) {
    let msg = `Erreur ${r.status}`;
    try { const j = await r.json(); if (j.error?.message) msg += ' : ' + j.error.message; } catch { /* unreadable body */ }
    if (r.status === 401) msg += ' (clé API refusée : vérifie-la dans les réglages)';
    return new Error(msg);
  }

  // Request: instruction + summary of earlier steps, then the last exchanges in full, then the question
  function construireRequete(n) {
    const c = chemin(n.parent).filter(m => m.id !== RACINE);
    const { resumes, complets } = decouper(c);
    let systeme = CONSIGNE;
    if (resumes.length) {
      systeme += '\n\nRésumé des étapes précédentes de cette branche :\n' + resumes.map(m => `- ${m.kw} : ${m.sum}`).join('\n');
    }
    const messages = [];
    for (const m of complets) {
      if (m.a && !m.erreur) messages.push({ role: 'user', content: m.q }, { role: 'assistant', content: m.a });
    }
    messages.push({ role: 'user', content: n.q });
    return { system: systeme, messages };
  }

  // Streaming call: the answer is displayed as it arrives
  async function demanderClaude(n) {
    const r = await fetch(API_URL, {
      method: 'POST', headers: enTetes(),
      body: JSON.stringify({ model: reglages.modele, max_tokens: MAX_TOKENS_REPONSE, stream: true, ...construireRequete(n) }),
    });
    if (!r.ok) throw await erreurApi(r);
    const lecteur = r.body.getReader(), decodeur = new TextDecoder();
    let tampon = '';
    n.usage = { entree: 0, sortie: 0 };
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      tampon += decodeur.decode(value, { stream: true }).replace(/\r/g, '');
      const evenements = tampon.split('\n\n');
      tampon = evenements.pop();                  // last chunk, possibly incomplete
      for (const ev of evenements) {
        const ligne = ev.split('\n').find(l => l.startsWith('data:'));
        if (!ligne) continue;
        const d = JSON.parse(ligne.slice(5));
        if (d.type === 'message_start') n.usage.entree = d.message.usage.input_tokens;
        else if (d.type === 'content_block_delta' && d.delta.type === 'text_delta') { n.a += d.delta.text; afficherFlux(n); }
        else if (d.type === 'message_delta' && d.usage) n.usage.sortie = d.usage.output_tokens;
        else if (d.type === 'error') throw new Error(d.error.message);
      }                                            // other events (ping…) are ignored
    }
  }
  function afficherFlux(n) {                     // updates only the answer text
    if (selection !== n.id) return;
    const p = document.querySelector(`#fil [data-id="${CSS.escape(n.id)}"] .a`);
    if (p) p.textContent = n.a;
  }

  // Node card: the small model is forced to answer through a "tool" with a fixed format
  const OUTIL_FICHE = {
    name: 'fiche',
    description: "Fiche de synthèse d'un échange question-réponse",
    input_schema: {
      type: 'object',
      properties: {
        mot_cle: { type: 'string', description: "1 à 3 mots qui résument l'échange" },
        emoji: { type: 'string', description: "Un seul emoji qui illustre le sujet, ou une chaîne vide si aucun n'est vraiment illustratif" },
        resume: { type: 'string', description: "Résumé de l'échange en 25 mots maximum, réutilisable comme contexte" },
      },
      required: ['mot_cle', 'emoji', 'resume'],
    },
  };
  async function ficherEchange(n) {
    const r = await fetch(API_URL, {
      method: 'POST', headers: enTetes(),
      body: JSON.stringify({
        model: MODELE_FICHE, max_tokens: MAX_TOKENS_FICHE,
        tools: [OUTIL_FICHE], tool_choice: { type: 'tool', name: OUTIL_FICHE.name },
        messages: [{ role: 'user', content: `Question : ${n.q}\n\nRéponse : ${n.a.slice(0, LONGUEUR_MAX_FICHE)}\n\nRemplis la fiche de cet échange, dans la langue de la question.` }],
      }),
    });
    if (!r.ok) throw await erreurApi(r);
    const f = (await r.json()).content?.find(b => b.type === 'tool_use')?.input;
    if (!f) return;
    if (f.mot_cle) n.kw = abreger(String(f.mot_cle), LONGUEUR_MOT_CLE_MAX);
    n.ico = [...String(f.emoji || '')].slice(0, 4).join('');   // an emoji can span several characters
    if (f.resume) n.sum = String(f.resume);
  }

  // ---------- LLM settings (key kept on the device only) ----------
  function chargerReglages() {
    const defaut = { cle: '', modele: MODELES[0][0], espace: '', retenir: false };
    try { return { ...defaut, ...JSON.parse(localStorage.getItem(CLE_REGLAGES)) }; } catch { return defaut; }
  }
  function sauverReglages() {
    const aStocker = { ...reglages, cle: reglages.retenir ? reglages.cle : '' };   // without "Garder", the key stays in memory only
    try { localStorage.setItem(CLE_REGLAGES, JSON.stringify(aStocker)); } catch { /* ignored */ }
  }
  let reglages = chargerReglages();
  if (!MODELES.some(([id]) => id === reglages.modele)) reglages.modele = MODELES[0][0];
  for (const [id, libelle] of MODELES) {
    const o = htmlEl('option', null, libelle);
    o.value = id;
    $('r-modele').append(o);
  }
  function libelleMode() {
    const m = MODELES.find(([id]) => id === reglages.modele);
    return reglages.cle ? `Claude ${m ? m[1].split(' (')[0] : ''}` : 'POC · démo sans LLM';
  }
  function ouvrirReglages() {
    fermerMenu();
    $('r-cle').value = reglages.cle;
    $('r-modele').value = reglages.modele;
    $('r-espace').value = reglages.espace;
    $('r-retenir').checked = reglages.retenir;
    $('reglages').showModal();
  }
  $('f-reglages').addEventListener('submit', e => {
    e.preventDefault();
    reglages = {
      cle: $('r-cle').value.trim(), modele: $('r-modele').value,
      espace: $('r-espace').value.trim(), retenir: $('r-retenir').checked,
    };
    sauverReglages();
    $('reglages').close();
    $('sous-titre').textContent = libelleMode();
    toast(reglages.cle ? 'Claude est branché' : 'Mode démo : réponses simulées');
  });
  $('r-effacer').addEventListener('click', () => { $('r-cle').value = ''; });
  $('r-fermer').addEventListener('click', () => $('reglages').close());

  // ---------- Top bar ----------
  function fermerMenu() {
    $('menu').hidden = true;
    $('b-menu').setAttribute('aria-expanded', 'false');
  }
  $('b-menu').addEventListener('click', () => {
    const ouvrir = $('menu').hidden;
    $('menu').hidden = !ouvrir;
    $('b-menu').setAttribute('aria-expanded', String(ouvrir));
  });
  document.addEventListener('pointerdown', e => {
    if (!$('menu').hidden && !e.target.closest('#menu, #b-menu')) fermerMenu();
  });
  $('b-reglages').addEventListener('click', ouvrirReglages);
  $('b-selection').addEventListener('click', () => passerEnSelection(true));
  $('b-annuler').addEventListener('click', () => passerEnSelection(false));
  $('b-fusionner').addEventListener('click', fusionner);
  $('b-cadrer').addEventListener('click', cadrer);
  $('b-export').addEventListener('click', () => {
    fermerMenu();
    const json = JSON.stringify({ version: 2, noeuds, groupes }, null, 2);
    navigator.clipboard?.writeText(json)
      .then(() => toast('Arbre copié au format JSON'))
      .catch(() => toast('Copie refusée par le navigateur'));
  });
  let attenteReinit = null;
  $('b-reinit').addEventListener('click', e => {
    const b = e.currentTarget;
    if (!attenteReinit) {               // first tap: ask for confirmation
      b.textContent = 'Confirmer ?';
      attenteReinit = setTimeout(() => { b.textContent = 'Réinitialiser'; attenteReinit = null; }, DELAI_CONFIRMATION);
      return;
    }
    clearTimeout(attenteReinit);
    attenteReinit = null;
    b.textContent = 'Réinitialiser';
    fermerMenu();
    noeuds = copie(EXEMPLE);
    selection = SELECTION_INITIALE;
    groupes = [];
    sauver();
    dessiner();
    cadrer();
    toast("Arbre d'exemple rétabli");
  });

  // ---------- Startup ----------
  $('sous-titre').textContent = libelleMode();
  dessiner();
  requestAnimationFrame(cadrer);
  addEventListener('resize', () => centrerSur(selection));   // e.g. the keyboard opening

  // Offline mode (PWA): skipped where service workers are not allowed
  try {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch { /* ignored */ }
}
