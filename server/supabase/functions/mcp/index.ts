// Ramifai MCP connector (remote), as a Supabase Edge Function.
// The same tools as the local connector (folder mcp/), for assistants that only accept connectors on a server:
// claude.ai and its phone apps, ChatGPT, etc.
//
// How the user is recognized (MCP authorization, OAuth 2.1):
// 1. Without a valid token, the answer is 401, with the address of this connector's description
//    (".well-known/oauth-protected-resource", RFC 9728). It names the sign-in server: Supabase Auth.
// 2. The assistant registers itself there, sends the user to sign in and approve (page consent.html of the app),
//    then receives an access token for that user.
// 3. Each request carries that token. The trees are read and written with it, so the database's row-level
//    security only lets the user reach their own trees. This function holds no secret key.
//
// Stateless: each request gets its own MCP server and transport (no session to keep between requests).
// show_tree and add_exchange also draw the tree in the conversation (MCP Apps page, see view.ts).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.32.2/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.32.2/server/webStandardStreamableHttp.js';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import * as tree from './tree.ts';
import { VIEW_HTML } from './view.ts';

const VERSION = '0.2.0';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;          // public key: only lets requests reach the API
const RESOURCE = `${SUPABASE_URL}/functions/v1/mcp`;            // this connector's public address
const METADATA_PATH = '/.well-known/oauth-protected-resource';
const TEXT_LENGTH = 100_000;                                    // longest question or answer accepted
const EMOJI_LENGTH = 8;
const VIEW_URI = 'ui://ramifai/tree-v1.html';                   // the tree drawn in the conversation (view.ts)
const VIEW_MIME = 'text/html;profile=mcp-app';                  // MCP Apps page
const view = { ui: { resourceUri: VIEW_URI } };                 // tools whose result is shown with the drawn tree

const INSTRUCTIONS = 'Ramifai keeps conversations as trees. Each box holds one question and its answer, with a short ' +
  'keyword, a one-sentence summary and an emoji; its parent is the box it follows from. To continue in a tree: ' +
  'show_tree to see the boxes, read_branch on the box to follow from (it gives the context), answer the user, then ' +
  'add_exchange to record the question and your answer under that box. If the tree or the box is unclear, ask the user. ' +
  'show_tree and add_exchange also draw the tree for the user, so there is no need to describe its shape.';

// Answers to browsers too (e.g. the MCP Inspector), which ask before sending these headers
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id',
  'Access-Control-Expose-Headers': 'www-authenticate, mcp-session-id',
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json', ...headers } });

// Description of this connector for the assistants: where users sign in (RFC 9728)
const metadata = () => json({
  resource: RESOURCE,
  authorization_servers: [`${SUPABASE_URL}/auth/v1`],
  bearer_methods_supported: ['header'],
  resource_name: 'Ramifai',
});
const unauthorized = (why: string) => json({ error: 'invalid_token', error_description: why }, 401, {
  'www-authenticate': `Bearer resource_metadata="${RESOURCE}${METADATA_PATH}"`,
});

// The tools, bound to the database client of the signed-in user
function buildServer(db: SupabaseClient): McpServer {
  const server = new McpServer({ name: 'ramifai', version: VERSION }, { instructions: INSTRUCTIONS });
  // A tool's answer is plain text, plus data for the drawn tree when there is one; an error is returned as text
  // too, so the assistant can correct its call
  type Answer = string | { text: string; data: Record<string, unknown> };
  const reply = <A>(task: (args: A) => Promise<Answer>) => async (args: A) => {
    try {
      const r = await task(args);
      return typeof r === 'string' ? { content: [{ type: 'text' as const, text: r }] }
        : { content: [{ type: 'text' as const, text: r.text }], structuredContent: r.data };
    } catch (e) { return { content: [{ type: 'text' as const, text: (e as Error).message }], isError: true }; }
  };
  const load = async (name: string): Promise<tree.Tree> => {
    const { data, error } = await db.from('trees').select('data').eq('name', name).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`No tree named "${name}". Use list_trees to see the trees.`);
    return data.data as tree.Tree;
  };
  const treeName = z.string().max(tree.NAME_LENGTH).describe('Name of the tree, as given by list_trees');
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const adds = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  server.registerTool('list_trees', {
    title: 'List the trees',
    description: 'List your Ramifai trees: name, title, number of boxes, last change.',
    annotations: readOnly,
  }, reply(async () => {
    const { data, error } = await db.from('trees').select('name, data, updated_at').order('name');
    if (error) throw new Error(error.message);
    if (!data.length) return 'No tree yet. Use create_tree to start one.';
    return data.map(t => `${t.name} — ${tree.titleOf(t.data)} (${t.data.nodes.length} boxes, changed ${t.updated_at.split('T')[0]})`).join('\n');
  }));

  server.registerTool('create_tree', {
    title: 'Create a tree',
    description: 'Create an empty Ramifai tree. Returns its name, to use with the other tools.',
    inputSchema: { title: z.string().min(1).max(tree.TITLE_LENGTH).describe('Title of the tree, shown on its first box') },
    annotations: adds,
  }, reply(async ({ title }: { title: string }) => {
    const { data: rows, error } = await db.from('trees').select('name');
    if (error) throw new Error(error.message);
    const name = tree.freeName(title, new Set(rows.map(r => r.name)));
    const { error: insertError } = await db.from('trees').insert({ name, data: tree.newTree(title) });
    if (insertError) throw new Error(insertError.message);
    return `Tree "${name}" created. Its first box has the id "${tree.ROOT}": add the first exchange under it.`;
  }));

  server.registerTool('show_tree', {
    title: 'Show a tree',
    description: 'Plan of a tree: one line per box (id · emoji keyword — summary), indented under its parent. ' +
      'The user also sees the tree drawn.',
    inputSchema: { tree: treeName },
    annotations: readOnly,
    _meta: view,
  }, reply(async ({ tree: name }: { tree: string }) => ({ text: tree.outline(await load(name)), data: { tree: name } })));

  // Only for the drawn tree (the page calls it): the whole tree, which the model does not need to receive again
  server.registerTool('get_tree_view', {
    title: 'Tree for the drawing',
    description: 'Whole tree, for the drawn view only.',
    inputSchema: { tree: treeName },
    annotations: readOnly,
    _meta: { ui: { resourceUri: VIEW_URI, visibility: ['app'] } },
  }, reply(async ({ tree: name }: { tree: string }) => {
    const data = await load(name);
    const nodes = data.nodes.map(({ id, parent, q, a, kw, sum, ico }) => ({ id, parent, q, a, kw, sum, ico }));
    return { text: `Tree "${name}" sent to the view.`, data: { name, title: tree.titleOf(data), nodes } };
  }));

  server.registerTool('read_branch', {
    title: 'Read a branch',
    description: `Context of a box: the path from the first box to it, as summaries, with the last ${tree.FULL_EXCHANGES} ` +
      'exchanges in full. Read it before answering a question that follows from this box.',
    inputSchema: { tree: treeName, box: z.string().max(tree.NAME_LENGTH).describe('Id of the box, as given by show_tree') },
    annotations: readOnly,
  }, reply(async ({ tree: name, box }: { tree: string; box: string }) => tree.branch(await load(name), box)));

  server.registerTool('add_exchange', {
    title: 'Add an exchange',
    description: 'Record a question and its answer as a new box under a parent box. Returns the id of the new box. ' +
      'The user sees the tree drawn, with the new box.',
    inputSchema: {
      tree: treeName,
      parent: z.string().max(tree.NAME_LENGTH).describe(`Id of the box this exchange follows from ("${tree.ROOT}" for a new branch from the start)`),
      question: z.string().min(1).max(TEXT_LENGTH).describe("The user's question, as asked"),
      answer: z.string().min(1).max(TEXT_LENGTH).describe('The full answer'),
      keyword: z.string().min(1).max(tree.KEYWORD_LENGTH).describe('1 to 3 words naming the box'),
      summary: z.string().min(1).max(TEXT_LENGTH).describe('One sentence summing up the answer'),
      emoji: z.string().max(EMOJI_LENGTH).optional().describe('One emoji for the box'),
    },
    annotations: adds,
    _meta: view,
  }, reply(async (a: { tree: string; parent: string; question: string; answer: string; keyword: string; summary: string; emoji?: string }) => {
    const data = await load(a.tree);
    tree.find(data, a.parent);
    const node: tree.Node = { id: tree.newId(data), parent: a.parent, q: a.question, a: a.answer, kw: a.keyword,
      sum: a.summary, ico: a.emoji || '', by: 'MCP' };
    // added in one database statement, so two boxes added at the same moment are both kept
    const { data: added, error } = await db.rpc('add_tree_node', { tree_name: a.tree, node });
    if (error) throw new Error(error.message);
    if (!added) throw new Error(`The tree "${a.tree}" or the box "${a.parent}" no longer exists.`);
    return { text: `Box "${node.id}" added under "${a.parent}".`, data: { tree: a.tree, box: node.id } };
  }));

  server.registerResource('tree-view', VIEW_URI, { title: 'Ramifai tree', mimeType: VIEW_MIME,
    description: 'The tree drawn in the conversation' }, async () => ({
    contents: [{ uri: VIEW_URI, mimeType: VIEW_MIME, text: VIEW_HTML, _meta: { ui: { prefersBorder: true } } }],
  }));
  return server;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (new URL(req.url).pathname.endsWith(METADATA_PATH)) return metadata();

  const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return unauthorized('Sign in to Ramifai first.');
  const db = createClient(SUPABASE_URL, PUBLIC_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user, error } = await db.auth.getUser(token);   // asks Supabase Auth whether the token is valid
  if (error || !user?.user) return unauthorized('The token is not valid or has expired.');

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildServer(db).connect(transport);
  const response = await transport.handleRequest(req);
  for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
  return response;
});
