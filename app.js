/* arbre-llm — proof of concept (POC), v4
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
 * 8. Interface language: the English texts (UI) are translated by the LLM into the chosen
 *    language, checked, then kept on the device. Right-to-left languages mirror the layout.
 * Security: all text is inserted with textContent (never innerHTML), no third-party script.
 */
{
  // ---------- Settings ----------
  const FULL_EXCHANGES = 2;            // last exchanges of the path sent in full to the LLM
  const CHARS_PER_TOKEN = 4;           // rough estimate: 1 token ≈ 4 characters
  const WINDOWS = [200000, 128000, 32000, 100];     // context sizes offered (100: tiny, to see the alert in the demo)
  const ALERT_THRESHOLD = 0.8;         // share of the window above which a gauge turns orange
  const GAP_X = 168;                   // horizontal gap between two leaves (px)
  const GAP_Y = 100;                   // vertical gap between two levels (px)
  const NODE_WIDTH = 150;
  const NODE_HEIGHT = 40;
  const ARROW_GAP = 7;                 // the line stops before the box to leave room for the arrowhead
  const STACK_OFFSET = 5;              // offset of a group's "shadow" box
  const KEYWORD_LENGTH = 14;           // characters shown in a box
  const SUMMARY_LENGTH = 90;
  const ZOOM_MIN = 0.2, ZOOM_MAX = 3, ZOOM_MAX_FIT = 1.2;
  const WHEEL_SENSITIVITY = 0.0015;
  const TAP_THRESHOLD = 8;             // px: below this, the gesture is a tap, not a drag
  const DEMO_DELAY = 600;              // ms
  const CONFIRM_DELAY = 3000;          // ms
  const TOAST_DURATION = 2400;         // ms
  const STORAGE_KEY = 'arbre-llm-v3';
  const ROOT = 'root';
  const INITIAL_SELECTION = 'n3';

  // ---------- LLM: Claude through the Anthropic API ----------
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const API_VERSION = '2026-10-21';
  const MODELS = [                     // [id, key of its label in UI]; the first one is the default model
    ['claude-sonnet-5-5', 'modelSonnet'],
    ['claude-haiku-5-5', 'modelHaiku'],
    ['claude-opus-5-5', 'modelOpus'],
  ];
  const CARD_MODEL = 'claude-haiku-5-5';     // small model for the node card and the interface translation
  const MAX_TOKENS_ANSWER = 4096;
  const MAX_TOKENS_CARD = 300;
  const MAX_TOKENS_TRANSLATION = 6000;
  const CARD_INPUT_LENGTH = 6000;      // characters of the answer sent to build the card
  const LLM_KEYWORD_LENGTH = 30;       // characters kept for an LLM-generated keyword
  const SETTINGS_KEY = 'arbre-llm-settings';
  const TRANSLATIONS_KEY = 'arbre-llm-translations';
  const INSTRUCTION = 'You are answering inside a tree-shaped conversation app. Answer in the language of the question, ' +
    'in plain text, without Markdown or LaTeX: write formulas in a readable notation (Unicode) and define every notation.';

  // ---------- Interface texts (English reference, translated by the LLM on demand) ----------
  // {name} marks a value inserted by the code; a translation must keep exactly the same ones.
  const UI = {
    select: 'Select', fit: 'Fit', moreActions: 'More actions', merge: 'Merge ({count})', cancel: 'Cancel',
    settingsMenu: 'Settings', exportJson: 'Copy as JSON', reset: 'Reset', confirmReset: 'Confirm?',
    mapLabel: 'Conversation map', restartFromSummary: 'Restart from summary',
    gaugesLabel: "Tokens used. Tap to change the model's context size.", gaugePath: 'Path', gaugeTree: 'Tree',
    tabThread: 'Thread', tabContext: 'LLM context', questionLabel: 'New question', send: 'Send',
    settingsTitle: 'Settings', settingsDemoNote: 'Without a key, the app stays in demo mode (simulated answers).',
    apiKey: 'Anthropic API key', model: 'Model', workspace: 'Workspace ID (only if the API asks for it)',
    keepKey: 'Keep the key on this device',
    keyNote: 'The key stays on this device and is only sent to api.anthropic.com. Create it in the Claude Console ' +
      '(platform.claude.com) and set a spending limit there. If the box above is unticked, the key is forgotten when the app closes.',
    language: 'Interface language',
    languageNote: 'Translated by the AI the first time (an API key is needed), then kept on this device.',
    retranslate: 'Retranslate', clearKey: 'Clear key', close: 'Close', save: 'Save',
    modelSonnet: 'Sonnet 5.5 (balanced)', modelHaiku: 'Haiku 5.5 (fast, low cost)', modelOpus: 'Opus 5.5 (most capable)',
    modeDemo: 'POC · demo without LLM', selectHint: 'Tap the boxes to merge', rootLabel: 'Start',
    pickTwo: 'Pick at least two boxes.', merged: '{count} boxes merged. Tap the box to expand it.', expanded: 'Box expanded',
    rootSummary: 'Ask a first question to start a new branch.', placeholder: 'After “{keyword}”…',
    noExchange: 'No exchange on this path yet.', retry: 'Retry', followUps: 'Follow-ups already explored from here:',
    answering: 'Answer in progress…', nothingToSend: 'Nothing to send: a question asked here goes without context.',
    tokensApprox: '≈ {count} tokens',
    contextStat: 'sent to the LLM for a question asked here, versus ≈ {full} tokens for the whole path in full (exchanges: {count}).',
    earlierSteps: 'Earlier steps: summary only', lastExchanges: 'Last exchanges: in full',
    contextRule: 'Rule: the last {count} exchanges in full, a summary of the earlier ones, nothing from neighbouring branches. ' +
      'Estimate: 1 token ≈ {chars} characters.',
    contextSize: "Model's maximum context: {count} tokens", restartKeyword: 'Restart',
    restartQuestion: 'Restart of “{keyword}” in a new conversation',
    restartSummary: 'New conversation starting from the summary of “{keyword}”.',
    restartDone: 'New conversation created from the summary',
    demoAnswer: 'Demo mode: simulated answer to “{question}”.\nFor real answers, add your Anthropic API key in ⋯ → Settings.',
    questionSummary: 'Question: {question}', interrupted: 'Answer interrupted.', llmError: 'The LLM returned an error',
    apiKeyRejected: 'API key rejected: check it in the settings', claudeOn: 'Claude is connected',
    demoOn: 'Demo mode: simulated answers', copied: 'Tree copied as JSON', copyRefused: 'Copy refused by the browser',
    resetDone: 'Example tree restored', translating: 'Translating the interface…', translated: 'Interface translated',
    translationNeedsKey: 'Translation needs an API key: the interface stays in English.',
    translationFailed: 'Translation failed: the interface stays in English.',
  };

  // ---------- Example tree (hand-written answers) ----------
  const EXAMPLE = [
    { id: ROOT, parent: null, ico: '🌱', kw: 'Start', q: '', a: '', sum: '' },
    { id: 'n1', parent: ROOT, ico: '🧠', kw: 'Mind map', q: 'What is a mind map?',
      a: 'A mind map is a diagram that starts from one central idea and branches out into related ideas, like a tree. You see the whole topic at a glance and how each part connects to the others.',
      sum: 'A mind map: a central idea branching into related ideas, seen at a glance.' },
    { id: 'n2', parent: 'n1', ico: '🧩', kw: 'Why structure', q: 'Why does structuring information help?',
      a: 'We can only hold a few things in mind at once. Grouping ideas and linking them makes information easier to understand, to find again and to remember.',
      sum: 'Structure helps: grouped, linked ideas are easier to understand and remember.' },
    { id: 'n3', parent: 'n2', ico: '📦', kw: 'Grouping ideas', q: 'How do I group ideas?',
      a: 'Put one idea per box and give it a short keyword. Gather related ideas under a common branch, and keep only a few branches per level so the map stays readable.',
      sum: 'One idea per box, short keywords, related ideas under one branch, few branches per level.' },
    { id: 'n4', parent: 'n1', ico: '✏️', kw: 'Build one', q: 'How do I build one?',
      a: 'Write the main topic in the centre. Add the big themes as branches, then the details as smaller branches. Use keywords rather than sentences.',
      sum: 'Topic in the centre, themes as branches, details below, keywords rather than sentences.' },
    { id: 'n5', parent: ROOT, ico: '🤖', kw: 'AI chats', q: 'Why use a tree for AI conversations?',
      a: 'A classic chat is one long thread: going back or exploring another idea quickly gets messy. A tree lets you branch off, come back to any point, and send the AI only the branch that matters.',
      sum: 'A tree lets you branch, come back anywhere, and send the AI only the useful branch.' },
    { id: 'n6', parent: 'n5', ico: '🌿', kw: 'Branching', q: 'What happens if I ask from an older box?',
      a: 'A new branch starts from that box. The AI only receives the path leading to it, so the other branches do not clutter its context.',
      sum: 'Asking from an older box starts a new branch; the AI gets only that path.' },
  ];

  // Temporary icons for new questions: word stem (without accents, English or French) → emoji.
  // With an API key, the emoji is then replaced by the one the LLM chooses.
  const ICONS = [
    ['tree', '🌳'], ['arbre', '🌳'], ['forest', '🌲'], ['foret', '🌲'], ['course', '🎓'], ['cours', '🎓'],
    ['school', '🎓'], ['ecole', '🎓'], ['student', '🎓'], ['etudiant', '🎓'], ['bank', '🏦'], ['banque', '🏦'],
    ['money', '💶'], ['argent', '💶'], ['price', '💶'], ['prix', '💶'], ['cost', '💶'], ['cout', '💶'],
    ['risk', '⚠️'], ['risque', '⚠️'], ['comput', '🧮'], ['calcul', '🧮'], ['formula', '🧮'], ['formule', '🧮'],
    ['date', '📅'], ['time', '⏱️'], ['temps', '⏱️'], ['code', '💻'], ['program', '💻'], ['data', '📊'],
    ['donnee', '📊'], ['graph', '📈'], ['chart', '📈'], ['market', '📈'], ['marche', '📈'], ['secur', '🔒'],
    ['encrypt', '🔒'], ['chiffr', '🔒'], ['train', '🚂'], ['locomotive', '🚂'], ['car', '🚗'], ['voiture', '🚗'],
    ['book', '📚'], ['livre', '📚'], ['music', '🎵'], ['musique', '🎵'], ['recipe', '🍳'], ['recette', '🍳'],
    ['cook', '🍳'], ['cuisine', '🍳'], ['travel', '✈️'], ['voyage', '✈️'], ['house', '🏠'], ['maison', '🏠'],
    ['climat', '🌍'], ['carbon', '🌍'], ['energ', '⚡'], ['robot', '🤖'], ['llm', '🤖'], ['ai', '🤖'], ['ia', '🤖'],
    ['hedg', '☂️'], ['couvr', '☂️'], ['insur', '☂️'], ['assurance', '☂️'], ['contract', '📝'], ['contrat', '📝'],
    ['mail', '✉️'],
  ];
  const STOP_WORDS = new Set(['what', 'which', 'with', 'that', 'this', 'does', 'from', 'about', 'there', 'their',
    'would', 'could', 'should', 'have', 'into', 'comment', 'pourquoi', 'quelle', 'quelles', 'quels', 'quel', 'dans',
    'avec', 'pour', 'sans', 'faire', 'peux', 'peut', 'cette', 'entre', 'sont']);

  // ---------- Helpers ----------
  const $ = id => document.getElementById(id);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const clone = x => JSON.parse(JSON.stringify(x));
  const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const stripAccents = s => s.normalize('NFD').replace(/\p{M}/gu, '');
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const placeholders = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
  function validLocale(tag) {                  // a BCP 47 tag the browser accepts, otherwise English
    try { return Intl.getCanonicalLocales(String(tag))[0] || 'en'; } catch { return 'en'; }
  }
  function svgEl(name, attrs) {
    const e = document.createElementNS(SVGNS, name);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function htmlEl(name, className, text) {
    const e = document.createElement(name);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }
  let toastTimer;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), TOAST_DURATION);
  }
  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }   // storage may be unavailable
  }
  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignored */ }
  }

  // ---------- Translation of the interface ----------
  let texts = {};                               // current translation (empty: English)
  // Text for a key, in the current language, with the {name} values filled in
  function t(key, values = {}) {
    const s = texts[key] || UI[key];
    return s.replace(/\{(\w+)\}/g, (m, name) => (name in values ? values[name] : m));
  }
  const isEnglish = language => !language || /^(en|english|anglais)$/i.test(language.trim());
  const uiVersion = [...JSON.stringify(UI)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);   // changes when UI changes
  function applyStaticTexts() {
    document.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = t(e.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(e => e.setAttribute('aria-label', t(e.dataset.i18nAria)));
    MODELS.forEach(([, labelKey], i) => { $('set-model').options[i].textContent = t(labelKey); });
    $('subtitle').textContent = modeSelect ? t('selectHint') : modeLabel();
    $('btn-merge').textContent = t('merge', { count: completeGroup().size });
  }
  function applyLanguage() {
    const cached = isEnglish(settings.language) ? null : (readJson(TRANSLATIONS_KEY) || {})[settings.language.trim().toLowerCase()];
    const usable = Boolean(cached && cached.version === uiVersion);
    texts = usable ? cached.texts : {};
    document.documentElement.lang = usable ? cached.lang : 'en';
    document.documentElement.dir = usable ? cached.direction : 'ltr';
    applyStaticTexts();
    draw();
    return usable;
  }
  // One call to the small model, forced to answer with a fixed format; each text is checked
  async function translateInterface(language) {
    const keys = Object.keys(UI);
    const tool = {
      name: 'interface',
      description: 'Translation of the user-interface texts of a mobile app',
      input_schema: {
        type: 'object',
        properties: {
          lang: { type: 'string', description: 'BCP 47 code of the target language, e.g. fr, es, ar' },
          direction: { type: 'string', enum: ['ltr', 'rtl'], description: 'Writing direction of the target language' },
          texts: { type: 'object', properties: Object.fromEntries(keys.map(k => [k, { type: 'string' }])), required: keys },
        },
        required: ['lang', 'direction', 'texts'],
      },
    };
    const prompt = `Translate these user-interface texts of a mobile app into this language: ${language}.\n` +
      'Keep them short, natural and consistent with each other. Keep every placeholder in curly braces exactly as is ' +
      '(for example {count}), keep the line breaks, and keep product and technical names unchanged ' +
      '(Claude, Anthropic, Claude Console, api.anthropic.com, Sonnet, Haiku, Opus, JSON, LLM, API, POC).\n\n' +
      JSON.stringify(UI, null, 1);
    const r = await fetch(API_URL, {
      method: 'POST', headers: apiHeaders(),
      body: JSON.stringify({
        model: CARD_MODEL, max_tokens: MAX_TOKENS_TRANSLATION,
        tools: [tool], tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw await apiError(r);
    const out = (await r.json()).content?.find(b => b.type === 'tool_use')?.input;
    if (!out || typeof out.texts !== 'object' || !out.texts) throw new Error('empty translation');
    const checked = {};
    for (const k of keys) {                     // a text that lost or gained a {value} falls back to English
      const s = out.texts[k];
      if (typeof s === 'string' && s.trim() && placeholders(s) === placeholders(UI[k])) checked[k] = s;
    }
    const all = readJson(TRANSLATIONS_KEY) || {};
    all[language.trim().toLowerCase()] = {
      lang: validLocale(out.lang),
      direction: out.direction === 'rtl' ? 'rtl' : 'ltr',
      texts: checked, version: uiVersion,
    };
    writeJson(TRANSLATIONS_KEY, all);
  }
  async function changeLanguage(force) {
    if (applyLanguage() && !force) return;      // already translated on this device
    if (isEnglish(settings.language)) return;
    if (!settings.key) { toast(t('translationNeedsKey')); return; }
    toast(t('translating'));
    try {
      await translateInterface(settings.language);
      applyLanguage();
      toast(t('translated'));
    } catch {
      toast(t('translationFailed'));
    }
  }

  // ---------- Local storage (stays on the device) ----------
  function loadState() {
    const s = readJson(STORAGE_KEY);
    return s && Array.isArray(s.nodes) && s.nodes.some(n => n.id === ROOT) ? s : null;
  }
  function saveState() { writeJson(STORAGE_KEY, { nodes, selection, groups, window: contextWindow }); }

  // ---------- State ----------
  const state = loadState() || {};
  let nodes = state.nodes || clone(EXAMPLE);
  let selection = state.selection || INITIAL_SELECTION;
  let groups = state.groups || [];             // [{ id, members: [ids of the merged nodes] }]
  let contextWindow = WINDOWS.includes(state.window) ? state.window : WINDOWS[0];
  for (const n of nodes) {                     // answer cut off because the app was closed
    if (n.pending) Object.assign(n, { pending: false, error: true, a: n.a || UI.interrupted });
  }
  let modeSelect = false;
  const ticked = new Set();                    // boxes tapped in selection mode
  const view = { x: 0, y: 0, k: 1 };           // translation (x, y) and scale k of the map
  let V, P;                                    // visible tree and positions, recomputed on every draw

  // ---------- Reading the tree ----------
  const node = id => nodes.find(n => n.id === id);
  const children = id => nodes.filter(n => n.parent === id);
  function path(id) {                          // nodes from the root down to id
    const p = [];
    for (let n = node(id); n; n = node(n.parent)) p.unshift(n);
    return p;
  }
  const keyword = n => (n.id === ROOT ? t('rootLabel') : n.kw);
  const label = n => (n.ico ? n.ico + ' ' : '') + keyword(n);
  if (!node(selection)) selection = ROOT;

  // Visible tree: each node belongs to a box (itself, or the group that contains it)
  function visibleTree() {
    const groupOf = {};
    for (const g of groups) for (const m of g.members) groupOf[m] = g;
    const unit = id => (groupOf[id] ? groupOf[id].id : id);
    const units = new Map();                   // box id → { id, rep, group, parent }
    for (const n of nodes) {
      const g = groupOf[n.id];
      const top = !g || !g.members.includes(n.parent);   // topmost node of its group
      if (top) units.set(unit(n.id), { id: unit(n.id), rep: n, group: g || null, parent: n.parent == null ? null : unit(n.parent) });
    }
    const childUnits = {};
    for (const u of units.values()) if (u.parent != null) (childUnits[u.parent] ||= []).push(u.id);
    return { unit, units, childUnits };
  }

  // ---------- Layout ----------
  function layout(v) {
    const pos = {};
    let leaf = 0;
    (function place(u, depth) {
      const k = v.childUnits[u] || [];
      k.forEach(c => place(c, depth + 1));
      const x = k.length ? (pos[k[0]].x + pos[k[k.length - 1]].x) / 2 : (leaf++) * GAP_X;
      pos[u] = { x, y: depth * GAP_Y };
    })(v.unit(ROOT), 0);
    return pos;
  }

  // ---------- Drawing the map ----------
  function draw() {
    V = visibleTree();
    P = layout(V);
    const onPath = new Set(path(selection).map(n => V.unit(n.id)));
    const selectedUnit = V.unit(selection);
    const toMerge = modeSelect ? completeGroup() : new Set();
    const layer = $('layer');
    layer.textContent = '';

    const links = [...V.units.values()].filter(u => u.parent != null)
      .sort((a, b) => onPath.has(a.id) - onPath.has(b.id));
    for (const u of links) {
      const a = P[u.parent], b = P[u.id];
      const y0 = a.y + NODE_HEIGHT / 2, y1 = b.y - NODE_HEIGHT / 2 - ARROW_GAP, my = (y0 + y1) / 2;
      const active = onPath.has(u.id);
      layer.append(svgEl('path', {
        d: `M${a.x},${y0} C${a.x},${my} ${b.x},${my} ${b.x},${y1}`,
        class: active ? 'link active' : 'link',
        'marker-end': active ? 'url(#arrow-active)' : 'url(#arrow)',
      }));
    }

    const W = NODE_WIDTH, H = NODE_HEIGHT;
    for (const u of V.units.values()) {
      const members = u.group ? u.group.members : [u.id];
      const classes = ['node'];
      if (members.includes(ROOT)) classes.push('root');
      if (u.group) classes.push('group');
      if (u.id === selectedUnit) classes.push('selected');
      else if (onPath.has(u.id)) classes.push('on-path');
      if (members.some(m => toMerge.has(m))) classes.push('ticked', ...(members.some(m => ticked.has(m)) ? [] : ['auto']));
      const g = svgEl('g', { class: classes.join(' '), transform: `translate(${P[u.id].x},${P[u.id].y})`, 'data-id': u.id });
      if (u.group) g.append(svgEl('rect', { class: 'stack', x: -W / 2 + STACK_OFFSET, y: -H / 2 + STACK_OFFSET, width: W, height: H, rx: H / 2 }));
      g.append(svgEl('rect', { class: 'box', x: -W / 2, y: -H / 2, width: W, height: H, rx: H / 2 }));
      const text = svgEl('text', { 'text-anchor': 'middle', dy: '0.35em' });
      text.textContent = (u.rep.ico ? u.rep.ico + ' ' : '') + shorten(keyword(u.rep), KEYWORD_LENGTH);
      const title = svgEl('title', {});
      title.textContent = members.map(m => keyword(node(m))).join(' → ');
      g.append(text, title);
      if (u.group) {                           // "+N" badge: number of hidden boxes
        g.append(svgEl('circle', { class: 'badge', cx: W / 2 - 4, cy: -H / 2 + 2, r: 13 }));
        const count = svgEl('text', { class: 'count', x: W / 2 - 4, y: -H / 2 + 2, 'text-anchor': 'middle', dy: '0.35em' });
        count.textContent = '+' + (members.length - 1);
        g.append(count);
      }
      layer.append(g);
    }
    applyView();
    fillPanel();
  }
  function applyView() {
    $('layer').setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  }

  // Map area not covered by the top bar and the panel
  function visibleArea() {
    const top = $('topbar').getBoundingClientRect().bottom;
    const p = $('panel').getBoundingClientRect();
    const side = p.top <= top + 1;             // large screen: panel on the right
    return side ? { top, w: p.left, h: innerHeight - top } : { top, w: innerWidth, h: p.top - top };
  }
  function fit() {                             // whole tree visible
    const pos = Object.values(P);
    const xs = pos.map(p => p.x), ys = pos.map(p => p.y);
    const x0 = Math.min(...xs) - NODE_WIDTH, x1 = Math.max(...xs) + NODE_WIDTH;
    const y0 = Math.min(...ys) - NODE_HEIGHT, y1 = Math.max(...ys) + NODE_HEIGHT;
    const a = visibleArea();
    view.k = Math.min(a.w / (x1 - x0), a.h / (y1 - y0), ZOOM_MAX_FIT);
    view.x = (a.w - (x0 + x1) * view.k) / 2;
    view.y = a.top + (a.h - (y0 + y1) * view.k) / 2;
    applyView();
  }
  function centerOn(id) {
    const p = P[V.unit(id)], a = visibleArea();
    view.x = a.w / 2 - p.x * view.k;
    view.y = a.top + a.h / 2 - p.y * view.k;
    applyView();
  }
  function isVisible(id) {                     // is the box in the uncovered part of the screen?
    const p = P[V.unit(id)], a = visibleArea();
    const sx = p.x * view.k + view.x, sy = p.y * view.k + view.y;
    return sx > 0 && sx < a.w && sy > a.top && sy < a.top + a.h;
  }
  function zoomAround(cx, cy, factor) {        // zoom while keeping point (cx, cy) fixed on screen
    const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * factor));
    const f = k / view.k;
    view.x = cx - (cx - view.x) * f;
    view.y = cy - (cy - view.y) * f;
    view.k = k;
  }

  // ---------- Gestures on the map ----------
  const svg = $('map');
  const pointers = new Map();                  // fingers (or mouse) currently down
  let start = null, pinch = null;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  svg.addEventListener('pointerdown', e => {
    const target = e.target.closest('[data-id]');
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) start = { x: e.clientX, y: e.clientY, target, moved: false };
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: distance(a, b), m: middle(a, b) };
      if (start) start.moved = true;
    }
  });
  svg.addEventListener('pointermove', e => {
    const before = pointers.get(e.pointerId);
    if (!before) return;
    const after = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, after);
    if (pointers.size === 1) {
      view.x += after.x - before.x;
      view.y += after.y - before.y;
      if (start && distance(after, start) > TAP_THRESHOLD) start.moved = true;
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = distance(a, b), m = middle(a, b);
      zoomAround(m.x, m.y, d / pinch.d);
      view.x += m.x - pinch.m.x;
      view.y += m.y - pinch.m.y;
      pinch = { d, m };
    }
    applyView();
  });
  function release(e) {
    if (!pointers.delete(e.pointerId)) return;
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      if (start && !start.moved && start.target) tap(start.target.getAttribute('data-id'));
      start = null;
    }
  }
  svg.addEventListener('pointerup', release);
  svg.addEventListener('pointercancel', release);
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    zoomAround(e.clientX, e.clientY, Math.exp(-e.deltaY * WHEEL_SENSITIVITY));
    applyView();
  }, { passive: false });
  document.addEventListener('gesturestart', e => e.preventDefault());   // Safari: block page zoom

  // Tapping a box: select it, expand a group, or tick it in selection mode
  function tap(unitId) {
    const u = V.units.get(unitId);
    if (!u) return;
    if (modeSelect) {
      const ids = u.group ? u.group.members : [u.id];
      const allTicked = ids.every(i => ticked.has(i));
      ids.forEach(i => (allTicked ? ticked.delete(i) : ticked.add(i)));
      draw();
      $('btn-merge').textContent = t('merge', { count: completeGroup().size });
      return;
    }
    if (u.group) { expand(u.group.id); return; }
    select(u.id, false);
  }

  // ---------- Selecting a node ----------
  function select(id, recenter) {
    selection = id;
    saveState();
    draw();
    if (recenter || !isVisible(id)) centerOn(id);
  }

  // ---------- Merging and expanding ----------
  // Adds to the ticked boxes the ones that connect them: start from their lowest common
  // ancestor and add every node on the paths leading down from it to them.
  function completeGroup() {
    const paths = [...ticked].filter(node).map(id => path(id).map(n => n.id));
    if (!paths.length) return new Set();
    let k = 0;                                 // length of the prefix shared by all paths
    while (paths.every(p => k < p.length && p[k] === paths[0][k])) k++;
    const group = new Set();
    for (const p of paths) p.slice(k - 1).forEach(id => group.add(id));
    return group;
  }
  function setSelectMode(on) {
    modeSelect = on;
    ticked.clear();
    document.body.classList.toggle('select-mode', on);
    closeMenu();
    applyStaticTexts();
    draw();
  }
  function merge() {
    const members = completeGroup();
    if (members.size < 2) { toast(t('pickTwo')); return; }
    const others = [];
    for (const g of groups) {                  // an existing group that touches the selection is absorbed
      if (g.members.some(m => members.has(m))) g.members.forEach(m => members.add(m));
      else others.push(g);
    }
    groups = [...others, { id: 'g' + newId(), members: [...members] }];
    saveState();
    setSelectMode(false);
    toast(t('merged', { count: members.size }));
  }
  function expand(groupId) {
    groups = groups.filter(g => g.id !== groupId);
    saveState();
    draw();
    toast(t('expanded'));
  }

  // ---------- Panel: thread, context, gauges ----------
  function fillPanel() {
    const n = node(selection);
    $('panel-title').textContent = label(n);
    $('panel-summary').textContent = n.id === ROOT ? t('rootSummary') : n.sum;
    $('question').placeholder = t('placeholder', { keyword: shorten(keyword(n), KEYWORD_LENGTH) });

    const p = path(selection).filter(m => m.id !== ROOT);
    const thread = $('thread');
    thread.textContent = '';
    if (!p.length) thread.append(htmlEl('p', 'empty', t('noExchange')));
    p.forEach((m, i) => {
      if (i > 0) thread.append(htmlEl('div', 'thread-arrow', '↓'));
      const block = htmlEl('article', 'exchange' + (m.id === selection ? ' current' : '') + (m.error ? ' error' : ''));
      block.dataset.id = m.id;
      block.append(htmlEl('p', 'kw', label(m)), htmlEl('p', 'q', m.q), htmlEl('p', 'a', answerText(m)));
      if (m.error) {
        const b = htmlEl('button', 'retry', t('retry'));
        b.type = 'button';
        b.dataset.retry = m.id;
        block.append(b);
      }
      thread.append(block);
    });
    const next = children(selection);
    if (next.length) {
      const d = htmlEl('div', 'follow-ups');
      d.append(htmlEl('p', null, t('followUps')));
      for (const c of next) {
        const b = htmlEl('button', null, label(c));
        b.type = 'button';
        b.dataset.id = c.id;
        d.append(b);
      }
      thread.append(d);
    }
    requestAnimationFrame(() => thread.querySelector('.current')?.scrollIntoView({ block: 'nearest' }));
    fillContext(p);
    fillGauges(p);
  }

  const answerText = n => n.a || (n.pending ? t('answering') : '');
  const tokens = chars => Math.ceil(chars / CHARS_PER_TOKEN);
  const sum = (list, f) => list.reduce((s, n) => s + f(n), 0);
  const exchangeSize = n => n.q.length + n.a.length;
  // Tokens of an exchange: actual answer count returned by the API when known, otherwise an estimate
  const exchangeTokens = n => (n.usage ? tokens(n.q.length) + n.usage.output : tokens(exchangeSize(n)));

  // Splits a path: earlier steps (summary only) and the last FULL_EXCHANGES exchanges
  function split(p) {
    const cut = Math.max(0, p.length - FULL_EXCHANGES);
    return { earlier: p.slice(0, cut), recent: p.slice(cut) };
  }

  // Compact context: summary of earlier steps + the last FULL_EXCHANGES exchanges in full
  function fillContext(p) {
    const box = $('context');
    box.textContent = '';
    if (!p.length) { box.append(htmlEl('p', 'empty', t('nothingToSend'))); return; }
    const { earlier, recent } = split(p);
    const compact = sum(earlier, n => n.kw.length + n.sum.length) + sum(recent, exchangeSize);
    const full = sum(p, exchangeSize);

    const stat = htmlEl('div', 'stat');
    const figure = htmlEl('p', 'figure');
    figure.append(htmlEl('mark', null, t('tokensApprox', { count: tokens(compact) })));
    stat.append(figure, htmlEl('p', null, t('contextStat', { full: tokens(full), count: p.length })));
    box.append(stat);

    if (earlier.length) {
      box.append(htmlEl('h3', null, t('earlierSteps')));
      const ul = htmlEl('ul');
      for (const n of earlier) ul.append(htmlEl('li', null, `${label(n)}: ${n.sum}`));
      box.append(ul);
    }
    box.append(htmlEl('h3', null, t('lastExchanges')));
    recent.forEach((n, i) => {
      if (i > 0) box.append(htmlEl('div', 'thread-arrow', '↓'));
      const b = htmlEl('div', 'exchange');
      b.append(htmlEl('p', 'q', n.q), htmlEl('p', 'a', n.a));
      box.append(b);
    });
    box.append(htmlEl('p', 'note', t('contextRule', { count: FULL_EXCHANGES, chars: CHARS_PER_TOKEN })));
  }

  // Two gauges: tokens of the current path and of the whole tree, relative to the model's window
  const compactFormat = () => new Intl.NumberFormat(validLocale(document.documentElement.lang), { notation: 'compact', maximumFractionDigits: 1 });
  function fillGauges(p) {
    const pathRatio = setGauge('gauge-path', sum(p, exchangeTokens));
    setGauge('gauge-tree', sum(nodes, exchangeTokens));
    $('btn-restart').hidden = !(pathRatio >= ALERT_THRESHOLD && p.length > 0);
  }
  function setGauge(id, count) {
    const ratio = count / contextWindow, f = compactFormat();
    const g = $(id);
    g.querySelector('i').style.width = Math.min(100, ratio * 100) + '%';
    g.querySelector('.value').textContent = `${f.format(count)} / ${f.format(contextWindow)}`;
    g.classList.toggle('alert', ratio >= ALERT_THRESHOLD);
    return ratio;
  }
  $('gauges').addEventListener('click', () => {
    contextWindow = WINDOWS[(WINDOWS.indexOf(contextWindow) + 1) % WINDOWS.length];
    saveState();
    fillPanel();
    toast(t('contextSize', { count: compactFormat().format(contextWindow) }));
  });

  // Restart from the summary: a new conversation whose starting point is the path's summary
  $('btn-restart').addEventListener('click', () => {
    const origin = node(selection);
    const p = path(selection).filter(m => m.id !== ROOT);
    const n = { id: 'n' + newId(), parent: ROOT, ico: '♻️', kw: t('restartKeyword'),
      q: t('restartQuestion', { keyword: keyword(origin) }),
      a: p.map(m => `${label(m)}: ${m.sum}`).join('\n'),
      sum: t('restartSummary', { keyword: keyword(origin) }) };
    nodes.push(n);
    select(n.id, true);
    toast(t('restartDone'));
  });

  $('thread').addEventListener('click', e => {
    const r = e.target.closest('[data-retry]');
    if (r) { answer(node(r.dataset.retry)); return; }
    const c = e.target.closest('[data-id]');
    if (c) select(c.dataset.id, true);
  });
  $('handle').addEventListener('click', () => {
    const open = $('panel').classList.toggle('collapsed') === false;
    $('handle').setAttribute('aria-expanded', String(open));
    centerOn(selection);
    if (open) requestAnimationFrame(() => $('thread').querySelector('.current')?.scrollIntoView({ block: 'nearest' }));
  });
  document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(o => {
      const active = o === b;
      o.setAttribute('aria-selected', String(active));
      $(o.dataset.tab).hidden = !active;
    });
  }));

  // ---------- New question ----------
  function guessKeyword(q) {          // temporary: the longest meaningful word (replaced by the LLM's card)
    const words = q.match(/[\p{L}\p{N}'-]+/gu) || [];
    const w = words.filter(x => x.length >= 4 && !STOP_WORDS.has(x.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0] || words[0] || 'Question';
    return w[0].toUpperCase() + w.slice(1);
  }
  function guessIcon(q) {             // temporary: first word found in ICONS, otherwise no icon
    const words = stripAccents(q.toLowerCase()).match(/[a-z0-9]+/g) || [];
    for (const [stem, ico] of ICONS) {
      if (words.some(w => (stem.length <= 3 ? w === stem : w.startsWith(stem)))) return ico;
    }
    return '';
  }

  const input = $('question');
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) {
      e.preventDefault();
      $('ask-form').requestSubmit();
    }
  });
  $('ask-form').addEventListener('submit', e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    // Temporary keyword, icon and summary, replaced by the LLM's card once the answer has arrived
    const n = { id: 'n' + newId(), parent: selection, q, a: '',
      ico: guessIcon(q), kw: guessKeyword(q), sum: t('questionSummary', { question: shorten(q, SUMMARY_LENGTH) }) };
    nodes.push(n);
    input.value = '';
    input.style.height = '';
    answer(n);
    select(n.id, true);
  });

  // ---------- Answer: Claude if a key is set, otherwise a simulated answer ----------
  async function answer(n) {
    Object.assign(n, { pending: true, error: false, a: '' });
    delete n.usage;
    if (selection === n.id) fillPanel();
    if (!settings.key) {
      setTimeout(() => {
        Object.assign(n, { pending: false, a: t('demoAnswer', { question: n.q }) });
        saveState();
        if (selection === n.id) fillPanel();
      }, DEMO_DELAY);
      return;
    }
    try {
      await askClaude(n);
      n.pending = false;
      saveState();
      if (selection === n.id) fillPanel();
      try { await fillCard(n); } catch { /* card is optional: keep the temporary keyword */ }
    } catch (err) {
      Object.assign(n, { pending: false, error: true, a: '⚠️ ' + err.message });
      toast(t('llmError'));
    }
    saveState();
    draw();
  }

  function apiHeaders() {
    const h = {
      'content-type': 'application/json',
      'x-api-key': settings.key,
      'anthropic-version': API_VERSION,
      'anthropic-dangerous-direct-browser-access': 'true',   // allows calling the API directly from a browser
    };
    if (settings.workspace) h['anthropic-workspace-id'] = settings.workspace;
    return h;
  }
  async function apiError(r) {
    let msg = `Error ${r.status}`;
    try { const j = await r.json(); if (j.error?.message) msg += ': ' + j.error.message; } catch { /* unreadable body */ }
    if (r.status === 401) msg += ` (${t('apiKeyRejected')})`;
    return new Error(msg);
  }

  // Request: instruction + summary of earlier steps, then the last exchanges in full, then the question
  function buildRequest(n) {
    const { earlier, recent } = split(path(n.parent).filter(m => m.id !== ROOT));
    let system = INSTRUCTION;
    if (earlier.length) system += '\n\nSummary of the earlier steps of this branch:\n' + earlier.map(m => `- ${m.kw}: ${m.sum}`).join('\n');
    const messages = [];
    for (const m of recent) {
      if (m.a && !m.error) messages.push({ role: 'user', content: m.q }, { role: 'assistant', content: m.a });
    }
    messages.push({ role: 'user', content: n.q });
    return { system, messages };
  }

  // Streaming call: the answer is displayed as it arrives
  async function askClaude(n) {
    const r = await fetch(API_URL, {
      method: 'POST', headers: apiHeaders(),
      body: JSON.stringify({ model: settings.model, max_tokens: MAX_TOKENS_ANSWER, stream: true, ...buildRequest(n) }),
    });
    if (!r.ok) throw await apiError(r);
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    n.usage = { input: 0, output: 0 };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '');
      const events = buffer.split('\n\n');
      buffer = events.pop();                   // last chunk, possibly incomplete
      for (const ev of events) {
        const line = ev.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        const d = JSON.parse(line.slice(5));
        if (d.type === 'message_start') n.usage.input = d.message.usage.input_tokens;
        else if (d.type === 'content_block_delta' && d.delta.type === 'text_delta') { n.a += d.delta.text; showStream(n); }
        else if (d.type === 'message_delta' && d.usage) n.usage.output = d.usage.output_tokens;
        else if (d.type === 'error') throw new Error(d.error.message);
      }                                        // other events (ping…) are ignored
    }
  }
  function showStream(n) {                     // updates only the answer text
    if (selection !== n.id) return;
    const p = document.querySelector(`#thread [data-id="${CSS.escape(n.id)}"] .a`);
    if (p) p.textContent = n.a;
  }

  // Node card: the small model is forced to answer through a "tool" with a fixed format
  const CARD_TOOL = {
    name: 'card',
    description: 'Summary card of a question-answer exchange',
    input_schema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '1 to 3 words that sum up the exchange' },
        emoji: { type: 'string', description: 'A single emoji that illustrates the topic, or an empty string if none is really illustrative' },
        summary: { type: 'string', description: 'Summary of the exchange in 25 words at most, reusable as context' },
      },
      required: ['keyword', 'emoji', 'summary'],
    },
  };
  async function fillCard(n) {
    const r = await fetch(API_URL, {
      method: 'POST', headers: apiHeaders(),
      body: JSON.stringify({
        model: CARD_MODEL, max_tokens: MAX_TOKENS_CARD,
        tools: [CARD_TOOL], tool_choice: { type: 'tool', name: CARD_TOOL.name },
        messages: [{ role: 'user', content: `Question: ${n.q}\n\nAnswer: ${n.a.slice(0, CARD_INPUT_LENGTH)}\n\nFill in the card for this exchange, in the language of the question.` }],
      }),
    });
    if (!r.ok) throw await apiError(r);
    const c = (await r.json()).content?.find(b => b.type === 'tool_use')?.input;
    if (!c) return;
    if (c.keyword) n.kw = shorten(String(c.keyword), LLM_KEYWORD_LENGTH);
    n.ico = [...String(c.emoji || '')].slice(0, 4).join('');   // an emoji can span several characters
    if (c.summary) n.sum = String(c.summary);
  }

  // ---------- LLM settings (key kept on the device only) ----------
  function loadSettings() {
    const defaults = { key: '', model: MODELS[0][0], workspace: '', keep: false, language: '' };
    return { ...defaults, ...readJson(SETTINGS_KEY) };
  }
  function saveSettings() {
    writeJson(SETTINGS_KEY, { ...settings, key: settings.keep ? settings.key : '' });   // unticked: the key stays in memory only
  }
  const settings = loadSettings();
  if (!MODELS.some(([id]) => id === settings.model)) settings.model = MODELS[0][0];
  for (const [id] of MODELS) {
    const o = htmlEl('option');
    o.value = id;
    $('set-model').append(o);
  }
  function modeLabel() {
    const m = MODELS.find(([id]) => id === settings.model);
    return settings.key ? `Claude ${m ? t(m[1]).split(' (')[0] : ''}` : t('modeDemo');
  }
  function openSettings() {
    closeMenu();
    $('set-key').value = settings.key;
    $('set-model').value = settings.model;
    $('set-workspace').value = settings.workspace;
    $('set-keep').checked = settings.keep;
    $('set-language').value = settings.language;
    $('settings').showModal();
  }
  function readSettingsForm() {
    Object.assign(settings, {
      key: $('set-key').value.trim(), model: $('set-model').value, workspace: $('set-workspace').value.trim(),
      keep: $('set-keep').checked, language: $('set-language').value.trim(),
    });
    saveSettings();
  }
  $('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    readSettingsForm();
    $('settings').close();
    applyStaticTexts();
    toast(settings.key ? t('claudeOn') : t('demoOn'));
    changeLanguage(false);                      // translates only if this language is not on the device yet
  });
  $('btn-retranslate').addEventListener('click', () => {
    readSettingsForm();
    $('settings').close();
    changeLanguage(true);
  });
  $('btn-clear-key').addEventListener('click', () => { $('set-key').value = ''; });
  $('btn-close').addEventListener('click', () => $('settings').close());

  // ---------- Top bar ----------
  function closeMenu() {
    $('menu').hidden = true;
    $('btn-menu').setAttribute('aria-expanded', 'false');
  }
  $('btn-menu').addEventListener('click', () => {
    const open = $('menu').hidden;
    $('menu').hidden = !open;
    $('btn-menu').setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('pointerdown', e => {
    if (!$('menu').hidden && !e.target.closest('#menu, #btn-menu')) closeMenu();
  });
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-select').addEventListener('click', () => setSelectMode(true));
  $('btn-cancel').addEventListener('click', () => setSelectMode(false));
  $('btn-merge').addEventListener('click', merge);
  $('btn-fit').addEventListener('click', fit);
  $('btn-export').addEventListener('click', () => {
    closeMenu();
    const json = JSON.stringify({ version: 3, nodes, groups }, null, 2);
    navigator.clipboard?.writeText(json)
      .then(() => toast(t('copied')))
      .catch(() => toast(t('copyRefused')));
  });
  let resetPending = null;
  $('btn-reset').addEventListener('click', e => {
    const b = e.currentTarget;
    if (!resetPending) {                       // first tap: ask for confirmation
      b.textContent = t('confirmReset');
      resetPending = setTimeout(() => { b.textContent = t('reset'); resetPending = null; }, CONFIRM_DELAY);
      return;
    }
    clearTimeout(resetPending);
    resetPending = null;
    b.textContent = t('reset');
    closeMenu();
    nodes = clone(EXAMPLE);
    selection = INITIAL_SELECTION;
    groups = [];
    saveState();
    draw();
    fit();
    toast(t('resetDone'));
  });

  // ---------- Startup ----------
  changeLanguage(false);                        // applies the saved language (translates it if needed)
  requestAnimationFrame(fit);
  addEventListener('resize', () => centerOn(selection));   // e.g. the keyboard opening

  // Offline mode (PWA): skipped where service workers are not allowed
  try {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  } catch { /* ignored */ }
}
