// Reading a Ramifai tree, in the app's JSON format: { version, nodes: [{ id, parent, q, a, kw, sum, ico, by }], groups }.
// Same rules as the local connector (mcp/trees.js), so both give the assistant the same answers.

export const ROOT = 'root';              // id of the first box of every tree, as in the app
export const FILE_VERSION = 4;           // version of the app's JSON export
export const FULL_EXCHANGES = 2;         // last exchanges of a branch given in full (older ones: their summary), as in the app
export const TITLE_LENGTH = 80;          // longest tree title
export const KEYWORD_LENGTH = 30;        // longest keyword, as for keywords written by an LLM in the app
export const NAME_LENGTH = 100;          // longest tree name (the database checks it too)
const ROOT_ICON = '🌱';

export type Node = { id: string; parent: string | null; q: string; a: string; kw: string; sum: string; ico: string; by?: string };
export type Tree = { version?: number; nodes: Node[]; groups?: unknown[] };

export const titleOf = (data: Tree) => data.nodes.find(n => n.id === ROOT)?.kw || '';

export function newTree(title: string): Tree {
  return { version: FILE_VERSION, nodes: [{ id: ROOT, parent: null, ico: ROOT_ICON, kw: title, q: '', a: '', sum: '' }], groups: [] };
}

// Name made from the title: accents removed, other signs turned into "-"; a number is added if it is taken
export function freeName(title: string, taken: Set<string>): string {
  const base = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, TITLE_LENGTH) || 'tree';
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  return name;
}

export function find(data: Tree, id: string): Node {
  const n = data.nodes.find(m => m.id === id);
  if (!n) throw new Error(`No box "${id}" in this tree. Use show_tree to see the ids.`);
  return n;
}

// Plan of the tree: one line per box, indented by depth, children in the order they were written
export function outline(data: Tree): string {
  const children = new Map<string | null, Node[]>();
  for (const n of data.nodes) if (n.id !== ROOT) children.set(n.parent, [...(children.get(n.parent) || []), n]);
  const lines: string[] = [];
  const walk = (n: Node, depth: number) => {
    lines.push(`${'  '.repeat(depth)}- ${n.id} · ${n.ico ? n.ico + ' ' : ''}${n.kw || '(no keyword)'}${n.sum ? ' — ' + n.sum : ''}`);
    for (const c of children.get(n.id) || []) walk(c, depth + 1);
  };
  walk(find(data, ROOT), 0);
  return lines.join('\n');
}

// Context of a box: the path from the root, summaries first, then the last exchanges in full
export function branch(data: Tree, id: string): string {
  const path: Node[] = [];
  for (let n = find(data, id); n.id !== ROOT; n = find(data, n.parent ?? '')) {
    if (path.length > data.nodes.length) throw new Error('This tree has a loop.');
    path.unshift(n);
  }
  const full = path.length - FULL_EXCHANGES;
  const lines = path.map((n, i) => (i < full ? `- ${n.kw}: ${n.sum}` : `Question: ${n.q}\nAnswer: ${n.a}`));
  return [`Tree: ${titleOf(data)}`, ...lines].join('\n\n');
}

// A new id, of the same form as the app's ids, not used yet in this tree
export function newId(data: Tree): string {
  const ids = new Set(data.nodes.map(n => n.id));
  let id;
  do id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); while (ids.has(id));
  return id;
}
