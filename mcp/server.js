#!/usr/bin/env node
// Ramifai MCP connector (local)
// Lets an AI assistant that supports MCP (Claude Desktop, Claude Code, VS Code, Cursor, Gemini CLI…) read and grow
// the Ramifai trees kept in a folder of this computer (~/Ramifai, or the folder in RAMIFAI_DIR).
// The assistant starts this program and talks to it over stdin/stdout (the MCP "stdio" transport):
// nothing listens on the network, so no account nor sign-in is needed. Logs go to stderr only.
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as trees from './trees.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Sent once to the assistant when it connects: how to use the tools together
const INSTRUCTIONS = 'Ramifai keeps conversations as trees. Each box holds one question and its answer, with a short ' +
  'keyword, a one-sentence summary and an emoji; its parent is the box it follows from. To continue in a tree: ' +
  'show_tree to see the boxes, read_branch on the box to follow from (it gives the context), answer the user, then ' +
  'add_exchange to record the question and your answer under that box. If the tree or the box is unclear, ask the user.';

const server = new McpServer({ name: 'ramifai', version }, { instructions: INSTRUCTIONS });

// The tools read a file, change it, then write it: one change at a time, so two changes never overwrite each other
let last = Promise.resolve();
function oneAtATime(task) {
  const run = last.then(task);
  last = run.catch(() => {});
  return run;
}
// A tool's answer is plain text; an error is returned as text too, so the assistant can correct its call
const reply = task => async args => {
  try { return { content: [{ type: 'text', text: await oneAtATime(() => task(args)) }] }; }
  catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
};

const tree = z.string().describe('Name of the tree, as given by list_trees');
const readOnly = { readOnlyHint: true, openWorldHint: false };
const adds = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

server.registerTool('list_trees', {
  title: 'List the trees',
  description: `List the Ramifai trees in ${trees.folder()}: name, title, number of boxes, last change.`,
  annotations: readOnly,
}, reply(async () => {
  const list = await trees.listTrees();
  if (!list.length) return `No tree yet in ${trees.folder()}. Use create_tree, or put a JSON export of the Ramifai app there.`;
  return list.map(t => `${t.name} — ${t.title} (${t.count} boxes, changed ${t.updated})`).join('\n');
}));

server.registerTool('create_tree', {
  title: 'Create a tree',
  description: 'Create an empty Ramifai tree. Returns its name, to use with the other tools.',
  inputSchema: { title: z.string().min(1).max(trees.TITLE_LENGTH).describe('Title of the tree, shown on its first box') },
  annotations: adds,
}, reply(async ({ title }) => {
  const name = await trees.createTree(title);
  return `Tree "${name}" created. Its first box has the id "${trees.ROOT}": add the first exchange under it.`;
}));

server.registerTool('show_tree', {
  title: 'Show a tree',
  description: 'Plan of a tree: one line per box (id · emoji keyword — summary), indented under its parent.',
  inputSchema: { tree },
  annotations: readOnly,
}, reply(async ({ tree }) => trees.outline(await trees.loadTree(tree))));

server.registerTool('read_branch', {
  title: 'Read a branch',
  description: `Context of a box: the path from the first box to it, as summaries, with the last ${trees.FULL_EXCHANGES} ` +
    'exchanges in full. Read it before answering a question that follows from this box.',
  inputSchema: { tree, box: z.string().describe('Id of the box, as given by show_tree') },
  annotations: readOnly,
}, reply(async ({ tree, box }) => trees.branch(await trees.loadTree(tree), box)));

server.registerTool('add_exchange', {
  title: 'Add an exchange',
  description: 'Record a question and its answer as a new box under a parent box. Returns the id of the new box.',
  inputSchema: {
    tree,
    parent: z.string().describe(`Id of the box this exchange follows from ("${trees.ROOT}" for a new branch from the start)`),
    question: z.string().min(1).describe("The user's question, as asked"),
    answer: z.string().min(1).describe('The full answer'),
    keyword: z.string().min(1).max(trees.KEYWORD_LENGTH).describe('1 to 3 words naming the box'),
    summary: z.string().min(1).describe('One sentence summing up the answer'),
    emoji: z.string().max(8).optional().describe('One emoji for the box'),
  },
  annotations: adds,
}, reply(async ({ tree, ...exchange }) => {
  const data = await trees.loadTree(tree);
  const id = trees.addExchange(data, { ...exchange, by: server.server.getClientVersion()?.name || 'MCP' });
  await trees.saveTree(tree, data);
  return `Box "${id}" added under "${exchange.parent}".`;
}));

await server.connect(new StdioServerTransport());
console.error(`Ramifai MCP connector ${version} ready, trees in ${trees.folder()}`);
