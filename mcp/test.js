// End-to-end test: starts the connector like an assistant would, in an empty temporary folder, and calls every tool.
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('the tools build a tree the app can open', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ramifai-'));
  const client = new Client({ name: 'test-client', version: '1' });
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [new URL('./server.js', import.meta.url).pathname], env: { ...process.env, RAMIFAI_DIR: dir },
  }));
  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { text: r.content[0].text, error: !!r.isError };
  };
  try {
    assert.match(client.getInstructions(), /add_exchange/);
    const names = (await client.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(names, ['add_exchange', 'create_tree', 'list_trees', 'read_branch', 'show_tree']);

    assert.match((await call('list_trees')).text, /No tree yet/);
    assert.match((await call('create_tree', { title: 'Électricité & Ohm' })).text, /"electricite-ohm"/);
    assert.match((await call('create_tree', { title: 'Électricité & Ohm' })).text, /"electricite-ohm-2"/);

    const add = args => call('add_exchange', { tree: 'electricite-ohm', ...args });
    const first = (await add({ parent: 'root', question: 'Q1?', answer: 'A1.', keyword: 'Ohm', summary: 'S1.', emoji: '⚡' })).text;
    const id1 = first.match(/Box "(\w+)"/)[1];
    const id2 = (await add({ parent: id1, question: 'Q2?', answer: 'A2.', keyword: 'Power', summary: 'S2.' })).text.match(/Box "(\w+)"/)[1];
    const id3 = (await add({ parent: id2, question: 'Q3?', answer: 'A3.', keyword: 'Heat', summary: 'S3.' })).text.match(/Box "(\w+)"/)[1];
    // two changes at the same time: both are kept
    await Promise.all([add({ parent: id1, question: 'Qa?', answer: 'Aa.', keyword: 'A', summary: 'Sa.' }),
      add({ parent: id1, question: 'Qb?', answer: 'Ab.', keyword: 'B', summary: 'Sb.' })]);

    const plan = (await call('show_tree', { tree: 'electricite-ohm' })).text;
    assert.match(plan, new RegExp(`^  - ${id1} · ⚡ Ohm — S1\\.$`, 'm'));
    assert.match(plan, new RegExp(`^      - ${id3} · Heat — S3\\.$`, 'm'));
    assert.equal(plan.split('\n').length, 6);

    const context = (await call('read_branch', { tree: 'electricite-ohm', box: id3 })).text;
    assert.match(context, /- Ohm: S1\./);                       // older exchange: its summary
    assert.match(context, /Question: Q2\?\nAnswer: A2\./);       // last two: in full
    assert.match(context, /Question: Q3\?\nAnswer: A3\./);
    assert.doesNotMatch(context, /A1\./);

    // mistakes are reported, nothing is written outside the folder
    assert.ok((await add({ parent: 'nope', question: 'Q', answer: 'A', keyword: 'k', summary: 's' })).error);
    assert.ok((await call('show_tree', { tree: '../etc/passwd' })).error);
    assert.ok((await call('show_tree', { tree: 'missing' })).error);
    assert.deepEqual((await readdir(dir)).sort(), ['electricite-ohm-2.json', 'electricite-ohm.json']);

    const list = (await call('list_trees')).text;
    assert.match(list, /electricite-ohm — Électricité & Ohm \(6 boxes/);

    const file = JSON.parse(await readFile(join(dir, 'electricite-ohm.json'), 'utf8'));
    assert.equal(file.version, 4);
    assert.equal(file.nodes.find(n => n.id === id1).by, 'test-client');
  } finally {
    await client.close();
  }
});
