import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createBridge } from '../src/server.mjs';
import { editors, repoRoot } from '../src/catalog.mjs';

const cli = (kind, command, root, args = [], input = '') => JSON.parse(execFileSync(process.execPath, [path.join(repoRoot, 'skills', editors[kind], 'scripts/artifact.mjs'), command, root, ...args], { input, encoding: 'utf8' }));
const decode = reply => reply.structuredContent ?? JSON.parse(reply.content[0].text);
const cases = [
  ['slides', 'project/deck.json', { v: 4, title: 'Shared workspace', order: [], sections: {} }],
  ['design', 'project/canvas.json', { v: 3, title: 'Shared workspace', boards: {}, order: [], pages: [], notes: {}, designSystems: [] }],
  ['design-system', 'project/design-system.json', { v: 3, title: 'Shared workspace', namespace: 'smoke', layout: 'files', createdOnFiles: { v: 1, at: '2026-11-11T00:00:00Z' } }],
  ['dashboard', 'dash/meta', { title: 'Shared workspace' }],
  ['motion', 'film/meta', { v: 1, title: 'Shared workspace', updatedAt: '2026-11-11T00:00:00Z' }],
  ['whiteboard', 'board/meta', { v: 1, title: 'Shared workspace', order: [] }],
];

const temporary = () => fs.mkdtemp(path.join(os.tmpdir(), 'baoyu shared '));

async function seed(kind, root, file, data) {
  await fs.mkdir(root, { recursive: true });
  if (file.startsWith('project/')) {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), JSON.stringify(data));
  } else cli(kind, 'write-db', root, ['-'], JSON.stringify([{ op: 'set', path: file, data }]));
}

async function jsonRequest(url, data) {
  const response = await fetch(url, data === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: new URL(url).origin }, body: JSON.stringify(data),
  });
  const body = await response.json();
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}

test('Desktop launch configuration starts one stdio bridge; all editors share files and saved comments with local CLI processes', async t => {
  const temp = await temporary(t);
  const config = JSON.parse(execFileSync(process.execPath, [path.join(repoRoot, 'claude-plugins/scripts/config.mjs')], { encoding: 'utf8' }));
  const launch = config.mcpServers['baoyu-editor'];
  assert.equal(launch.command, process.execPath);
  const shell = path.join(temp, 'VM shell');
  const workspace = path.join(temp, 'host workspace');
  await fs.mkdir(shell);
  await fs.mkdir(workspace);
  const vmWorkspace = path.join(temp, 'VM mount alias');
  await fs.symlink(workspace, vmWorkspace, 'junction');
  const alias = path.join(temp, 'cached MCP entry.mjs');
  await fs.symlink(launch.args[0], alias, 'file');
  const client = new Client({ name: 'shared-workspace-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: launch.command, args: [alias, ...launch.args.slice(1)], cwd: shell, stderr: 'pipe' });
  let logs = '';
  transport.stderr.on('data', chunk => { logs += chunk; });
  const roots = [];
  t.after(async () => {
    for (const args of roots) await client.callTool({ name: 'stop_artifact', arguments: args }).catch(() => {});
    await client.close();
    await fs.rm(temp, { recursive: true, force: true });
  });
  await client.connect(transport).catch(error => { throw new Error(`${error.message}\n${logs}`); });
  const list = await client.listTools();
  assert.deepEqual(list.tools.map(x => x.name).sort(), ['open_artifact', 'stop_artifact']);
  assert.match(client.getInstructions(), /Saved comments/);
  const tool = async (name, args) => {
    const reply = await client.callTool({ name, arguments: args });
    assert.ok(!reply.isError, JSON.stringify(reply));
    assert.deepEqual(decode(reply), JSON.parse(reply.content[0].text));
    return decode(reply);
  };
  for (const [kind, file, data] of cases) await t.test(kind, async () => {
    const root = path.join(workspace, kind);
    const vmRoot = path.join(vmWorkspace, kind);
    // A symlink models distinct paths to the same bytes, not a real VM/network boundary.
    await seed(kind, vmRoot, file, data);
    const args = { path: root, kind };
    roots.push(args);
    const opened = await tool('open_artifact', args);
    assert.equal(new URL(opened.url).hostname, '127.0.0.1');
    assert.match(await (await fetch(opened.url)).text(), /html/i);
    assert.equal((await tool('open_artifact', args)).url, opened.url);
    const viaAlias = await tool('open_artifact', { path: vmRoot, kind });
    assert.equal(viaAlias.path, await fs.realpath(root));
    assert.equal(viaAlias.url, opened.url);
    assert.equal(viaAlias.reused, true);

    const changed = { ...data, title: `Written through VM path: ${kind}` };
    await seed(kind, vmRoot, file, changed);
    const published = await jsonRequest(new URL(file.startsWith('project/') ? file : `_api/doc?path=${file}`, opened.url));
    assert.equal((published.data ?? published).title, changed.title);

    const endpoint = new URL('__comments', opened.url);
    await jsonRequest(endpoint, { anchor: 'test-anchor', label: 'Test comment', text: 'Please revise the title.', send: false });
    const comments = cli(kind, 'comments', vmRoot);
    assert.equal(comments.threads.length, 1);
    const reply = 'Implemented from shared workspace.\nLiteral `text` and $(no-shell).';
    cli(kind, 'comment-reply', vmRoot, [comments.threads[0].id, '-', '--resolve'], reply);
    assert.equal(cli(kind, 'comments', vmRoot).threads.length, 0);
    const hostComments = JSON.stringify(await jsonRequest(endpoint));
    assert.match(hostComments, /Implemented from shared workspace/);
    assert.match(hostComments, /resolved/);
    assert.match(await fs.readFile(path.join(root, 'comments.json'), 'utf8'), /\$\(no-shell\)/);
    assert.equal((await tool('stop_artifact', args)).stopped, true);
    assert.equal((await tool('stop_artifact', args)).stopped, false);
  });
  assert.deepEqual(await fs.readdir(shell), [], 'MCP must not create a second artifact workspace in its cwd');
});

test('concurrent opens reuse the host hub, stop preserves sibling projects, and MCP reconnects retain access', async t => {
  const temp = await temporary(t);
  const [kind, file, data] = cases[0];
  const args = { path: path.join(temp, 'first'), kind };
  const sibling = { path: path.join(temp, 'second'), kind };
  await seed(kind, args.path, file, data);
  await seed(kind, sibling.path, file, data);
  const bridge = await createBridge();
  const roots = [args, sibling];
  let reconnected;
  t.after(async () => {
    for (const a of roots) await (reconnected ?? bridge).call('stop_artifact', a);
    bridge.close(); reconnected?.close();
    await fs.rm(temp, { recursive: true, force: true });
  });
  const opened = await Promise.all([bridge.call('open_artifact', args), bridge.call('open_artifact', args)]);
  assert.ok(opened.every(reply => !reply.isError), JSON.stringify(opened));
  assert.equal(decode(opened[0]).url, decode(opened[1]).url);
  assert.equal(decode(opened[1]).reused, true);
  const other = decode(await bridge.call('open_artifact', sibling));
  assert.equal(new URL(other.url).origin, new URL(decode(opened[0]).url).origin);
  bridge.close();
  reconnected = await createBridge();
  assert.equal(decode(await reconnected.call('open_artifact', args)).reused, true);
  assert.equal(decode(await reconnected.call('stop_artifact', args)).stopped, true);
  assert.equal((await fetch(other.url)).status, 200);

  // Exercise a real browser write endpoint in a database-backed editor, then read locally.
  const [boardKind, boardFile, boardData] = cases[5];
  const board = { path: path.join(temp, 'browser-edited board'), kind: boardKind };
  roots.push(board);
  await seed(boardKind, board.path, boardFile, boardData);
  const boardOpen = await reconnected.call('open_artifact', board);
  assert.ok(!boardOpen.isError, JSON.stringify(boardOpen));
  await jsonRequest(new URL('_api/write', decode(boardOpen).url), { op: 'update', path: 'board/meta', data: { title: 'Edited in host browser' } });
  assert.match(JSON.stringify(cli(boardKind, 'read-db', board.path, ['board/meta'])), /Edited in host browser/);
});

test('invalid requests and unverified shared PIDs never execute arbitrary host commands or stop another process', async t => {
  const temp = await temporary(t);
  const bridge = await createBridge();
  t.after(async () => { bridge.close(); await fs.rm(temp, { recursive: true, force: true }); });
  const args = { path: temp, kind: 'slides' };
  for (const [name, input, code] of [
    ['artifact_files', args, 'INVALID_ARGUMENT'],
    ['open_artifact', { ...args, path: 'relative/path' }, 'INVALID_PATH'],
    ['open_artifact', { ...args, path: path.join(temp, 'absent') }, 'ARTIFACT_NOT_FOUND'],
    ['open_artifact', { ...args, kind: 'constructor' }, 'INVALID_ARGUMENT'],
    ['open_artifact', { ...args, command: 'touch unwanted' }, 'INVALID_ARGUMENT'],
    ['open_artifact', args, 'INVALID_ARTIFACT'],
  ]) {
    const reply = await bridge.call(name, input);
    assert.equal(reply.isError, true, JSON.stringify(reply));
    assert.equal(decode(reply).code, code);
  }
  const state = { pid: process.pid, root: temp, kind: 'slides', url: 'http://127.0.0.1:1/slides/fake/' };
  const statePath = path.join(temp, '.artifact-server.json');
  for (const url of [state.url, 'https://example.com/slides/fake/']) {
    const contents = JSON.stringify({ ...state, url });
    await fs.writeFile(statePath, contents);
    const reply = await bridge.call('stop_artifact', args);
    assert.equal(reply.isError, true);
    assert.equal(decode(reply).code, 'SERVER_STATE_CONFLICT');
    assert.equal(await fs.readFile(statePath, 'utf8'), contents, 'Foreign state must not be removed');
  }
});

test('a host server from before a checkout update can be stopped and reopened using the new runtime', async t => {
  const temp = await temporary(t);
  const skill = path.join(temp, 'skills/claude-whiteboard');
  await fs.cp(path.join(repoRoot, 'skills/claude-whiteboard'), skill, { recursive: true });
  const [kind, file, data] = cases[5];
  const args = { path: path.join(temp, 'artifact'), kind };
  await seed(kind, args.path, file, data);
  const bridge = await createBridge(temp);
  t.after(async () => {
    await bridge.call('stop_artifact', args);
    bridge.close();
    await fs.rm(temp, { recursive: true, force: true });
  });
  const opened = await bridge.call('open_artifact', args);
  assert.ok(!opened.isError, JSON.stringify(opened));
  const script = path.join(skill, 'scripts/artifact.mjs');
  const stat = await fs.stat(script);
  await fs.utimes(script, stat.atime, new Date(stat.mtimeMs + 2000));
  const old = await bridge.call('open_artifact', args);
  assert.equal(old.isError, true);
  assert.match(decode(old).reason, /older build/);
  assert.equal(decode(await bridge.call('stop_artifact', args)).stopped, true);
  const reopened = await bridge.call('open_artifact', args);
  assert.ok(!reopened.isError, JSON.stringify(reopened));
  assert.equal(decode(reopened).reused, false);
});

test('missing runtimes, malformed launcher output, cancellation and deadlines return tool errors', async t => {
  const temp = await temporary(t);
  await fs.mkdir(path.join(temp, 'skills'));
  const scriptDir = path.join(temp, 'skills/claude-whiteboard/scripts');
  const bridge = await createBridge(temp, { timeoutMs: 300 });
  t.after(async () => { bridge.close(); await fs.rm(temp, { recursive: true, force: true }); });
  const args = { path: temp, kind: 'whiteboard' };
  assert.equal(decode(await bridge.call('open_artifact', args)).code, 'RUNTIME_NOT_FOUND');
  await fs.mkdir(scriptDir, { recursive: true });
  const script = path.join(scriptDir, 'artifact.mjs');
  await fs.writeFile(script, 'console.log("not json");');
  assert.equal(decode(await bridge.call('open_artifact', args)).code, 'OPEN_FAILED');
  await fs.writeFile(script, 'console.error(JSON.stringify({error: {unexpected: true}})); process.exitCode = 2;');
  assert.equal(decode(await bridge.call('open_artifact', args)).code, 'OPEN_FAILED');
  await fs.writeFile(script, 'setInterval(() => {}, 1000);');
  assert.equal(decode(await bridge.call('open_artifact', args)).code, 'STARTUP_TIMEOUT');
  const controller = new AbortController();
  const running = bridge.call('open_artifact', args, controller.signal);
  controller.abort();
  assert.equal(decode(await running).code, 'CANCELLED');
  assert.throws(() => execFileSync(process.execPath, [path.join(repoRoot, 'claude-plugins/src/stdio.mjs'), '--repo', path.join(temp, 'absent')], { stdio: 'pipe' }), error => {
    assert.equal(error.status, 1);
    assert.equal(error.stdout.toString(), '');
    assert.match(error.stderr.toString(), /Baoyu editor MCP startup failed/);
    return true;
  });
});

test('open refuses a launcher URL that does not identify the trusted runtime', async t => {
  const temp = await temporary(t);
  const scriptDir = path.join(temp, 'skills/claude-whiteboard/scripts');
  await fs.mkdir(scriptDir, { recursive: true });
  const server = http.createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ hub: 1, kind: 'whiteboard', pid: process.pid, build: 'another runtime' })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/whiteboard/fake/`;
  await fs.writeFile(path.join(temp, '.artifact-server.json'), JSON.stringify({ root: temp, kind: 'whiteboard', pid: process.pid, url }));
  await fs.writeFile(path.join(scriptDir, 'artifact.mjs'), `console.log(${JSON.stringify(JSON.stringify({ url }))});`);
  const bridge = await createBridge(temp);
  t.after(async () => { bridge.close(); await fs.rm(temp, { recursive: true, force: true }); });
  const reply = await bridge.call('open_artifact', { path: temp, kind: 'whiteboard' });
  assert.equal(reply.isError, true);
  assert.equal(decode(reply).code, 'OPEN_FAILED');
});

test('stop uses the verified host root even if another environment replaces the shared state', async t => {
  const temp = await temporary(t);
  const scriptDir = path.join(temp, 'skills/claude-whiteboard/scripts');
  await fs.mkdir(scriptDir, { recursive: true });
  const script = path.join(scriptDir, 'artifact.mjs');
  const marker = path.join(temp, 'cli-stop-was-called');
  await fs.writeFile(script, `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected');`);
  const stat = await fs.stat(script);
  const identity = { hub: 1, kind: 'whiteboard', pid: process.pid, build: `${script}:${stat.mtimeMs}:${stat.size}` };
  const stateFile = path.join(temp, '.artifact-server.json');
  let unmounted;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') {
      await fs.writeFile(stateFile, JSON.stringify({ root: '/a/VM/path', pid: process.pid, kind: 'whiteboard', url: 'http://127.0.0.1:1/whiteboard/other/' }));
      res.end(JSON.stringify(identity));
    } else {
      let text = '';
      for await (const chunk of req) text += chunk;
      unmounted = JSON.parse(text);
      res.end(JSON.stringify({ ...identity, removed: true, remaining: 0 }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/whiteboard/test/`;
  await fs.writeFile(stateFile, JSON.stringify({ root: temp, kind: 'whiteboard', pid: process.pid, url }));
  const bridge = await createBridge(temp);
  t.after(async () => {
    bridge.close();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await fs.rm(temp, { recursive: true, force: true });
  });
  const reply = await bridge.call('stop_artifact', { path: temp, kind: 'whiteboard' });
  assert.ok(!reply.isError, JSON.stringify(reply));
  assert.equal(decode(reply).stopped, true);
  assert.deepEqual(unmounted, { action: 'unmount', root: temp });
  assert.equal(await fs.stat(marker).catch(() => null), null);
  assert.equal(JSON.parse(await fs.readFile(stateFile, 'utf8')).root, '/a/VM/path');
});
