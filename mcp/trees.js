// Ramifai trees on disk: one JSON file per tree, in the same format as the app's JSON export
// ({ version, nodes, groups }). So the app can open the files written here, and this folder can hold the app's exports.
// A node is { id, parent, q, a, kw, sum, ico, by }: question, answer, keyword, summary, emoji, who answered.
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ROOT = 'root';              // id of the first box of every tree, as in the app
export const FILE_VERSION = 4;           // version of the app's JSON export
export const FULL_EXCHANGES = 2;         // last exchanges of a branch given in full (older ones: their summary), as in the app
export const TITLE_LENGTH = 80;          // longest tree title
export const KEYWORD_LENGTH = 30;        // longest keyword, as for keywords written by an LLM in the app
const ROOT_ICON = '🌱';
const NAME = /^[\p{L}\p{N}_-]{1,100}$/u; // tree names: letters, digits, - and _, so a name never leads outside the folder
const EXT = '.json';

export const folder = () => process.env.RAMIFAI_DIR || join(homedir(), 'Ramifai');

function fileOf(name) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error(`Invalid tree name "${name}": use the name given by list_trees.`);
  return join(folder(), name + EXT);
}

export async function loadTree(name) {
  let text;
  try { text = await readFile(fileOf(name), 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`No tree named "${name}". Use list_trees to see the trees.`);
    throw e;
  }
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!Array.isArray(data?.nodes) || !data.nodes.some(n => n?.id === ROOT)) throw new Error(`"${name}" is not a Ramifai tree.`);
  data.groups = Array.isArray(data.groups) ? data.groups : [];
  return data;
}

export async function saveTree(name, data) {
  await mkdir(folder(), { recursive: true });
  const file = fileOf(name), temporary = file + '.tmp';
  await writeFile(temporary, JSON.stringify({ ...data, version: FILE_VERSION }, null, 2));
  await rename(temporary, file);         // replaced in one step: the file is never left half-written
}

export async function listTrees() {
  let files;
  try { files = await readdir(folder()); } catch (e) {
    if (e.code === 'ENOENT') return [];   // no tree yet
    throw e;
  }
  const out = [];
  for (const f of files.filter(f => f.endsWith(EXT)).sort()) {
    const name = f.slice(0, -EXT.length);
    if (!NAME.test(name)) continue;
    try {
      const data = await loadTree(name), { mtime } = await stat(fileOf(name));
      out.push({ name, title: titleOf(data), count: data.nodes.length, updated: mtime.toISOString().split('T')[0] });
    } catch { /* not a tree: skipped */ }
  }
  return out;
}

const titleOf = data => data.nodes.find(n => n.id === ROOT).kw || '';

// File name made from the title: accents removed, other signs turned into "-"; a number is added if it is taken
export async function createTree(title) {
  const base = title.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, TITLE_LENGTH) || 'tree';
  const taken = new Set((await readdir(folder()).catch(() => [])).map(f => f.replace(/\.json$/, '')));
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
  await saveTree(name, { nodes: [{ id: ROOT, parent: null, ico: ROOT_ICON, kw: title, q: '', a: '', sum: '' }], groups: [] });
  return name;
}

function find(data, id) {
  const n = data.nodes.find(m => m.id === id);
  if (!n) throw new Error(`No box "${id}" in this tree. Use show_tree to see the ids.`);
  return n;
}

// Plan of the tree: one line per box, indented by depth, children in the order they were written
export function outline(data) {
  const children = new Map();
  for (const n of data.nodes) if (n.id !== ROOT) children.set(n.parent, [...(children.get(n.parent) || []), n]);
  const lines = [];
  const walk = (n, depth) => {
    lines.push(`${'  '.repeat(depth)}- ${n.id} · ${n.ico ? n.ico + ' ' : ''}${n.kw || '(no keyword)'}${n.sum ? ' — ' + n.sum : ''}`);
    for (const c of children.get(n.id) || []) walk(c, depth + 1);
  };
  walk(find(data, ROOT), 0);
  return lines.join('\n');
}

// Context of a box: the path from the root, summaries first, then the last exchanges in full
export function branch(data, id) {
  const path = [];
  for (let n = find(data, id); n.id !== ROOT; n = find(data, n.parent)) {
    if (path.length > data.nodes.length) throw new Error('This tree has a loop.');
    path.unshift(n);
  }
  const full = path.length - FULL_EXCHANGES;
  const lines = path.map((n, i) => (i < full ? `- ${n.kw}: ${n.sum}` : `Question: ${n.q}\nAnswer: ${n.a}`));
  return [`Tree: ${titleOf(data)}`, ...lines].join('\n\n');
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);   // same form as the app's ids

export function addExchange(data, { parent, question, answer, keyword, summary, emoji = '', by = '' }) {
  find(data, parent);
  const ids = new Set(data.nodes.map(n => n.id));
  let id;
  do id = newId(); while (ids.has(id));
  data.nodes.push({ id, parent, q: question, a: answer, kw: keyword.slice(0, KEYWORD_LENGTH), sum: summary, ico: emoji, by });
  return id;
}
