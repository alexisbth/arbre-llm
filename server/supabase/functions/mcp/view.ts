// The tree drawn inside the assistant's conversation (MCP Apps: an HTML page the assistant shows in a frame).
// How it gets the tree: the assistant tells the page which tool ran and its result ({ tree, box }); the page then
// calls the tool get_tree_view, which only pages can call, so the full tree is not sent to the model again.
// Messages with the assistant: JSON-RPC 2.0 through window.postMessage (ui/initialize, ui/notifications/...).
// One self-contained file: no outside script, style or request. All text is inserted with textContent.
export const VIEW_HTML = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root { color-scheme: light dark; --bg: light-dark(#ffffff, #101418); --ink: light-dark(#101418, #eef1f4);
  --slate: light-dark(#5d6873, #98a3ae); --line: light-dark(#d3d9df, #2e3740); --card: light-dark(#f3f5f7, #182028);
  --acc: #ffd84a; --acc-ink: #101418 }
html, body { margin: 0; background: transparent; color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif }
header { display: flex; align-items: baseline; gap: 8px; padding: 10px 12px 2px }
h1 { margin: 0; font-size: 17px; font-weight: 800 }
.count, .note { font-size: 13px; color: var(--slate) }
.note { margin: 0; padding: 4px 12px 10px }
#map { overflow-x: auto; -webkit-overflow-scrolling: touch }
svg { display: block }
.link { fill: none; stroke: var(--line); stroke-width: 3 }
.link.on { stroke: var(--ink); stroke-width: 4 }
.box { cursor: pointer }
.box rect { fill: var(--bg); stroke: var(--line); stroke-width: 2 }
.box text { font-size: 13px; font-weight: 600; fill: var(--ink); pointer-events: none }
.box.on rect { stroke: var(--ink); stroke-width: 3 }
.box.root rect { fill: var(--ink); stroke: var(--ink) }
.box.root text { fill: var(--bg) }
.box.sel rect { fill: var(--acc); stroke: var(--acc-ink); stroke-width: 3 }
.box.sel text { fill: var(--acc-ink); font-weight: 800 }
#detail { margin: 4px 12px 12px; padding: 10px 12px; border-radius: 12px; background: var(--card) }
#detail p { margin: 0 }
#kw { font-size: 13px; font-weight: 700; color: var(--slate) }
#q { margin: 4px 0 6px !important; font-weight: 650 }
#a { white-space: pre-wrap }
#kw, #q, #a { unicode-bidi: plaintext }
[hidden] { display: none !important }
</style>
</head>
<body>
<header><h1 id="title">Ramifai</h1><span class="count" id="count"></span></header>
<p class="note" id="note">Loading the tree…</p>
<div id="map"></div>
<section id="detail" hidden><p id="kw"></p><p id="q"></p><p id="a"></p></section>
<script>
(function () {
  var PROTOCOL = '2026-01-26';                 // MCP Apps version this page speaks
  var ROOT = 'root', GAP_X = 150, GAP_Y = 74, W = 136, H = 34, KEYWORD_LENGTH = 14, MARGIN = 12;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var nextId = 1, pending = {}, tree = null, selected = null, ready = false;   // ready: the assistant accepted the page
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Messages with the assistant ----------
  function send(message) { window.parent.postMessage(message, '*'); }
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
    if (m.id != null && !m.method && pending[m.id]) {                // answer to one of our requests
      var p = pending[m.id];
      delete pending[m.id];
      if (m.error) p.reject(new Error(m.error.message || 'Error')); else p.resolve(m.result);
      return;
    }
    if (m.method === 'ui/notifications/tool-result') onToolResult(m.params || {});
    else if (m.method === 'ui/notifications/host-context-changed') applyContext(m.params || {});
    else if (m.id != null) send({ jsonrpc: '2.0', id: m.id, result: {} });   // other requests (e.g. teardown): acknowledged
  });
  function applyContext(context) {
    if (context.theme === 'light' || context.theme === 'dark') document.documentElement.style.colorScheme = context.theme;
  }
  function resize() {                          // tells the assistant the height the page needs
    if (ready) notify('ui/notifications/size-changed', { height: Math.ceil(document.documentElement.getBoundingClientRect().height) });
  }

  // ---------- The tree ----------
  function note(text) { $('note').textContent = text; $('note').hidden = !text; resize(); }
  function onToolResult(result) {
    var info = result.structuredContent || {};
    if (!info.tree) { note(''); return; }
    request('tools/call', { name: 'get_tree_view', arguments: { tree: info.tree } }).then(function (r) {
      if (!r || r.isError || !r.structuredContent) { note('The tree could not be loaded.'); return; }
      tree = r.structuredContent;
      selected = info.box || null;
      draw();
    }, function () { note('The tree could not be loaded.'); });
  }
  var byId = function (id) { return tree.nodes.filter(function (n) { return n.id === id; })[0]; };
  function pathTo(id) {                         // ids from the root down to id
    var out = [], n = byId(id), guard = 0;
    while (n && guard++ <= tree.nodes.length) { out.unshift(n.id); n = byId(n.parent); }
    return out;
  }
  function shorten(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function el(name, attrs) {
    var e = document.createElementNS(SVGNS, name);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function draw() {
    var children = {}, pos = {}, leaf = 0, depthMax = 0;
    tree.nodes.forEach(function (n) { if (n.id !== ROOT) (children[n.parent] = children[n.parent] || []).push(n.id); });
    (function place(id, depth) {               // y = depth; x = leaf rank, each parent centred above its children
      var k = children[id] || [];
      k.forEach(function (c) { place(c, depth + 1); });
      var x = k.length ? (pos[k[0]].x + pos[k[k.length - 1]].x) / 2 : (leaf++) * GAP_X;
      pos[id] = { x: x, y: depth * GAP_Y };
      depthMax = Math.max(depthMax, depth);
    })(ROOT, 0);
    var width = (leaf - 1) * GAP_X + W + 2 * MARGIN, height = depthMax * GAP_Y + H + 2 * MARGIN;
    var on = {};
    pathTo(selected || ROOT).forEach(function (id) { on[id] = true; });
    var svg = el('svg', { width: width, height: height, viewBox: (-W / 2 - MARGIN) + ' ' + (-H / 2 - MARGIN) + ' ' + width + ' ' + height,
      role: 'img', 'aria-label': 'Tree ' + (tree.title || '') });
    Object.keys(pos).forEach(function (id) {
      var n = byId(id);
      if (!n || id === ROOT || !pos[n.parent]) return;
      var a = pos[n.parent], b = pos[id], y0 = a.y + H / 2, y1 = b.y - H / 2, my = (y0 + y1) / 2;
      svg.appendChild(el('path', { d: 'M' + a.x + ',' + y0 + ' C' + a.x + ',' + my + ' ' + b.x + ',' + my + ' ' + b.x + ',' + y1,
        'class': on[id] ? 'link on' : 'link' }));
    });
    Object.keys(pos).forEach(function (id) {
      var n = byId(id);
      if (!n) return;
      var g = el('g', { 'class': 'box' + (id === ROOT ? ' root' : '') + (id === selected ? ' sel' : on[id] ? ' on' : ''),
        transform: 'translate(' + pos[id].x + ',' + pos[id].y + ')', tabindex: 0 });
      g.appendChild(el('rect', { x: -W / 2, y: -H / 2, width: W, height: H, rx: H / 2 }));
      var t = el('text', { 'text-anchor': 'middle', dy: '0.35em' });
      t.textContent = (n.ico ? n.ico + ' ' : '') + shorten(n.kw || '', KEYWORD_LENGTH);
      g.appendChild(t);
      var title = el('title', {});
      title.textContent = n.kw || '';
      g.appendChild(title);
      g.addEventListener('click', function () { selected = id === ROOT ? null : id; draw(); });
      svg.appendChild(g);
    });
    $('title').textContent = tree.title || tree.name;
    $('count').textContent = (tree.nodes.length - 1) + ' boxes · tap a box to read it';
    $('map').textContent = '';
    $('map').appendChild(svg);
    note('');
    showDetail();
    if (selected && pos[selected]) $('map').scrollLeft = pos[selected].x + W / 2 + MARGIN - $('map').clientWidth / 2;
  }
  function showDetail() {
    var n = selected && byId(selected);
    $('detail').hidden = !n;
    if (!n) return;
    $('kw').textContent = (n.ico ? n.ico + ' ' : '') + (n.kw || '');
    $('q').textContent = n.q || '';
    $('a').textContent = n.a || '';
  }

  // ---------- Start ----------
  request('ui/initialize', { appInfo: { name: 'Ramifai tree', version: '0.1.0' }, appCapabilities: {}, protocolVersion: PROTOCOL })
    .then(function (r) {
      applyContext((r && r.hostContext) || {});
      notify('ui/notifications/initialized');
      ready = true;
      resize();
      if (window.ResizeObserver) new ResizeObserver(resize).observe(document.body);
    });
})();
</script>
</body>
</html>`;
