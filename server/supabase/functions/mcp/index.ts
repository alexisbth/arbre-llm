// Ramifai MCP connector (remote), as a Supabase Edge Function.
// The tools of the local connector (folder mcp/), plus start_ramifai and the drawn tree, for assistants that only
// accept connectors on a server: claude.ai and its phone apps, ChatGPT, etc.
//
// How the user is recognized (MCP authorization, OAuth 2.1):
// 1. Without a valid token, the answer is 401, with the address of this connector's description
//    (".well-known/oauth-protected-resource", RFC 9728). It names the sign-in server: Supabase Auth.
// 2. The assistant registers itself there, sends the user to sign in and approve (page consent.html of the app),
//    then receives an access token for that user.
// 3. Each request carries that token. The trees are read and written with it, so the database's row-level
//    security only lets the user reach their own trees. This function holds no secret key.
//
// Stateless: each request gets its own MCP server (no session to keep between requests). Both versions of the
// protocol are served: 2026-07-28 (each request carries everything it needs) and the 2025 versions
// (initialize first), which some assistants still use.
// start_ramifai and show_tree also draw the tree: in Claude's side panel on a computer, full screen on a phone
// (MCP Apps page, see view.ts). The drawing updates itself as boxes are added. Tapping a box there marks it
// "Next question here": the next box added goes under it, whatever box the assistant chose (column next_parent).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { McpServer, createMcpHandler } from 'npm:@modelcontextprotocol/server@2.4.0';
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@4';
import * as tree from './tree.ts';
import { VIEW_HTML } from './view.ts';

const VERSION = '0.5.2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;          // public key: only lets requests reach the API
const RESOURCE = `${SUPABASE_URL}/functions/v1/mcp`;            // this connector's public address
const METADATA_PATH = '/.well-known/oauth-protected-resource';
const TEXT_LENGTH = 100_000;                                    // longest question or answer accepted
const EMOJI_LENGTH = 8;
const VIEW_URI = 'ui://ramifai/tree-v3.html';                   // the tree drawn in the assistant (view.ts)
const VIEW_MIME = 'text/html;profile=mcp-app';                  // MCP Apps page
// tools whose result is shown with the drawn tree (both keys, as the official MCP Apps kit writes them)
const view = { ui: { resourceUri: VIEW_URI }, 'ui/resourceUri': VIEW_URI };
const NEW_TREE_NAME = 'New tree';
const ROOT_TITLE = 'Start';                                    // label of the first box: the tree's name is not written there

const INSTRUCTIONS = 'Ramifai keeps conversations as trees. Each box holds one question and its answer, with a short ' +
  'keyword, a one-sentence summary and an emoji; its parent is the box it follows from. When the user says "start ' +
  'Ramifai" (in any language), call start_ramifai (with the tree name if the user gives one): from then on, record every exchange with ' +
  'add_exchange, except the start command itself, which is not part of the tree. ' +
  'start_ramifai and show_tree also draw the tree for the user, so there is no need to describe its shape.';

// What the assistant must do once Ramifai is started; repeated in every add_exchange answer so it is not forgotten
const RULE = 'Ramifai is on in this conversation until the user says to stop. After each of your answers, call ' +
  'add_exchange with the user\'s question and your full answer. Never record the start command itself ("start ' +
  'Ramifai", the tree\'s name...): only the real questions that follow. Parent: the box the question follows from by subject; ' +
  '"root" for a new subject; the last box if unsure. If the user tapped a box in the drawing ("Next question here"), ' +
  'the exchange goes under that box whatever parent you give; when you are told which box, read_branch on it before ' +
  'answering. Do not describe the tree\'s shape: the user sees it drawn.';

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
  // A tree's row: the tree, the box tapped in the drawing (next_parent) and the time of the last change
  type Row = { data: tree.Tree; next_parent: string | null; updated_at: string };
  const loadRow = async (name: string): Promise<Row> => {
    const { data, error } = await db.from('trees').select('data, next_parent, updated_at').eq('name', name).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`No tree named "${name}". Use list_trees to see the trees.`);
    return data as Row;
  };
  const load = async (name: string) => (await loadRow(name)).data;
  const create = async (wanted: string): Promise<string> => {
    const { data: rows, error } = await db.from('trees').select('name');
    if (error) throw new Error(error.message);
    const name = tree.freeName(wanted, new Set(rows.map(r => r.name)));
    const { error: insertError } = await db.from('trees').insert({ name, data: tree.newTree(ROOT_TITLE) });
    if (insertError) throw new Error(insertError.message);
    return name;
  };
  const setNext = async (name: string, box: string | null) => {
    const { error } = await db.from('trees').update({ next_parent: box }).eq('name', name);
    if (error) throw new Error(error.message);
  };
  const treeName = z.string().max(tree.NAME_LENGTH).describe('Name of the tree, as given by list_trees');
  const boxId = z.string().max(tree.NAME_LENGTH);
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  const adds = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const appOnly = { ui: { resourceUri: VIEW_URI, visibility: ['app'] } };   // tools only the drawing can call

  server.registerTool('start_ramifai', {
    title: 'Start Ramifai',
    description: 'Call when the user says "start Ramifai" (in any language, e.g. "démarrer Ramifai") or asks to keep ' +
      'this conversation as a Ramifai tree. Opens the tree of that name, or creates it if it does not exist, and draws ' +
      'it. From then on, record every exchange with add_exchange, but not the start command itself.',
    inputSchema: z.object({
      tree: z.string().min(1).max(tree.TITLE_LENGTH).optional()
        .describe('Name the user gave to the tree (e.g. "test2"), exactly as said: opened if it exists, created if not. ' +
          'Leave out if the user gave no name.'),
    }),
    annotations: adds,
    _meta: view,
  }, reply(async ({ tree: wanted }: { tree?: string }) => {
    let name = wanted ?? NEW_TREE_NAME;
    const { data: found, error } = wanted ? await db.from('trees').select('name').eq('name', wanted).maybeSingle() : { data: null, error: null };
    if (error) throw new Error(error.message);
    if (!found) name = await create(name);          // the tree's name is the one asked for; its first box is just "Start"
    const data = await load(name);
    await setNext(name, null);              // a box tapped before this start is forgotten
    return { text: `Ramifai started on the tree "${name}" (${data.nodes.length - 1} boxes). ${RULE}\n\nBoxes:\n${tree.outline(data)}`,
      data: { tree: name } };
  }));

  server.registerTool('list_trees', {
    title: 'List the trees',
    description: 'List your Ramifai trees: name, title, number of boxes, last change.',
    annotations: readOnly,
  }, reply(async () => {
    const { data, error } = await db.from('trees').select('name, data, updated_at').order('name');
    if (error) throw new Error(error.message);
    if (!data.length) return 'No tree yet. Use start_ramifai or create_tree to start one.';
    return data.map(t => `${t.name} (${t.data.nodes.length} boxes, changed ${t.updated_at.split('T')[0]})`).join('\n');
  }));

  server.registerTool('create_tree', {
    title: 'Create a tree',
    description: 'Create an empty Ramifai tree, without starting Ramifai. Returns its name, to use with the other tools.',
    inputSchema: z.object({ name: z.string().min(1).max(tree.TITLE_LENGTH).describe('Name of the tree') }),
    annotations: adds,
  }, reply(async ({ name: wanted }: { name: string }) => {
    const name = await create(wanted);
    return `Tree "${name}" created. Its first box has the id "${tree.ROOT}": add the first exchange under it.`;
  }));

  server.registerTool('show_tree', {
    title: 'Show a tree',
    description: 'Plan of a tree: one line per box (id · emoji keyword — summary), indented under its parent. ' +
      'The user also sees the tree drawn.',
    inputSchema: z.object({ tree: treeName }),
    annotations: readOnly,
    _meta: view,
  }, reply(async ({ tree: name }: { tree: string }) => ({ text: tree.outline(await load(name)), data: { tree: name } })));

  // For the drawing only: the whole tree (the model does not need to receive it again), with the tapped box.
  // When the drawing already has the latest version (same "changed" time), only that time is sent back.
  server.registerTool('get_tree_view', {
    title: 'Tree for the drawing',
    description: 'Whole tree, for the drawn view only.',
    inputSchema: z.object({ tree: treeName, known: z.string().max(tree.NAME_LENGTH).optional() }),
    annotations: readOnly,
    _meta: appOnly,
  }, reply(async ({ tree: name, known }: { tree: string; known?: string }) => {
    const row = await loadRow(name);
    if (known === row.updated_at) return { text: 'No change.', data: { name, changed: row.updated_at, unchanged: true } };
    const nodes = row.data.nodes.map(({ id, parent, q, a, kw, sum, ico }) => ({ id, parent, q, a, kw, sum, ico }));
    return { text: `Tree "${name}" sent to the view.`,
      data: { name, title: name, nodes, next: row.next_parent, changed: row.updated_at } };
  }));

  // For the drawing only: the box the user tapped ("Next question here"), or null to let the assistant choose again
  server.registerTool('pick_box', {
    title: 'Next question here',
    description: 'Mark the box the next exchange goes under, for the drawn view only.',
    inputSchema: z.object({ tree: treeName, box: boxId.nullable() }),
    annotations: { ...adds, idempotentHint: true },
    _meta: appOnly,
  }, reply(async ({ tree: name, box }: { tree: string; box: string | null }) => {
    if (box !== null) tree.find(await load(name), box);
    await setNext(name, box);
    return { text: box ? `The next box goes under "${box}".` : 'The assistant chooses where the next box goes.',
      data: { tree: name, next: box } };
  }));

  server.registerTool('read_branch', {
    title: 'Read a branch',
    description: `Context of a box: the path from the first box to it, as summaries, with the last ${tree.FULL_EXCHANGES} ` +
      'exchanges in full. Read it before answering a question that follows from this box.',
    inputSchema: z.object({ tree: treeName, box: boxId.describe('Id of the box, as given by show_tree') }),
    annotations: readOnly,
  }, reply(async ({ tree: name, box }: { tree: string; box: string }) => tree.branch(await load(name), box)));

  server.registerTool('add_exchange', {
    title: 'Add an exchange',
    description: 'Record a question and its answer as a new box. Once Ramifai is started, call it after each answer. ' +
      'If the user tapped a box in the drawing, the box goes under it, whatever parent is given. Returns the new box.',
    inputSchema: z.object({
      tree: treeName,
      parent: boxId.optional().describe(`Id of the box the question follows from by subject ("${tree.ROOT}" for a new ` +
        'subject). Leave out to follow the last box.'),
      question: z.string().min(1).max(TEXT_LENGTH).describe("The user's question, as asked"),
      answer: z.string().min(1).max(TEXT_LENGTH).describe('The full answer'),
      keyword: z.string().min(1).max(tree.KEYWORD_LENGTH).describe('1 to 3 words naming the box'),
      summary: z.string().min(1).max(TEXT_LENGTH).describe('One sentence summing up the answer'),
      emoji: z.string().max(EMOJI_LENGTH).optional().describe('One emoji for the box'),
    }),
    annotations: adds,
  }, reply(async (a: { tree: string; parent?: string; question: string; answer: string; keyword: string; summary: string; emoji?: string }) => {
    const data = await load(a.tree);
    const given = a.parent ?? data.nodes[data.nodes.length - 1].id;
    const node: tree.Node = { id: tree.newId(data), parent: given, q: a.question, a: a.answer, kw: a.keyword,
      sum: a.summary, ico: a.emoji || '', by: 'MCP' };
    // one database statement: puts the box under the tapped box if there is one, else under the given parent
    const { data: used, error } = await db.rpc('add_tree_node', { tree_name: a.tree, node });
    if (error) throw new Error(error.message);
    if (!used) throw new Error(`No box "${given}" in the tree "${a.tree}". Use show_tree to see the ids.`);
    const where = used === given ? `under "${used}"` : `under "${used}", the box the user tapped`;
    return `Box "${node.id}" added ${where}. If Ramifai is on, record the next exchange too, unless the user said to stop.`;
  }));

  server.registerResource('tree-view', VIEW_URI, { title: 'Ramifai tree', mimeType: VIEW_MIME,
    description: 'The tree drawn in the conversation' }, async () => ({
    // preferredDisplayMode: Claude opens the drawing in its side panel, next to the chat, without a click
    contents: [{ uri: VIEW_URI, mimeType: VIEW_MIME, text: VIEW_HTML, _meta: { ui: { prefersBorder: true, preferredDisplayMode: 'fullscreen' } } }],
  }));
  return server;
}

// Answers the MCP requests, in both versions of the protocol. The server is built for each request with the
// database client of the user who sent it (passed in authInfo by Deno.serve below, once the token is checked).
const mcp = createMcpHandler(({ authInfo }) => {
  const db = authInfo?.extra?.db as SupabaseClient | undefined;
  if (!db) throw new Error('No signed-in user for this request.');
  return buildServer(db);
});

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

  const body = await req.clone().text();
  const answer = await mcp.fetch(req, { authInfo: { token, clientId: '', scopes: [], extra: { db } } });
  const response = new Response(answer.body, answer);           // a copy whose headers can be changed
  for (const [k, v] of Object.entries(CORS)) response.headers.set(k, v);
  console.log(JSON.stringify({ rpc: describe(body), version: req.headers.get('mcp-protocol-version'), status: response.status,
    error: response.status >= 400 ? await response.clone().text() : undefined }));
  return response;
});

// What a request asks for, for the logs: the kind of request and the names of its fields, never their values
// (no question, answer, tree or token)
function describe(body: string): string[] {
  try {
    const m = JSON.parse(body);
    return (Array.isArray(m) ? m : [m]).map((x) => {
      const p = x?.params ?? {};
      const kind = x?.method ?? (x && 'result' in x ? 'result' : x && 'error' in x ? 'error' : '?');
      return [kind, typeof p.name === 'string' ? p.name : '', typeof p.protocolVersion === 'string' ? p.protocolVersion : '',
        `fields: ${Object.keys(p).join(',')}`, p.capabilities ? `capabilities: ${Object.keys(p.capabilities).join(',')}` : '']
        .filter(Boolean).join(' ');
    });
  } catch { return ['not JSON']; }
}
