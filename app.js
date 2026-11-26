/* Ramifai — proof of concept (POC), v6
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
 * 7. LLM: the user picks a provider (Claude, Gemini, Groq, OpenRouter or ChatGPT; three have a free
 *    tier) and pastes its key, kept on the device. The question is sent with the compact context;
 *    the answer streams in, then the LLM fills in the node's card (keyword, emoji, summary).
 *    Without a key: simulated answers (demo mode).
 *    Each answer can be regenerated (with any provider) or merged: a node keeps all its versions.
 *    Placement: the app can choose by itself which box a new question follows from.
 *    Synthesis of the tree (written by the LLM, or the summaries put end to end) and exports.
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

  // ---------- LLM providers ----------
  // format: how requests are written. 'anthropic' = Claude's Messages API; 'openai' = Chat Completions,
  //   also used by Groq and OpenRouter; 'gemini' = Google's own API.
  // models: suggestions, the first one is the default. With a key, the app asks the provider for its
  //   model list: keep / skip filter that list (to drop models that cannot chat), pinned stays at its top,
  //   prefer picks the default in it when the current model is not offered (models get renamed often).
  // label / note: keys of texts in UI. cardModel: smaller model for the node card and the translation.
  const PROVIDERS = {
    anthropic: { name: 'Claude', format: 'anthropic', base: 'https://api.anthropic.com/v1', placeholder: 'sk-ant-…',
      label: 'providerAnthropic', note: 'noteAnthropic',
      models: ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'],
      modelLabels: { 'claude-sonnet-5-5': 'modelSonnet', 'claude-haiku-5-5': 'modelHaiku', 'claude-opus-5-5': 'modelOpus' },
      cardModel: 'claude-haiku-5-5' },
    gemini: { name: 'Gemini', format: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta', placeholder: 'AIza…',
      label: 'providerGemini', note: 'noteGemini', list: true,
      models: ['gemini-flash-latest', 'gemini-flash-lite-latest'],
      keep: /^gemini/, skip: /tts|image|live|audio|embed|transcribe|translate|omni|robotics|computer|research/,
      prefer: [/^gemini-flash-latest$/, /^gemini-[\d.]+-flash$/] },
    groq: { name: 'Groq', format: 'openai', base: 'https://api.groq.com/openai/v1', placeholder: 'gsk_…',
      label: 'providerGroq', note: 'noteGroq', list: true,
      models: ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile'],
      skip: /whisper|tts|guard|orpheus|playai|compound/, prefer: [/gpt-oss-120b/, /llama-3\.3-70b/] },
    openrouter: { name: 'OpenRouter', format: 'openai', base: 'https://openrouter.ai/api/v1', placeholder: 'sk-or-…',
      label: 'providerOpenrouter', note: 'noteOpenrouter', list: true,
      models: ['openrouter/free'], pinned: ['openrouter/free'], keep: /:free$/ },
    openai: { name: 'ChatGPT', format: 'openai', base: 'https://api.openai.com/v1', placeholder: 'sk-…',
      label: 'providerOpenai', note: 'noteOpenai', list: true,
      models: ['gpt-5-mini'], keep: /^(gpt|o\d)/,
      skip: /audio|realtime|tts|transcribe|image|embed|search|moderation|codex|instruct|\d{4}-\d\d-\d\d/,
      prefer: [/^gpt-[\d.]+-mini$/, /^gpt-[\d.]+$/] },
  };
  const DEFAULT_PROVIDER = 'anthropic';
  const API_VERSION = '2026-10-21';    // Anthropic API version
  const MODEL_PAGE = 1000;             // models asked from Gemini's list in one call
  const JSON_INSTRUCTION = 'Answer with a single JSON object that follows this JSON Schema, and nothing else:\n';
  const MAX_TOKENS_ANSWER = 4096;
  const MAX_TOKENS_CARD = 300;
  const MAX_TOKENS_TRANSLATION = 6000;
  const MAX_TOKENS_ROUTE = 200;
  const MAX_TOKENS_SYNTHESIS = 2000;
  const MAX_INDEX = 120;               // boxes listed at most in the tree index sent to the LLM
  const BREADCRUMB_DEPTH = 2;          // keywords shown in the 📍 marker
  const SNACK_DURATION = 6000;         // ms
  const DOWNLOAD_DELAY = 1000;         // ms before a download link is released
  const MD_MAX_LEVEL = 6;              // deepest Markdown heading
  const MAP_MARGIN = 20;               // px around the tree drawn in exports
  const LIMIT_STATUSES = [402, 429];   // HTTP codes meaning "quota or credits used up"
  const VERSION_FIELDS = ['a', 'kw', 'sum', 'ico', 'usage', 'by', 'error'];   // fields that change from one version to another
  const PLACEMENTS = ['accurate', 'economical', 'off'];   // the first one is the default
  const TRAILER_START = '<<<{';        // economical mode: start of the line where the LLM places the box
  const APP_NAME = 'Ramifai';
  const EXPORT_VERSION = 4;
  const EXPORT_INK = '#101418', EXPORT_PAPER = '#ffffff', EXPORT_LINE = '#5d6873';
  const EXPORT_CSS = 'body{margin:0 auto;max-width:860px;padding:16px;font:16px/1.5 system-ui,sans-serif;color:#101418}' +
    '.map{display:block;width:100%;height:auto;margin:12px 0 20px}' +
    'details{margin:8px 0;padding-inline-start:14px;border-inline-start:3px solid #d3d9df}' +
    'summary{font-weight:800;cursor:pointer}.q{font-weight:650;margin:6px 0 2px}.a{white-space:pre-wrap;margin:0 0 6px}' +
    '.version{font-size:13px;font-style:italic;color:#5d6873;margin:8px 0 2px}.a,.q,summary{unicode-bidi:plaintext}';
  const CARD_INPUT_LENGTH = 6000;      // characters of the answer sent to build the card
  const LLM_KEYWORD_LENGTH = 30;       // characters kept for an LLM-generated keyword
  const SETTINGS_KEY = 'arbre-llm-settings';
  const TRANSLATIONS_KEY = 'arbre-llm-translations';
  const INSTRUCTION = 'You are answering inside a tree-shaped conversation app. Answer in the language of the question, ' +
    'in plain text, without Markdown or LaTeX: write formulas in a readable notation (Unicode) and define every notation.';
  const MERGE_INSTRUCTION = 'Here are several answers already given to this question. Write one answer that combines ' +
    'their best points, removes repetitions and points out where they disagree.';
  const ECONOMY_INSTRUCTION = 'After your answer, add one last line in exactly this form, with nothing after it: ' +
    '<<<{"parent": "id of the box this message follows from: the current box to continue, an earlier box to go back to its topic, ' +
    'or root for a new topic", "keyword": "1 to 3 words", "emoji": "one emoji, or empty", "summary": "25 words at most"}>>>';
  const SYNTHESIS_INSTRUCTION = 'Write a synthesis of this conversation tree so that the user, or another AI, can carry on ' +
    'from where the user is. Parts: goal; what has been explored, branch by branch; key conclusions and decisions; ' +
    'where the user is now; open questions. Plain text with dashes for lists, no other Markdown, in the language of ' +
    'the conversation, 400 words at most.';

  // ---------- Interface texts (English reference, translated by the LLM on demand) ----------
  // {name} marks a value inserted by the code; a translation must keep exactly the same ones.
  const UI = {
    select: 'Select', fit: 'Fit', moreActions: 'More actions', merge: 'Merge ({count})', cancel: 'Cancel',
    settingsMenu: 'Settings', reset: 'Reset', confirmReset: 'Confirm?', mapLabel: 'Conversation map',
    gaugesLabel: "Tokens used. Tap to change the model's context size.", gaugePath: 'Path', gaugeTree: 'Tree',
    tabThread: 'Thread', tabContext: 'LLM context', questionLabel: 'New question', send: 'Send',
    settingsTitle: 'Settings', settingsDemoNote: 'Without a key, the app stays in demo mode (simulated answers).',
    provider: 'AI provider', apiKey: 'API key', model: 'Model', workspace: 'Workspace ID (only if the API asks for it)',
    keepKey: 'Keep the key on this device',
    keyNote: 'The key stays on this device and is only sent to {host}. If the box above is unticked, ' +
      'the key is forgotten when the app closes.',
    providerAnthropic: 'Claude (Anthropic) · paid', providerGemini: 'Gemini (Google) · free tier',
    providerGroq: 'Groq (open models) · free tier', providerOpenrouter: 'OpenRouter · free models',
    providerOpenai: 'ChatGPT (OpenAI) · paid',
    noteAnthropic: 'Paid: buy credits in the Claude Console (platform.claude.com), create the key there and set a spending limit.',
    noteGemini: 'Free tier: create the key at aistudio.google.com. On the free tier, Google may use your conversations ' +
      'to improve its products.',
    noteGroq: 'Free tier, no card needed: create the key at console.groq.com. Beyond the free limits, requests are refused, not billed.',
    noteOpenrouter: 'Free models: create the key at openrouter.ai. The model openrouter/free picks a free model for you. ' +
      'About 50 free requests a day; each question uses 2.',
    noteOpenai: 'Paid: buy credits at platform.openai.com and create the key there. ChatGPT Pro and Business include monthly API credits.',
    placement: 'New questions', placementAccurate: 'Placed automatically · accurate (3 requests per question)',
    placementEconomical: 'Placed automatically · economical (1 request per question)',
    placementOff: 'Always where I am (2 requests per question)',
    placementNote: 'Automatic: just write, the app finds the right box in the tree. Tap 📍 above the question box ' +
      'to keep the next question where you are.',
    language: 'Interface language',
    languageNote: 'Translated by the AI the first time (an API key is needed), then kept on this device.',
    retranslate: 'Retranslate', clearKey: 'Clear key', close: 'Close', save: 'Save',
    modelSonnet: 'Sonnet 5.5 (balanced)', modelHaiku: 'Haiku 5.5 (fast, low cost)', modelOpus: 'Opus 5.5 (most capable)',
    modeDemo: 'POC · demo without LLM', selectHint: 'Tap the boxes to merge', rootLabel: 'Start',
    pickTwo: 'Pick at least two boxes.', merged: '{count} boxes merged. Tap the box to expand it.', expanded: 'Box expanded',
    rootSummary: 'Ask a first question to start a new branch.', placeholder: 'After “{keyword}”…',
    noExchange: 'No exchange on this path yet.', retry: 'Retry',
    answering: 'Answer in progress…', placing: 'Finding where this question belongs…',
    regenerate: 'Regenerate', regenerateWith: 'Regenerate with:', mergeVersions: 'Merge versions', move: 'Move',
    previous: 'Previous version', next: 'Next version', versionOf: '{index}/{count}',
    auto: 'automatic', fixed: 'fixed here', placedUnder: 'Placed under “{keyword}”', moveHint: 'Tap the new parent box',
    moved: 'Moved under “{keyword}”', cannotMove: 'Not possible: pick a box outside this branch.',
    nothingToSend: 'Nothing to send: a question asked here goes without context.',
    tokensApprox: '≈ {count} tokens',
    contextStat: 'sent to the LLM for a question asked here, versus ≈ {full} tokens for the whole path in full (exchanges: {count}).',
    earlierSteps: 'Earlier steps: summary only', lastExchanges: 'Last exchanges: in full',
    contextRule: 'Rule: the last {count} exchanges in full, a summary of the earlier ones, nothing from neighbouring branches. ' +
      'Estimate: 1 token ≈ {chars} characters.',
    contextSize: "Model's maximum context: {count} tokens", restartKeyword: 'Restart',
    restartQuestion: 'Restart of “{keyword}” in a new conversation',
    restartSummary: 'New conversation starting from the summary of “{keyword}”.',
    restartDone: 'New conversation created from the summary',
    demoAnswer: 'Demo mode: simulated answer to “{question}”.\nFor real answers, choose an AI provider in ⋯ → Settings ' +
      'and paste its key (some are free).',
    questionSummary: 'Question: {question}', interrupted: 'Answer interrupted.', llmError: 'The LLM returned an error',
    emptyAnswer: 'The model returned an empty answer.',
    apiKeyRejected: 'API key rejected: check it in the settings',
    quotaReached: 'quota reached: wait a little or switch provider in the settings', connected: '{provider} is connected',
    demoOn: 'Demo mode: simulated answers', copyRefused: 'Copy refused by the browser',
    synthesis: 'Synthesis', synthesisTitle: 'Synthesis of the tree', writingSynthesis: 'Writing the synthesis…',
    localSynthesisNote: 'Automatic summary (the AI could not be reached): the summaries of the boxes, put end to end.',
    whereWeAre: 'Where we are', treeOutline: 'Tree', copy: 'Copy', copiedText: 'Copied', newBranch: 'New branch from it',
    limitTitle: 'Limit reached',
    limitText: '{provider} refuses new requests for now (quota or credits used up). You can continue with another ' +
      'provider, or copy the synthesis to use it elsewhere.',
    continueWith: 'Continue with {provider}', exportMenu: 'Export', exportTitle: 'Export the tree',
    exportNote: 'PDF: choose “Save as PDF” in the print window.', otherVersion: 'Other version ({by})',
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
    for (const o of $('set-provider').options) o.textContent = t(PROVIDERS[o.value].label);
    for (const o of $('set-placement').options) o.textContent = t(placementLabel(o.value));
    $('subtitle').textContent = moving ? t('moveHint') : modeSelect ? t('selectHint') : modeLabel();
    fillWhere();
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
  // One call to the LLM, asked to answer with a fixed format; each text is checked
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
      '(for example {count}), keep the line breaks, and keep product names, technical names and web addresses unchanged ' +
      '(Ramifai, Claude, Anthropic, Claude Console, Sonnet, Haiku, Opus, Gemini, Google, Groq, OpenRouter, ChatGPT, OpenAI, ' +
      'openrouter/free, platform.claude.com, JSON, LLM, API, POC, HTML, PDF, Markdown, OPML), and keep emojis such as 📍.\n\n' +
      JSON.stringify(UI, null, 1);
    const out = await structured(using(settings.provider), tool, prompt, MAX_TOKENS_TRANSLATION);
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
    if (!apiKey()) { toast(t('translationNeedsKey')); return; }
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
    if (n.pending || n.placing) Object.assign(n, { pending: false, error: true, a: n.a || UI.interrupted });
    delete n.placing;
  }
  let modeSelect = false;
  let moving = null;                           // box being moved: the next tapped box becomes its parent
  let pinned = false;                          // the user chose the box: the next question goes there, unplaced
  let regenChoice = null;                      // box whose "Regenerate with" choice is open
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
  function visibleTree(groupList = groups) {
    const groupOf = {};
    for (const g of groupList) for (const m of g.members) groupOf[m] = g;
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
      const active = onPath.has(u.id);
      layer.append(svgEl('path', {
        d: linkPath(P[u.parent], P[u.id]),
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
  function linkPath(a, b) {                    // curve from a parent box down to its child's box
    const y0 = a.y + NODE_HEIGHT / 2, y1 = b.y - NODE_HEIGHT / 2 - ARROW_GAP, my = (y0 + y1) / 2;
    return `M${a.x},${y0} C${a.x},${my} ${b.x},${my} ${b.x},${y1}`;
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
    if (moving) { moveTo(u.group ? u.rep.id : u.id); return; }
    if (modeSelect) {
      const ids = u.group ? u.group.members : [u.id];
      const allTicked = ids.every(i => ticked.has(i));
      ids.forEach(i => (allTicked ? ticked.delete(i) : ticked.add(i)));
      draw();
      $('btn-merge').textContent = t('merge', { count: completeGroup().size });
      return;
    }
    if (u.group) { expand(u.group.id); return; }
    pinned = true;
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

  // ---------- Moving a box (and its branch) under another parent ----------
  function startMove(id) {
    moving = id;
    document.body.classList.add('select-mode', 'move-mode');
    $('panel').classList.add('collapsed');
    $('handle').setAttribute('aria-expanded', 'false');
    applyStaticTexts();
  }
  function endMove() {
    moving = null;
    document.body.classList.remove('select-mode', 'move-mode');
    applyStaticTexts();
  }
  function moveTo(targetId) {
    const n = node(moving);
    if (!n || path(targetId).some(m => m.id === n.id)) { toast(t('cannotMove')); return; }
    const branch = new Set(nodes.filter(m => path(m.id).some(a => a.id === n.id)).map(m => m.id));
    groups = groups.filter(g => !g.members.some(m => branch.has(m)));   // a merged box touching the branch is expanded
    n.parent = targetId;
    n.pv = node(targetId).v;
    endMove();
    select(n.id, true);
    toast(t('moved', { keyword: keyword(node(targetId)) }));
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
      if (m.id === selection && !m.pending && !m.placing) block.append(...tools(m));
      thread.append(block);
    });
    // Follow-ups already explored from here: one arrow fanning out to each of them, above its button
    const next = children(selection);
    if (next.length) {
      const d = htmlEl('div', 'follow-ups');
      next.forEach((c, i) => {
        const item = htmlEl('div', 'follow-up');
        item.dataset.id = c.id;                // the arrow and the button both open this follow-up
        const b = htmlEl('button', null, label(c));
        b.type = 'button';
        item.append(htmlEl('span', 'fan', fanArrow(i, next.length)), b);
        d.append(item);
      });
      thread.append(d);
    }
    requestAnimationFrame(() => thread.querySelector('.current')?.scrollIntoView({ block: 'nearest' }));
    fillContext(contextPath(selection));
    fillGauges(p);
    fillWhere();
  }

  // Buttons under the current answer: versions, regenerate, merge, move
  function tools(m) {
    const button = (row, act, text, extra = {}) => {
      const b = htmlEl('button', null, text);
      b.type = 'button';
      b.dataset.act = act;
      Object.assign(b.dataset, extra.data || {});
      if (extra.aria) b.setAttribute('aria-label', extra.aria);
      row.append(b);
    };
    const row = htmlEl('div', 'tools'), count = m.versions?.length || 1;
    if (count > 1) {
      button(row, 'prev', '‹', { aria: t('previous') });
      row.append(htmlEl('span', 'version', t('versionOf', { index: m.v + 1, count }) + (m.by ? ' · ' + m.by : '')));
      button(row, 'next', '›', { aria: t('next') });
    }
    button(row, 'regen', '↻ ' + t('regenerate'));
    if (count > 1) button(row, 'merge', '⇄ ' + t('mergeVersions'));
    button(row, 'move', '↗ ' + t('move'));
    if (regenChoice !== m.id) return [row];
    const choice = htmlEl('div', 'tools');
    choice.append(htmlEl('span', 'version', t('regenerateWith')));
    for (const id of readyProviders()) button(choice, 'regen-with', PROVIDERS[id].name, { data: { provider: id } });
    return [row, choice];
  }
  const readyProviders = () => Object.keys(PROVIDERS).filter(id => settings.keys[id]);
  function toolAction(act, pid) {
    const n = node(selection);
    if (act === 'prev' || act === 'next') {
      const count = n.versions.length;
      showVersion(n, (n.v + (act === 'next' ? 1 : count - 1)) % count);
      saveState();
      draw();
      return;
    }
    if (act === 'regen' && readyProviders().length > 1) {    // several providers: choose which one
      regenChoice = regenChoice === n.id ? null : n.id;
      fillPanel();
      return;
    }
    if (act === 'regen' || act === 'regen-with') {
      regenChoice = null;
      addVersion(n);
      answer(n, { pid: pid || settings.provider });
    } else if (act === 'merge') {
      addVersion(n);
      answer(n, { merge: true });
    } else if (act === 'move') startMove(n.id);
  }

  // 📍 marker above the question box: where the next question goes, and whether the app may place it elsewhere
  const autoPlacement = () => settings.placement !== 'off' && Boolean(apiKey());
  function fillWhere() {
    const crumb = path(selection).slice(-BREADCRUMB_DEPTH).map(keyword).join(' › ');
    $('where').textContent = `📍 ${crumb}` + (autoPlacement() ? ` · ${t(pinned ? 'fixed' : 'auto')}` : '');
    $('where').disabled = !autoPlacement();
  }
  $('where').addEventListener('click', () => { pinned = !pinned; fillWhere(); });

  // Left-most follow-up: ↙, right-most: ↘, the others: ↓ (mirrored by the style sheet in right-to-left languages)
  const fanArrow = (i, count) => (count === 1 || (i > 0 && i < count - 1) ? '↓' : i === 0 ? '↙' : '↘');
  // While an answer streams in, the economical mode's last line is hidden
  const answerText = n => (n.pending ? n.a.split(TRAILER_START)[0] : n.a) || (n.placing ? t('placing') : n.pending ? t('answering') : '');
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

  // Path almost full: the synthesis lets the user carry on in a new branch, or elsewhere
  $('btn-restart').addEventListener('click', () => openSynthesis());

  $('thread').addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) { toolAction(act.dataset.act, act.dataset.provider); return; }
    const r = e.target.closest('[data-retry]');
    if (r) { answer(node(r.dataset.retry)); return; }
    const c = e.target.closest('[data-id]');
    if (c) { pinned = true; select(c.dataset.id, true); }
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
  $('ask-form').addEventListener('submit', async e => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    // Temporary keyword, icon and summary, replaced by the LLM's card once the answer has arrived.
    // pv: version of the parent box shown when the question was asked (its context).
    const n = { id: 'n' + newId(), parent: selection, pv: node(selection).v, q, a: '',
      ico: guessIcon(q), kw: guessKeyword(q), sum: t('questionSummary', { question: shorten(q, SUMMARY_LENGTH) }) };
    nodes.push(n);
    input.value = '';
    input.style.height = '';
    const auto = autoPlacement() && !pinned;
    pinned = false;
    if (auto && settings.placement === 'accurate' && nodes.length > 2) {   // a first request chooses the box
      n.placing = true;
      select(n.id, true);
      await route(n);
      delete n.placing;
      draw();
    }
    answer(n, { economical: auto && settings.placement === 'economical' });
    select(n.id, true);
  });

  // ---------- Versions of an answer ----------
  // A node shows one version (its fields a, kw, sum, ico…); n.versions keeps them all and n.v is the one shown.
  const pick = n => Object.fromEntries(VERSION_FIELDS.filter(k => n[k] !== undefined).map(k => [k, n[k]]));
  function saveVersion(n) {
    if (!n.versions) { n.versions = []; n.v = 0; }
    n.versions[n.v] = pick(n);
  }
  function showVersion(n, i) {
    saveVersion(n);
    for (const k of VERSION_FIELDS) delete n[k];
    n.v = i;
    Object.assign(n, n.versions[i]);
  }
  function addVersion(n) {                     // new empty version; the keyword stays until its new card arrives
    saveVersion(n);
    const { kw, ico, sum } = n;
    for (const k of VERSION_FIELDS) delete n[k];
    n.versions.push({});
    n.v = n.versions.length - 1;
    Object.assign(n, { kw, ico, sum, a: '' });
  }
  const otherVersions = n => (n.versions || []).filter((v, i) => i !== n.v && v.a && !v.error);
  // A box as its child saw it: the version shown when the child's question was asked
  const seenBy = (m, child) => (child.pv != null && m.versions?.[child.pv] ? { ...m, ...m.versions[child.pv] } : m);
  function contextPath(id, child = null) {     // path to a box, each box in the version its next question was asked from
    const p = path(id).filter(m => m.id !== ROOT);
    return p.map((m, i) => (p[i + 1] || child ? seenBy(m, p[i + 1] || child) : m));
  }

  // ---------- Answer: the chosen LLM if a key is set, otherwise a simulated answer ----------
  // how.pid: provider to use; how.merge: combine the versions; how.economical: answer, place and card in one request
  async function answer(n, how = {}) {
    const use = using(how.pid || settings.provider);
    Object.assign(n, { pending: true, error: false, a: '' });
    delete n.usage;
    if (selection === n.id) fillPanel();
    if (!use.key) {
      setTimeout(() => {
        Object.assign(n, { pending: false, a: t('demoAnswer', { question: n.q }) });
        saveVersion(n);
        saveState();
        if (selection === n.id) fillPanel();
      }, DEMO_DELAY);
      return;
    }
    try {
      const { system, messages } = how.merge ? mergeRequest(n) : buildRequest(n);
      await askLLM(n, use, how.economical ? system + economyPrompt(n) : system, messages);
      const trailer = how.economical ? takeTrailer(n) : null;
      Object.assign(n, { pending: false, by: byLabel(use) });
      saveVersion(n);
      saveState();
      if (selection === n.id) fillPanel();
      if (trailer) {
        applyCard(n, trailer);
        placeAt(n, trailer.parent);
      } else if (!how.economical) {
        try { applyCard(n, await structured(use, CARD_TOOL, cardPrompt(n), MAX_TOKENS_CARD)); } catch { /* the card is optional */ }
      }
    } catch (err) {
      Object.assign(n, { pending: false, error: true, a: '⚠️ ' + err.message });
      toast(t('llmError'));
      if (LIMIT_STATUSES.includes(err.status)) openLimit(n, use.id);
    }
    saveVersion(n);
    saveState();
    draw();
  }

  // ---------- LLM calls ----------
  // use: { id, p: provider, key, model, light: smaller model for cards, placement and translation }
  function using(pid) {
    const p = PROVIDERS[pid], model = settings.models[pid] || p.models[0];
    return { id: pid, p, key: settings.keys[pid] || '', model, light: p.cardModel || model };
  }
  const provider = () => PROVIDERS[settings.provider];
  const apiKey = () => settings.keys[settings.provider] || '';
  const currentModel = () => settings.models[settings.provider] || provider().models[0];
  const byLabel = use => `${use.p.name} · ${use.model.split('/').pop()}`;
  const cleanText = s => s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();   // some open models show their reasoning
  function parseObject(text) {                 // the JSON object in a text, ignoring what surrounds it
    const i = text.indexOf('{'), j = text.lastIndexOf('}');
    return i < 0 || j < i ? null : JSON.parse(text.slice(i, j + 1));
  }

  function headers({ p, key }) {
    const h = { 'content-type': 'application/json' };
    if (p.format === 'anthropic') {
      Object.assign(h, {
        'x-api-key': key,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',   // allows calling the API directly from a browser
      });
      if (settings.workspace) h['anthropic-workspace-id'] = settings.workspace;
    } else if (p.format === 'gemini') h['x-goog-api-key'] = key;
    else h.authorization = 'Bearer ' + key;
    return h;
  }
  async function apiError(r) {
    let msg = `Error ${r.status}`;
    try {
      const j = await r.json();
      const e = (Array.isArray(j) ? j[0] : j)?.error;          // Gemini may wrap its error in a list
      if (e?.message) msg += ': ' + e.message;
    } catch { /* unreadable body */ }
    if (r.status === 401 || r.status === 403) msg += ` (${t('apiKeyRejected')})`;
    if (LIMIT_STATUSES.includes(r.status)) msg += ` (${t('quotaReached')})`;
    return Object.assign(new Error(msg), { status: r.status });
  }

  // Address and body of a request, in the provider's format. messages: [{ role: 'user' | 'assistant', content }]
  function request(use, model, system, messages, { stream = false, maxTokens = MAX_TOKENS_ANSWER, json = false } = {}) {
    const p = use.p;
    if (p.format === 'anthropic') return { url: `${p.base}/messages`, body: { model, max_tokens: maxTokens, stream, system, messages } };
    if (p.format === 'gemini') {
      const action = stream ? 'streamGenerateContent?alt=sse' : 'generateContent';
      return {
        url: `${p.base}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:${action}`,
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          ...(json ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
        },
      };
    }
    return { url: `${p.base}/chat/completions`, body: { model, stream, messages: [{ role: 'system', content: system }, ...messages] } };
  }

  // Text and token counts found in a response, or in one piece of a streamed response
  function readPiece(format, d) {
    if (d.error) throw new Error(d.error.message || String(d.error));
    if (format === 'anthropic') return {
      text: d.content ? d.content.filter(b => b.type === 'text').map(b => b.text).join('')
        : d.type === 'content_block_delta' && d.delta.type === 'text_delta' ? d.delta.text : '',
      input: d.type === 'message_start' ? d.message.usage.input_tokens : undefined,
      output: d.type === 'message_delta' ? d.usage?.output_tokens : undefined,
    };
    if (format === 'gemini') return {
      text: (d.candidates?.[0]?.content?.parts || []).filter(x => !x.thought).map(x => x.text || '').join(''),
      input: d.usageMetadata?.promptTokenCount, output: d.usageMetadata?.candidatesTokenCount,
    };
    const choice = d.choices?.[0], u = d.usage || d.x_groq?.usage;
    return { text: choice?.delta?.content || choice?.message?.content || '', input: u?.prompt_tokens, output: u?.completion_tokens };
  }

  // Request: instruction + summary of earlier steps, then the last exchanges in full, then the question
  function buildRequest(n) {
    const { earlier, recent } = split(contextPath(n.parent, n));
    let system = INSTRUCTION;
    if (earlier.length) system += '\n\nSummary of the earlier steps of this branch:\n' + earlier.map(m => `- ${m.kw}: ${m.sum}`).join('\n');
    const messages = [];
    for (const m of recent) {
      if (m.a && !m.error) messages.push({ role: 'user', content: m.q }, { role: 'assistant', content: m.a });
    }
    messages.push({ role: 'user', content: n.q });
    return { system, messages };
  }
  function mergeRequest(n) {                   // same context, but the question comes with the existing answers
    const { system, messages } = buildRequest(n);
    const list = n.versions.filter(v => v.a && !v.error).map((v, i) => `Answer ${i + 1} (${v.by || 'LLM'}):\n${v.a}`).join('\n\n');
    messages[messages.length - 1] = { role: 'user', content: `${n.q}\n\n${MERGE_INSTRUCTION}\n\n${list}` };
    return { system, messages };
  }

  // Streaming call: the answer is displayed as it arrives. All three formats send "data: {…}" lines.
  async function askLLM(n, use, system, messages) {
    const { url, body } = request(use, use.model, system, messages, { stream: true });
    const r = await fetch(url, { method: 'POST', headers: headers(use), body: JSON.stringify(body) });
    if (!r.ok) throw await apiError(r);
    const reader = r.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();                    // last line, possibly incomplete
      for (const line of lines) {
        const data = line.startsWith('data:') ? line.slice(5).trim() : '';
        if (!data || data === '[DONE]') continue;   // other lines (event names, comments) are ignored
        const piece = readPiece(use.p.format, JSON.parse(data));
        if (piece.text) { n.a += piece.text; showStream(n); }
        if (piece.input != null || piece.output != null) {
          n.usage = { input: piece.input ?? n.usage?.input ?? 0, output: piece.output ?? n.usage?.output ?? 0 };
        }
      }
    }
    n.a = cleanText(n.a);
    if (!n.a) throw new Error(t('emptyAnswer'));
  }
  function showStream(n) {                     // updates only the answer text
    if (selection !== n.id) return;
    const p = document.querySelector(`#thread [data-id="${CSS.escape(n.id)}"] .a`);
    if (p) p.textContent = answerText(n);
  }
  async function complete(use, model, system, messages, maxTokens, json = false) {   // one answer, not streamed
    const { url, body } = request(use, model, system, messages, { maxTokens, json });
    const r = await fetch(url, { method: 'POST', headers: headers(use), body: JSON.stringify(body) });
    if (!r.ok) throw await apiError(r);
    return cleanText(readPiece(use.p.format, await r.json()).text);
  }

  // Structured answer following a "tool" schema. Claude is forced to fill in the tool; the other
  // providers are asked for a JSON object following the same schema, read from their text.
  async function structured(use, tool, prompt, maxTokens) {
    if (use.p.format === 'anthropic') {
      const r = await fetch(`${use.p.base}/messages`, {
        method: 'POST', headers: headers(use),
        body: JSON.stringify({
          model: use.light, max_tokens: maxTokens,
          tools: [tool], tool_choice: { type: 'tool', name: tool.name },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) throw await apiError(r);
      return (await r.json()).content?.find(b => b.type === 'tool_use')?.input;
    }
    const system = JSON_INSTRUCTION + JSON.stringify(tool.input_schema);
    return parseObject(await complete(use, use.light, system, [{ role: 'user', content: prompt }], maxTokens, true));
  }

  // Node card: keyword, emoji and summary of an exchange
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
  const cardPrompt = n => `Question: ${n.q}\n\nAnswer: ${n.a.slice(0, CARD_INPUT_LENGTH)}\n\n` +
    'Fill in the card for this exchange, in the language of the question.';
  function applyCard(n, c) {
    if (!c) return;
    if (c.keyword) n.kw = shorten(String(c.keyword), LLM_KEYWORD_LENGTH);
    n.ico = [...String(c.emoji || '')].slice(0, 4).join('');   // an emoji can span several characters
    if (c.summary) n.sum = String(c.summary);
  }

  // ---------- Placement: which box a new question follows from ----------
  // Tree index sent to the LLM: one line per box (id, parent, keyword, summary). The boxes near the
  // current one come first, then the most recent ones, MAX_INDEX at most.
  function treeIndex(currentId, excludeId = null) {
    const near = new Set([...path(currentId), ...children(currentId)].map(m => m.id));
    const room = MAX_INDEX - near.size;
    const others = nodes.filter(m => !near.has(m.id) && m.id !== excludeId);
    const keep = new Set([...near, ...(room > 0 ? others.slice(-room) : []).map(m => m.id)]);
    keep.delete(excludeId);
    return nodes.filter(m => keep.has(m.id)).map(m => `${m.id} | under ${m.parent ?? '-'} | ` +
      (m.id === ROOT ? 'Start' : `${m.ico || ''} ${m.kw}: ${m.sum}`) + (m.id === currentId ? ' | CURRENT BOX' : '')).join('\n');
  }
  const ROUTE_TOOL = {
    name: 'place',
    description: 'Box of a conversation tree that a new message follows from',
    input_schema: {
      type: 'object',
      properties: {
        parent: { type: 'string', description: 'id of the box: the current box to continue, an earlier box to go back to its topic, or root for a new topic' },
      },
      required: ['parent'],
    },
  };
  async function route(n) {                    // accurate mode: a first, small request chooses the box
    const prompt = `Conversation tree (one box per line):\n${treeIndex(n.parent, n.id)}\n\nNew message: ${n.q}\n\n` +
      'Which box does this new message follow from?';
    try { placeAt(n, (await structured(using(settings.provider), ROUTE_TOOL, prompt, MAX_TOKENS_ROUTE))?.parent); }
    catch { /* the question stays where the user is */ }
  }
  const economyPrompt = n => `\n\n${ECONOMY_INSTRUCTION}\n\nConversation tree (one box per line):\n${treeIndex(n.parent, n.id)}`;
  function takeTrailer(n) {                    // economical mode: the last line, read then removed from the answer
    const i = n.a.lastIndexOf(TRAILER_START);
    if (i < 0) return null;
    let data = null;
    try { data = parseObject(n.a.slice(i)); } catch { /* malformed: ignored */ }
    n.a = n.a.slice(0, i).trim();
    return data;
  }
  function placeAt(n, id) {                    // moves a new box under the chosen parent, if that choice is valid
    const target = node(String(id ?? ''));
    if (!target || target.id === n.parent || path(target.id).some(m => m.id === n.id)) return;
    n.parent = target.id;
    n.pv = target.v;
    snack(t('placedUnder', { keyword: keyword(target) }), t('move'), () => startMove(n.id));
  }

  // ---------- Synthesis of the tree ----------
  function synthesisInput() {
    const p = contextPath(selection);
    return `Conversation tree (one box per line):\n${treeIndex(selection)}\n\n` +
      `Path to the current box: ${['Start', ...p.map(m => m.kw)].join(' > ')}\n\n` +
      'Last exchanges in full:\n' + split(p).recent.map(m => `Q: ${m.q}\nA: ${m.a}`).join('\n\n');
  }
  function localSynthesis() {                  // without the AI: the summaries of the boxes, put end to end
    const lines = [`${t('whereWeAre')}: ${path(selection).map(label).join(' › ')}`, '', `${t('treeOutline')}:`];
    (function walk(id, indent) {
      for (const c of children(id)) { lines.push(`${indent}- ${label(c)}: ${c.sum}`); walk(c.id, indent + '  '); }
    })(ROOT, '');
    return lines.join('\n');
  }
  let lastSynthesis = '';
  async function openSynthesis() {
    closeMenu();
    lastSynthesis = '';
    openSheet({ title: t('synthesisTitle'), body: t('writingSynthesis'), actions: [{ label: t('close') }] });
    let text = '', note = '';
    try {
      const use = using(settings.provider);
      if (use.key) text = await complete(use, use.model, SYNTHESIS_INSTRUCTION, [{ role: 'user', content: synthesisInput() }], MAX_TOKENS_SYNTHESIS);
    } catch { /* quota used up, network…: summaries instead */ }
    if (!text) { text = localSynthesis(); note = t('localSynthesisNote'); }
    lastSynthesis = text;
    if (!$('sheet').open) return;               // closed meanwhile
    openSheet({ title: t('synthesisTitle'), text: note, body: text, actions: [
      { label: t('copy'), primary: true, keepOpen: true, run: () => copyText(lastSynthesis) },
      { label: t('newBranch'), run: () => newBranchFrom(lastSynthesis) },
      { label: t('close') },
    ] });
  }
  function copyText(text) {
    navigator.clipboard?.writeText(text).then(() => toast(t('copiedText'))).catch(() => toast(t('copyRefused')));
  }
  function newBranchFrom(text) {               // a new branch of the same tree, starting from the synthesis
    const origin = node(selection);
    const n = { id: 'n' + newId(), parent: ROOT, ico: '♻️', kw: t('restartKeyword'),
      q: t('restartQuestion', { keyword: keyword(origin) }), a: text,
      sum: t('restartSummary', { keyword: keyword(origin) }) };
    nodes.push(n);
    pinned = true;                             // the next question continues from it
    select(n.id, true);
    toast(t('restartDone'));
  }

  // ---------- Limit reached: another provider, or the synthesis ----------
  function openLimit(n, pid) {
    const others = readyProviders().filter(id => id !== pid);
    openSheet({ title: t('limitTitle'), text: t('limitText', { provider: PROVIDERS[pid].name }), actions: [
      ...others.map(id => ({ label: t('continueWith', { provider: PROVIDERS[id].name }), primary: true, run: () => {
        settings.provider = id;
        saveSettings();
        applyStaticTexts();
        answer(n, { pid: id });
      } })),
      ...(others.length ? [] : [{ label: t('settingsMenu'), primary: true, run: openSettings }]),
      { label: t('synthesis'), run: openSynthesis },
      { label: t('close') },
    ] });
  }

  // ---------- Export: HTML, PDF (print), Markdown, OPML, JSON ----------
  const today = () => new Date().toISOString().split('T')[0];
  const XML_ENTITIES = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', '\n': '&#10;' };
  const xml = s => String(s).replace(/[<>&"\n]/g, c => XML_ENTITIES[c]);
  function openExport() {
    closeMenu();
    openSheet({ title: t('exportTitle'), text: t('exportNote'), actions: [
      { label: 'HTML', primary: true, run: () => download('html', 'text/html', toHtml()) },
      { label: 'PDF', run: printReport },
      { label: 'Markdown', run: () => download('md', 'text/markdown', toMarkdown()) },
      { label: 'OPML', run: () => download('opml', 'text/x-opml', toOpml()) },
      { label: 'JSON', run: () => download('json', 'application/json', JSON.stringify({ version: EXPORT_VERSION, nodes, groups }, null, 2)) },
      { label: t('close') },
    ] });
  }
  function download(ext, type, text) {
    const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    const a = htmlEl('a');
    a.href = url;
    a.download = `${APP_NAME.toLowerCase()}-${today()}.${ext}`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_DELAY);
  }
  function toMarkdown() {
    const lines = [`# ${APP_NAME} — ${today()}`, ''];
    (function walk(id, level) {
      for (const n of children(id)) {
        lines.push(`${'#'.repeat(Math.min(level, MD_MAX_LEVEL))} ${label(n)}`, '', `**${n.q}**`, '', n.a, '');
        for (const v of otherVersions(n)) lines.push(`*${t('otherVersion', { by: v.by || 'LLM' })}*`, '', v.a, '');
        walk(n.id, level + 1);
      }
    })(ROOT, 2);
    return lines.join('\n');
  }
  function toOpml() {
    const note = n => [n.q, n.a, ...otherVersions(n).map(v => `${t('otherVersion', { by: v.by || 'LLM' })}\n${v.a}`)].join('\n\n');
    const outline = id => children(id).map(n => `<outline text="${xml(label(n))}" _note="${xml(note(n))}">${outline(n.id)}</outline>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>${xml(APP_NAME)} ${today()}</title></head>` +
      `<body>${outline(ROOT)}</body></opml>\n`;
  }
  // Report shared by the HTML and PDF exports: the whole tree drawn, then every box with its content
  function buildReport() {
    const report = htmlEl('article', 'report');
    report.append(htmlEl('h1', null, `${APP_NAME} — ${today()}`), reportMap());
    const section = n => {
      const d = htmlEl('details');
      d.open = true;
      d.id = 'node-' + n.id;
      d.append(htmlEl('summary', null, label(n)), htmlEl('p', 'q', n.q), htmlEl('p', 'a', n.a));
      for (const v of otherVersions(n)) d.append(htmlEl('p', 'version', t('otherVersion', { by: v.by || 'LLM' })), htmlEl('p', 'a', v.a));
      for (const c of children(n.id)) d.append(section(c));
      return d;
    };
    for (const c of children(ROOT)) report.append(section(c));
    return report;
  }
  function reportMap() {                       // the whole tree (merged boxes expanded), drawn with plain attributes
    const v = visibleTree([]), pos = layout(v), W = NODE_WIDTH, H = NODE_HEIGHT;
    const xs = Object.values(pos).map(p => p.x), ys = Object.values(pos).map(p => p.y);
    const x0 = Math.min(...xs) - W / 2 - MAP_MARGIN, y0 = Math.min(...ys) - H / 2 - MAP_MARGIN;
    const width = Math.max(...xs) - Math.min(...xs) + W + 2 * MAP_MARGIN, height = Math.max(...ys) - Math.min(...ys) + H + 2 * MAP_MARGIN;
    const map = svgEl('svg', { class: 'map', viewBox: `${x0} ${y0} ${width} ${height}`, role: 'img', 'aria-label': t('mapLabel') });
    for (const u of v.units.values()) {
      if (u.parent != null) map.append(svgEl('path', { d: linkPath(pos[u.parent], pos[u.id]), fill: 'none', stroke: EXPORT_LINE, 'stroke-width': 3 }));
    }
    for (const u of v.units.values()) {
      const root = u.id === ROOT;
      const g = svgEl('g', { transform: `translate(${pos[u.id].x},${pos[u.id].y})` });
      g.append(svgEl('rect', { x: -W / 2, y: -H / 2, width: W, height: H, rx: H / 2,
        fill: root ? EXPORT_INK : EXPORT_PAPER, stroke: EXPORT_INK, 'stroke-width': 2 }));
      const text = svgEl('text', { 'text-anchor': 'middle', dy: '0.35em', 'font-size': 15, 'font-family': 'system-ui, sans-serif',
        fill: root ? EXPORT_PAPER : EXPORT_INK });
      text.textContent = (u.rep.ico ? u.rep.ico + ' ' : '') + shorten(keyword(u.rep), KEYWORD_LENGTH);
      g.append(text);
      if (root) { map.append(g); continue; }
      const link = svgEl('a', { href: '#node-' + u.id });   // tapping a box jumps to its content
      link.append(g);
      map.append(link);
    }
    return map;
  }
  function toHtml() {
    const { lang, dir } = document.documentElement;
    return `<!DOCTYPE html>\n<html lang="${xml(lang)}" dir="${xml(dir)}"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${xml(APP_NAME)} ${today()}</title>` +
      `<style>${EXPORT_CSS}</style></head><body>${buildReport().outerHTML}</body></html>\n`;
  }
  function printReport() {                     // the browser's print window offers "Save as PDF"
    const view = $('print-view');
    view.textContent = '';
    view.append(buildReport());
    addEventListener('afterprint', () => { view.textContent = ''; }, { once: true });
    print();
  }

  // ---------- Sheet (dialog with actions) and snackbar (message with one action) ----------
  // actions: [{ label, primary, keepOpen, run }]
  function openSheet({ title, text = '', body = null, actions }) {
    $('sheet-title').textContent = title;
    $('sheet-text').textContent = text;
    $('sheet-text').hidden = !text;
    $('sheet-body').hidden = body == null;
    $('sheet-body').textContent = body ?? '';
    const box = $('sheet-actions');
    box.textContent = '';
    for (const a of actions) {
      const b = htmlEl('button', a.primary ? 'primary' : null, a.label);
      b.type = 'button';
      b.addEventListener('click', () => { if (!a.keepOpen) $('sheet').close(); a.run?.(); });
      box.append(b);
    }
    if (!$('sheet').open) $('sheet').showModal();
  }
  let snackTimer;
  function snack(text, actionLabel, run) {
    const s = $('snack'), b = s.querySelector('button');
    s.querySelector('span').textContent = text;
    b.textContent = actionLabel;
    b.onclick = () => { s.classList.remove('on'); run(); };
    s.classList.add('on');
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => s.classList.remove('on'), SNACK_DURATION);
  }

  // ---------- LLM settings (keys kept on the device only) ----------
  function loadSettings() {
    const s = readJson(SETTINGS_KEY) || {};
    const out = { provider: DEFAULT_PROVIDER, keys: {}, models: {}, workspace: '', keep: false, language: '', placement: PLACEMENTS[0], ...s };
    if (s.key) out.keys.anthropic = s.key;      // settings saved by v4, when Claude was the only provider
    if (s.model) out.models.anthropic = s.model;
    delete out.key;
    delete out.model;
    if (!PROVIDERS[out.provider]) out.provider = DEFAULT_PROVIDER;
    if (!PLACEMENTS.includes(out.placement)) out.placement = PLACEMENTS[0];
    return out;
  }
  function saveSettings() {
    writeJson(SETTINGS_KEY, { ...settings, keys: settings.keep ? settings.keys : {} });   // unticked: the keys stay in memory only
  }
  const settings = loadSettings();
  for (const id in PROVIDERS) {
    const o = htmlEl('option');
    o.value = id;
    $('set-provider').append(o);
  }
  for (const id of PLACEMENTS) {
    const o = htmlEl('option');
    o.value = id;
    $('set-placement').append(o);
  }
  function placementLabel(id) { return 'placement' + id[0].toUpperCase() + id.slice(1); }   // key of its text in UI
  function modeLabel() {
    if (!apiKey()) return t('modeDemo');
    const p = provider(), m = currentModel(), labelKey = p.modelLabels?.[m];
    return labelKey ? `${p.name} ${t(labelKey).split(' (')[0]}` : `${p.name} · ${m.split('/').pop()}`;
  }

  // The dialog shows one provider at a time; what is typed for each one is kept in a draft until "Save"
  let draft, shown;
  function openSettings() {
    closeMenu();
    draft = { keys: { ...settings.keys }, models: { ...settings.models } };
    shown = settings.provider;
    $('set-provider').value = shown;
    showProvider();
    $('set-workspace').value = settings.workspace;
    $('set-keep').checked = settings.keep;
    $('set-language').value = settings.language;
    $('set-placement').value = settings.placement;
    $('settings').showModal();
  }
  function showProvider() {
    const p = PROVIDERS[shown];
    $('set-key').value = draft.keys[shown] || '';
    $('set-key').placeholder = p.placeholder;
    $('set-model').value = draft.models[shown] || p.models[0];
    $('provider-note').textContent = t(p.note);
    $('key-note').textContent = t('keyNote', { host: new URL(p.base).host });
    $('workspace-field').hidden = p.format !== 'anthropic';
    fillModelList(p, p.models);
    loadModels(shown);
  }
  function keepDraft() {
    draft.keys[shown] = $('set-key').value.trim();
    draft.models[shown] = $('set-model').value.trim();
  }
  function fillModelList(p, ids) {             // suggestions shown under the "Model" field
    const list = $('model-list');
    list.textContent = '';
    for (const id of ids) {
      const o = htmlEl('option');
      o.value = id;
      if (p.modelLabels?.[id]) o.label = t(p.modelLabels[id]);
      list.append(o);
    }
  }
  // Asks the provider which models this key can use, and picks one if the current model is not offered
  async function loadModels(id) {
    const p = PROVIDERS[id], key = draft.keys[id];
    if (!p.list || !key) return;
    let ids;
    try { ids = await listModels(p, key); } catch { return; }   // suggestions stay as they are
    if (shown !== id || !ids.length) return;     // nothing usable, or another provider is shown now
    fillModelList(p, ids);
    const current = $('set-model').value.trim();
    if (ids.includes(current) || (current && !p.models.includes(current))) return;   // keeps a model typed by the user
    const pick = (p.prefer || []).map(re => ids.find(m => re.test(m))).find(Boolean) || ids[0];
    $('set-model').value = draft.models[id] = pick;
    if (!$('settings').open) { saveSettings(); applyStaticTexts(); }   // the dialog was saved before the list arrived
  }
  async function listModels(p, key) {
    const url = p.format === 'gemini' ? `${p.base}/models?pageSize=${MODEL_PAGE}` : `${p.base}/models`;
    const h = headers({ p, key });
    delete h['content-type'];
    const r = await fetch(url, { headers: h });
    if (!r.ok) return [];
    const j = await r.json();
    const list = p.format === 'gemini'
      ? (j.models || []).filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => ({ id: m.name.replace(/^models\//, ''), created: 0 }))
      : (j.data || []).map(m => ({ id: m.id, created: m.created || 0 }));
    const ids = list.sort((a, b) => b.created - a.created || b.id.localeCompare(a.id, 'en', { numeric: true }))   // newest first
      .map(m => m.id).filter(m => (!p.keep || p.keep.test(m)) && !(p.skip && p.skip.test(m)));
    return [...new Set([...(p.pinned || []), ...ids])];
  }
  function readSettingsForm() {
    keepDraft();
    Object.assign(settings, {
      provider: shown, keys: draft.keys, models: draft.models, workspace: $('set-workspace').value.trim(),
      keep: $('set-keep').checked, language: $('set-language').value.trim(), placement: $('set-placement').value,
    });
    saveSettings();
  }
  $('set-provider').addEventListener('change', () => {
    keepDraft();
    shown = $('set-provider').value;
    showProvider();
  });
  $('set-key').addEventListener('change', () => { keepDraft(); loadModels(shown); });
  $('settings-form').addEventListener('submit', e => {
    e.preventDefault();
    readSettingsForm();
    $('settings').close();
    applyStaticTexts();
    toast(apiKey() ? t('connected', { provider: provider().name }) : t('demoOn'));
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
  $('btn-synthesis').addEventListener('click', openSynthesis);
  $('btn-export').addEventListener('click', openExport);
  $('btn-select').addEventListener('click', () => setSelectMode(true));
  $('btn-cancel').addEventListener('click', () => (moving ? endMove() : setSelectMode(false)));
  $('btn-merge').addEventListener('click', merge);
  $('btn-fit').addEventListener('click', fit);
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
