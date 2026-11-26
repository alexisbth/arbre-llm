// The tree drawn inside the assistant (MCP Apps: an HTML page the assistant shows in a frame).
// Two layouts, chosen from the display mode the assistant reports:
// - "fullscreen" (side panel next to the chat on a computer, whole screen on a phone): the map, with pan, zoom and
//   "Fit", then the thread from the start to the chosen box, as in the Ramifai app;
// - "inline" (in the conversation): a card with the whole tree fitted to its width, the chosen box,
//   and an "Open the tree" button that moves the page to the side panel or full screen.
// How it gets the tree: the assistant gives the page the tool's result ({ tree, box }); the page then calls
// get_tree_view, which only pages can call, so the whole tree is not sent to the model again.
// Colours, font and radii come from the assistant's style variables, so the page looks like the chat around it.
// Messages: JSON-RPC 2.0 through window.postMessage. One self-contained file, text inserted with textContent.
export const VIEW_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {
  color-scheme: light dark;
  --bg: var(--color-background-primary, light-dark(#ffffff, #30302e));
  --bg2: var(--color-background-secondary, light-dark(#f5f4ed, #262624));
  --ink: var(--color-text-primary, light-dark(#141413, #faf9f5));
  --ink2: var(--color-text-secondary, light-dark(#3d3d3a, #c2c0b6));
  --ink3: var(--color-text-tertiary, light-dark(#73726c, #9c9a92));
  --line: var(--color-border-secondary, light-dark(rgb(31 30 29 / .3), rgb(222 220 209 / .3)));
  --inv: var(--color-background-inverse, light-dark(#141413, #faf9f5));
  --inv-ink: var(--color-text-inverse, light-dark(#ffffff, #141413));
  --acc: #ffd84a; --acc-ink: #141413;                       /* Ramifai's yellow: the chosen box */
  --radius: var(--border-radius-xl, 12px);
  --safe-top: 0px; --safe-right: 0px; --safe-bottom: 0px; --safe-left: 0px;
}
* { box-sizing: border-box }
html, body { margin: 0; background: transparent; color: var(--ink);
  font-family: var(--font-sans, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: var(--font-text-md-size, 16px); line-height: var(--font-text-md-line-height, 1.4) }
#app { display: flex; flex-direction: column;
  padding: calc(var(--safe-top) + 12px) calc(var(--safe-right) + 14px) calc(var(--safe-bottom) + 12px) calc(var(--safe-left) + 14px) }
.full #app { height: var(--full-height, 100vh) }
header { display: flex; align-items: center; gap: 8px; min-height: 44px }
.titles { flex: 1; min-width: 0 }
h1 { margin: 0; font-size: var(--font-heading-md-size, 16px); font-weight: var(--font-weight-semibold, 600);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
#count { margin: 0; font-size: var(--font-text-sm-size, 14px); color: var(--ink3) }
button { min-height: 44px; padding: 0 16px; border: var(--border-width-regular, 1px) solid var(--line); border-radius: var(--border-radius-full, 9999px);
  background: var(--bg); color: var(--ink); font: inherit; font-size: var(--font-text-sm-size, 14px); font-weight: var(--font-weight-medium, 500); cursor: pointer }
button.primary { background: var(--inv); color: var(--inv-ink); border-color: var(--inv) }
button:focus-visible, .box:focus-visible { outline: 2px solid var(--color-ring-primary, var(--ink)); outline-offset: 2px }
#map { position: relative; margin: 8px 0; border-radius: var(--radius); background: var(--bg2); overflow: hidden }
.full #map { flex: 1 1 auto; min-height: 120px; touch-action: none; cursor: grab }
svg { display: block; width: 100%; height: 100% }
.link { fill: none; stroke: var(--line); stroke-width: 3; stroke-linecap: round }
.link.on { stroke: var(--ink); stroke-width: 4 }
.arrow { fill: var(--line) } .arrow-on { fill: var(--ink) }
.box { cursor: pointer }
.box rect { fill: var(--bg); stroke: var(--line); stroke-width: 1.5 }
.box text { font-size: 14px; font-weight: 600; fill: var(--ink); pointer-events: none }
.box.on rect { stroke: var(--ink); stroke-width: 2.5 }
.box.root rect { fill: var(--inv); stroke: var(--inv) } .box.root text { fill: var(--inv-ink) }
.box.sel rect { fill: var(--acc); stroke: var(--acc-ink); stroke-width: 2.5 } .box.sel text { fill: var(--acc-ink); font-weight: 700 }
#thread { overflow: visible }
.full #thread { flex: 0 1 auto; max-height: 46%; overflow-y: auto; -webkit-overflow-scrolling: touch }
.exchange { margin: 0 0 8px; padding: 10px 12px; border-radius: var(--radius); background: var(--bg2); border-inline-start: 4px solid var(--line) }
.exchange.current { border-inline-start-color: var(--acc) }
.kw { margin: 0; font-size: var(--font-text-sm-size, 14px); font-weight: var(--font-weight-semibold, 600); color: var(--ink3) }
.q { margin: 4px 0; font-weight: var(--font-weight-semibold, 600) }
.a { margin: 0; white-space: pre-wrap; color: var(--ink2) }
.inline .a { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden }
.down { margin: -4px 0 4px; text-align: center; color: var(--ink3) }
.next { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0 8px; font-size: var(--font-text-sm-size, 14px); color: var(--ink3) }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px }
.kw, .q, .a, h1 { unicode-bidi: plaintext }
.skeleton { height: 160px; border-radius: var(--radius); background: var(--bg2) }
[hidden] { display: none !important }
</style>
</head>
<body class="inline">
<div id="app">
  <header>
    <div class="titles"><h1 id="title">Ramifai</h1><p id="count"></p></div>
    <button id="fit" type="button" hidden>Fit</button>
  </header>
  <div id="map"><div class="skeleton" id="skeleton"></div></div>
  <section id="thread" aria-live="polite"></section>
  <div class="actions"><button id="expand" class="primary" type="button" hidden>Open the tree</button></div>
</div>
<script>
(function () {
  var PROTOCOL = '2026-01-26';                 // MCP Apps version this page speaks
  var ROOT = 'root', GAP_X = 170, GAP_Y = 96, W = 150, H = 40, ARROW_GAP = 7, KEYWORD_LENGTH = 15;
  var INLINE_MAP_MAX = 240;                    // px: tallest map in the conversation
  var ZOOM_MIN = 0.2, ZOOM_MAX = 3, ZOOM_FIT_MAX = 1.2, WHEEL = 0.0015, TAP = 8, MARGIN = 24;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var nextId = 1, pending = {}, context = {}, ready = false;
  var tree = null, selected = null, pos = {}, view = { x: 0, y: 0, k: 1 };
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Messages with the assistant ----------
  function send(m) { window.parent.postMessage(m, '*'); }
  function request(method, params) {
    var id = nextId++;
    send({ jsonrpc: '2.0', id: id, method: method, params: params });
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject }; });
  }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }); }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var m = event.data;
    if (!m || m.jsonrpc !== '2.0') return;
    if (m.id != null && !m.method && pending[m.id]) {              // answer to one of our requests
      var p = pending[m.id];
      delete pending[m.id];
      if (m.error) p.reject(new Error(m.error.message || 'Error')); else p.resolve(m.result);
      return;
    }
    if (m.method === 'ui/notifications/tool-result') onToolResult(m.params || {});
    else if (m.method === 'ui/notifications/host-context-changed') applyContext(m.params || {});
    else if (m.id != null) send({ jsonrpc: '2.0', id: m.id, result: {} });   // other requests (ping, teardown): acknowledged
  });

  // ---------- Look and layout, from what the assistant reports ----------
  function applyContext(change) {
    for (var k in change) context[k] = change[k];
    var root = document.documentElement;
    if (context.theme === 'light' || context.theme === 'dark') root.style.colorScheme = context.theme;
    var vars = (context.styles && context.styles.variables) || {};
    for (var name in vars) if (vars[name] != null) root.style.setProperty(name, vars[name]);
    var fonts = context.styles && context.styles.css && context.styles.css.fonts;
    if (fonts && !$('host-fonts')) { var s = document.createElement('style'); s.id = 'host-fonts'; s.textContent = fonts; document.head.appendChild(s); }
    var safe = context.safeAreaInsets || {};
    ['top', 'right', 'bottom', 'left'].forEach(function (side) { root.style.setProperty('--safe-' + side, (safe[side] || 0) + 'px'); });
    var full = context.displayMode === 'fullscreen';
    document.body.className = full ? 'full' : 'inline';
    var size = context.containerDimensions || {};
    root.style.setProperty('--full-height', size.height ? size.height + 'px' : '100vh');
    $('fit').hidden = !full;
    $('expand').hidden = full || !(context.availableDisplayModes || []).includes('fullscreen');
    if (tree) { render(); fit(); }
  }
  function resize() {                          // in the conversation, tells the assistant the height the card needs
    if (!ready || document.body.className === 'full') return;
    var root = document.documentElement, before = root.style.height;
    root.style.height = 'max-content';
    var h = Math.ceil(root.getBoundingClientRect().height);
    root.style.height = before;
    notify('ui/notifications/size-changed', { height: h });
  }

  // ---------- The tree ----------
  function onToolResult(result) {
    var info = result.structuredContent || {};
    if (!info.tree) return;
    request('tools/call', { name: 'get_tree_view', arguments: { tree: info.tree } }).then(function (r) {
      if (!r || r.isError || !r.structuredContent) { failed(); return; }
      tree = r.structuredContent;
      var last = tree.nodes[tree.nodes.length - 1];
      selected = info.box || (last && last.id !== ROOT ? last.id : null);
      render();
      fit();
    }, failed);
  }
  function failed() { $('count').textContent = 'The tree could not be loaded.'; $('skeleton').hidden = true; resize(); }
  var byId = function (id) { for (var i = 0; i < tree.nodes.length; i++) if (tree.nodes[i].id === id) return tree.nodes[i]; return null; };
  var childrenOf = function (id) { return tree.nodes.filter(function (n) { return n.parent === id && n.id !== ROOT; }); };
  function pathTo(id) {                         // nodes from the root down to id
    var out = [], n = byId(id), guard = 0;
    while (n && guard++ <= tree.nodes.length) { out.unshift(n); n = byId(n.parent); }
    return out;
  }
  var label = function (n) { return (n.ico ? n.ico + ' ' : '') + (n.kw || ''); };
  var shorten = function (s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  function el(name, attrs, text) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function html(name, cls, text) {
    var e = document.createElement(name);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Layout: y = depth; x = leaf rank, each parent centred above its children (as in the app)
  function layout() {
    pos = {};
    var leaf = 0;
    (function place(id, depth) {
      var k = childrenOf(id).map(function (n) { return n.id; });
      k.forEach(function (c) { place(c, depth + 1); });
      pos[id] = { x: k.length ? (pos[k[0]].x + pos[k[k.length - 1]].x) / 2 : (leaf++) * GAP_X, y: depth * GAP_Y };
    })(ROOT, 0);
  }
  function render() {
    layout();
    var on = {};
    pathTo(selected || ROOT).forEach(function (n) { on[n.id] = true; });
    var svg = el('svg', { role: 'img', 'aria-label': 'Tree ' + (tree.title || '') });
    var defs = el('defs', {});
    [['arrow', 'arrow', 12], ['arrow-on', 'arrow-on', 14]].forEach(function (m) {
      var mk = el('marker', { id: m[0], viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: m[2], markerHeight: m[2], markerUnits: 'userSpaceOnUse', orient: 'auto' });
      mk.appendChild(el('path', { 'class': m[1], d: 'M0,0 L10,5 L0,10 z' }));
      defs.appendChild(mk);
    });
    svg.appendChild(defs);
    var layer = el('g', { id: 'layer' });
    var links = tree.nodes.filter(function (n) { return n.id !== ROOT && pos[n.parent] && pos[n.id]; })
      .sort(function (a, b) { return (on[a.id] ? 1 : 0) - (on[b.id] ? 1 : 0); });   // the chosen path is drawn on top
    links.forEach(function (n) {
      var a = pos[n.parent], b = pos[n.id], y0 = a.y + H / 2, y1 = b.y - H / 2 - ARROW_GAP, my = (y0 + y1) / 2;
      layer.appendChild(el('path', { d: 'M' + a.x + ',' + y0 + ' C' + a.x + ',' + my + ' ' + b.x + ',' + my + ' ' + b.x + ',' + y1,
        'class': on[n.id] ? 'link on' : 'link', 'marker-end': on[n.id] ? 'url(#arrow-on)' : 'url(#arrow)' }));
    });
    tree.nodes.forEach(function (n) {
      if (!pos[n.id]) return;
      var g = el('g', { 'class': 'box' + (n.id === ROOT ? ' root' : '') + (n.id === selected ? ' sel' : on[n.id] ? ' on' : ''),
        transform: 'translate(' + pos[n.id].x + ',' + pos[n.id].y + ')', 'data-id': n.id, tabindex: 0, role: 'button', 'aria-label': n.kw || '' });
      g.appendChild(el('rect', { x: -W / 2, y: -H / 2, width: W, height: H, rx: H / 2 }));
      g.appendChild(el('text', { 'text-anchor': 'middle', dy: '0.35em' }, shorten(label(n), KEYWORD_LENGTH)));
      g.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(n.id); } });
      layer.appendChild(g);
    });
    svg.appendChild(layer);
    $('map').textContent = '';
    $('map').appendChild(svg);
    $('title').textContent = tree.title || tree.name;
    var count = tree.nodes.length - 1;
    $('count').textContent = count + (count === 1 ? ' box' : ' boxes') + ' · tap a box to read it';
    renderThread();
    applyView();
  }
  function choose(id) { selected = id === ROOT ? null : id; render(); }

  // Thread: on the side panel or full screen, the path from the start to the chosen box, then its follow-ups;
  // in the conversation, the chosen box only
  function renderThread() {
    var box = $('thread'), full = document.body.className === 'full';
    box.textContent = '';
    var path = selected ? pathTo(selected).filter(function (n) { return n.id !== ROOT; }) : [];
    if (!full) path = path.slice(-1);
    path.forEach(function (n, i) {
      if (i > 0) box.appendChild(html('div', 'down', '↓'));
      var card = html('article', 'exchange' + (n.id === selected ? ' current' : ''));
      card.appendChild(html('p', 'kw', label(n)));
      card.appendChild(html('p', 'q', n.q || ''));
      card.appendChild(html('p', 'a', n.a || ''));
      box.appendChild(card);
    });
    var next = full ? childrenOf(selected || ROOT) : [];
    if (next.length) {
      var row = html('div', 'next', 'Follow-ups:');
      next.forEach(function (c) {
        var b = html('button', null, label(c));
        b.type = 'button';
        b.addEventListener('click', function () { choose(c.id); centerOn(c.id); });
        row.appendChild(b);
      });
      box.appendChild(row);
    }
    if (full && path.length) requestAnimationFrame(function () { var cur = box.querySelector('.current'); if (cur) cur.scrollIntoView({ block: 'nearest' }); });
  }

  // ---------- View: fit, pan, zoom (pan and zoom on the side panel or full screen only) ----------
  function applyView() {
    var layer = $('layer');
    if (layer) layer.setAttribute('transform', 'translate(' + view.x + ',' + view.y + ') scale(' + view.k + ')');
  }
  function bounds() {
    var xs = [], ys = [];
    for (var id in pos) { xs.push(pos[id].x); ys.push(pos[id].y); }
    return { x0: Math.min.apply(null, xs) - W / 2 - MARGIN, x1: Math.max.apply(null, xs) + W / 2 + MARGIN,
      y0: Math.min.apply(null, ys) - H / 2 - MARGIN, y1: Math.max.apply(null, ys) + H / 2 + MARGIN };
  }
  function fit() {
    if (!tree) return;
    var b = bounds(), map = $('map'), full = document.body.className === 'full';
    var w = map.clientWidth || 1;
    if (!full) {                                // in the conversation: the whole tree fitted to the width
      var k = Math.min(1, w / (b.x1 - b.x0));
      map.style.height = Math.min(INLINE_MAP_MAX, Math.ceil((b.y1 - b.y0) * k)) + 'px';
    } else map.style.height = '';
    var h = map.clientHeight || 1;
    view.k = Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0), ZOOM_FIT_MAX);
    view.x = (w - (b.x0 + b.x1) * view.k) / 2;
    view.y = (h - (b.y0 + b.y1) * view.k) / 2;
    applyView();
    resize();
  }
  function centerOn(id) {
    var p = pos[id], map = $('map');
    if (!p || document.body.className !== 'full') return;
    view.x = map.clientWidth / 2 - p.x * view.k;
    view.y = map.clientHeight / 2 - p.y * view.k;
    applyView();
  }
  function zoomAround(cx, cy, factor) {         // zoom while keeping point (cx, cy) fixed
    var k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, view.k * factor)), f = k / view.k;
    view.x = cx - (cx - view.x) * f;
    view.y = cy - (cy - view.y) * f;
    view.k = k;
  }
  var pointers = {}, start = null, pinch = null;
  var dist = function (a, b) { return Math.hypot(a.x - b.x, a.y - b.y); };
  var local = function (e) { var r = $('map').getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  $('map').addEventListener('pointerdown', function (e) {
    var g = e.target.closest && e.target.closest('[data-id]');
    pointers[e.pointerId] = local(e);
    var ids = Object.keys(pointers);
    if (ids.length === 1) start = { p: local(e), id: g ? g.getAttribute('data-id') : null, moved: false };
    if (ids.length === 2) { pinch = { d: dist(pointers[ids[0]], pointers[ids[1]]) }; if (start) start.moved = true; }
    if (document.body.className === 'full') $('map').setPointerCapture(e.pointerId);
  });
  $('map').addEventListener('pointermove', function (e) {
    var before = pointers[e.pointerId];
    if (!before) return;
    var after = local(e), ids = Object.keys(pointers);
    pointers[e.pointerId] = after;
    if (start && dist(after, start.p) > TAP) start.moved = true;
    if (document.body.className !== 'full') return;
    if (ids.length === 1) { view.x += after.x - before.x; view.y += after.y - before.y; }
    else if (ids.length === 2 && pinch) {
      var a = pointers[ids[0]], b = pointers[ids[1]], d = dist(a, b);
      zoomAround((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
      pinch.d = d;
    }
    applyView();
  });
  function release(e) {
    if (!pointers[e.pointerId]) return;
    delete pointers[e.pointerId];
    if (Object.keys(pointers).length < 2) pinch = null;
    if (!Object.keys(pointers).length) {
      if (start && !start.moved && start.id) choose(start.id);
      start = null;
    }
  }
  $('map').addEventListener('pointerup', release);
  $('map').addEventListener('pointercancel', release);
  $('map').addEventListener('wheel', function (e) {
    if (document.body.className !== 'full') return;
    e.preventDefault();
    var p = local(e);
    zoomAround(p.x, p.y, Math.exp(-e.deltaY * WHEEL));
    applyView();
  }, { passive: false });
  $('fit').addEventListener('click', fit);
  $('expand').addEventListener('click', function () {   // must follow a tap: the assistant refuses it otherwise
    request('ui/request-display-mode', { mode: 'fullscreen' }).then(function (r) {
      if (r && r.mode) applyContext({ displayMode: r.mode });
    }, function () {});
  });
  window.addEventListener('resize', function () { if (tree) fit(); });

  // ---------- Start ----------
  request('ui/initialize', { appInfo: { name: 'Ramifai tree', version: '0.3.0' },
    appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] }, protocolVersion: PROTOCOL })
    .then(function (r) {
      ready = true;
      applyContext((r && r.hostContext) || {});
      notify('ui/notifications/initialized');
      resize();
      if (window.ResizeObserver) new ResizeObserver(resize).observe(document.body);
    });
})();
</script>
</body>
</html>`;
