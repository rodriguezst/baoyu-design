import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editors, repoRoot } from './catalog.mjs';

const MAX_OUTPUT = 64 * 1024;
const failure = (code, message, details = {}) => Object.assign(new Error(message), { code, details });
const result = (value, isError = false) => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  structuredContent: value,
  ...(isError ? { isError: true } : {}),
});
const inputSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Absolute HOST artifact folder, not its project/ or db/ subfolder and not the Cowork VM mount path. Use the Desktop-provided host path of the shared folder.' },
    kind: { type: 'string', enum: Object.keys(editors) },
  },
  required: ['path', 'kind'],
  additionalProperties: false,
};

function loopbackURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('Expected an HTTP loopback editor URL.');
  }
  return url;
}

export async function createBridge(repository = repoRoot, { timeoutMs = 30_000 } = {}) {
  if (!path.isAbsolute(repository)) throw new Error('--repo must be an absolute host repository path.');
  const repo = await fs.realpath(repository);
  if (!(await fs.stat(path.join(repo, 'skills'))).isDirectory()) throw new Error('The repository must contain skills/.');
  const integration = new URL('../package.json', import.meta.url);
  const { version } = JSON.parse(await fs.readFile(integration, 'utf8'));
  const instructions = await fs.readFile(new URL('../integration-skills/cowork-editor/SKILL.md', import.meta.url), 'utf8');
  const pending = new Map();
  const active = new Set();
  let closed = false;

  async function resolveArtifact(args) {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !['path', 'kind'].includes(k)) || !Object.hasOwn(editors, args.kind)) {
      throw failure('INVALID_ARGUMENT', 'Supply only path and a supported artifact kind.');
    }
    if (typeof args.path !== 'string' || args.path.includes('\0') || !path.isAbsolute(args.path)) {
      throw failure('INVALID_PATH', 'path must be the absolute HOST artifact folder, not a relative or VM path.');
    }
    let root;
    try {
      root = await fs.realpath(args.path);
      if (!(await fs.stat(root)).isDirectory()) throw new Error('Not a directory.');
    } catch (error) {
      throw failure('ARTIFACT_NOT_FOUND', `No artifact directory at ${args.path}. Use its real host path; create the artifact in the shared workspace first.`, { reason: error.message });
    }
    const script = path.join(repo, 'skills', editors[args.kind], 'scripts/artifact.mjs');
    // File-backed skills keep the HTTP server separately; the other skills bundle it in the CLI.
    const serverScript = ['slides', 'design', 'design-system'].includes(args.kind) ? path.join(path.dirname(script), 'server.mjs') : script;
    try {
      await fs.access(script);
      const real = await fs.realpath(serverScript);
      const stat = await fs.stat(real);
      return { root, kind: args.kind, script, runtime: real, build: `${real}:${stat.mtimeMs}:${stat.size}` };
    } catch (error) {
      throw failure('RUNTIME_NOT_FOUND', `The configured repository is missing the ${args.kind} runtime.`, { reason: error.message });
    }
  }

  async function jsonAt(url, signal, init = {}) {
    const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]) });
    if (!response.ok) throw new Error(`Editor answered HTTP ${response.status}.`);
    const body = await response.text();
    if (Buffer.byteLength(body) > MAX_OUTPUT) throw new Error('Editor response exceeded 64 KiB.');
    return JSON.parse(body);
  }

  // Shared metadata can have VM PIDs/paths. Verify a real host hub before unmounting there.
  // Never use the CLI stop fallback, which can signal a PID after rereading shared metadata.
  async function verifyState(artifact, signal, allowPreviousBuild = false) {
    let state;
    try { state = JSON.parse(await fs.readFile(path.join(artifact.root, '.artifact-server.json'), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw failure('SERVER_STATE_CONFLICT', 'Cannot read the recorded editor state.', { reason: error.message });
    }
    try {
      const url = loopbackURL(state.url);
      if (state.root !== artifact.root || state.kind !== artifact.kind || !Number.isSafeInteger(state.pid) || state.pid <= 0 || !url.pathname.startsWith(`/${artifact.kind}/`)) {
        throw new Error('The state does not identify this host artifact.');
      }
      const hub = await jsonAt(new URL('/__hub', url), signal);
      const trustedBuild = hub.build === artifact.build || (allowPreviousBuild && typeof hub.build === 'string' && hub.build.startsWith(`${artifact.runtime}:`));
      if (hub.hub !== 1 || hub.kind !== artifact.kind || hub.pid !== state.pid || !trustedBuild) {
        throw new Error('The host server identity/runtime differs from the shared state. After updating this checkout, use stop_artifact to stop a verified older build before reopening.');
      }
      return { state, url };
    } catch (error) {
      throw failure('SERVER_STATE_CONFLICT', 'Cannot verify this state as the configured host editor. It may belong to the VM, a stopped server, or another runtime. No PID was signalled.', { reason: error.message });
    }
  }

  async function runOpen(artifact, signal) {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [artifact.script, 'open', artifact.root], {
        cwd: artifact.root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal,
      });
      active.add(child);
      let stdout = '', stderr = '', bytes = 0;
      const collect = stream => chunk => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > MAX_OUTPUT) { child.kill(); return; }
        if (stream === 'out') stdout += chunk; else stderr += chunk;
      };
      child.stdout.setEncoding('utf8').on('data', collect('out'));
      child.stderr.setEncoding('utf8').on('data', collect('err'));
      child.once('error', reject);
      child.once('close', code => {
        active.delete(child);
        if (bytes > MAX_OUTPUT) return reject(failure('OUTPUT_LIMIT', 'Launcher output exceeded 64 KiB.'));
        let output;
        try { output = JSON.parse(stdout.trim() || stderr.trim()); } catch {}
        if (code !== 0 || !output || typeof output !== 'object' || Array.isArray(output)) {
          const upstreamCode = typeof output?.error === 'string' ? output.error : '';
          const invalid = upstreamCode === 'NOT_FOUND' || upstreamCode.startsWith('NOT_A_');
          return reject(failure(invalid ? 'INVALID_ARTIFACT' : 'OPEN_FAILED', output?.message || stderr.trim() || 'Upstream launcher returned no valid JSON result.', { exitCode: code, ...(output ? { upstream: output } : {}) }));
        }
        resolve(output);
      });
    });
  }

  async function lifecycle(name, artifact, signal) {
    if (closed) throw failure('SERVER_CLOSED', 'The editor MCP is closing.');
    const { root, kind } = artifact;
    if (name === 'stop_artifact') {
      const verified = await verifyState(artifact, signal, true);
      if (!verified) return { path: root, kind, stopped: false };
      // Use the same upstream unmount operation as its CLI, without rereading the shared
      // PID/root or its kill fallback if a VM/server changes the state between requests.
      let output;
      try {
        output = await jsonAt(new URL('/__hub', verified.url), signal, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unmount', root }),
        });
      } catch (error) { throw failure('STOP_FAILED', 'The verified host editor could not be unmounted.', { reason: error.message }); }
      if (output.hub !== 1 || output.kind !== kind || output.pid !== verified.state.pid || typeof output.removed !== 'boolean') throw failure('STOP_FAILED', 'The upstream hub returned no verified unmount result.');
      return { path: root, kind, stopped: output.removed };
    }
    const output = await runOpen(artifact, signal);
    let url;
    try {
      url = loopbackURL(output.url);
      const verified = await verifyState(artifact, signal);
      if (!verified || verified.url.href !== url.href) throw new Error('The launcher URL differs from the verified host state.');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(2_000)]) });
      if (!response.ok) throw new Error(`Editor answered HTTP ${response.status}.`);
      await response.body?.cancel();
    } catch (error) {
      throw failure('OPEN_FAILED', 'The editor did not return a verified, reachable host URL.', { reason: error.details?.reason || error.message });
    }
    return { path: root, kind, url: url.href, reused: output.reused === true };
  }

  async function call(name, args, signal) {
    try {
      if (!['open_artifact', 'stop_artifact'].includes(name)) throw failure('INVALID_ARGUMENT', `Unknown tool: ${name}`);
      const artifact = await resolveArtifact(args);
      // Serializes open/stop even if callers use different kinds or symlink aliases for one folder.
      const before = pending.get(artifact.root) ?? Promise.resolve();
      const work = before.catch(() => {}).then(async () => {
        const deadline = AbortSignal.timeout(timeoutMs);
        const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
        try { return await lifecycle(name, artifact, combined); }
        catch (error) {
          if (deadline.aborted) throw failure('STARTUP_TIMEOUT', 'The host editor operation timed out. Reopen to recover a detached server that may have started.');
          if (signal?.aborted) throw failure('CANCELLED', 'The editor operation was cancelled; an already detached editor may remain open.');
          throw error;
        }
      });
      pending.set(artifact.root, work);
      try { return result(await work); }
      finally { if (pending.get(artifact.root) === work) pending.delete(artifact.root); }
    } catch (error) {
      return result({ code: error.code || 'INTERNAL_ERROR', message: error.message, ...error.details }, true);
    }
  }

  const tools = [
    { name: 'open_artifact', description: 'Start/reuse the upstream editor on the desktop HOST and return its browser URL. Claude authors and validates through the upstream skill in the shared workspace; ordinary comments/replies use shared files. Supply the Desktop-provided absolute HOST artifact path, never the VM mount path. No manually started server is required.', inputSchema },
    { name: 'stop_artifact', description: 'Stop serving one artifact on the desktop HOST, preserving its files and other artifacts. Supply its absolute HOST path and kind. Refuses unverifiable VM or stale process metadata.', inputSchema },
  ];
  const server = new Server({ name: 'baoyu-editor', version }, { capabilities: { tools: {} }, instructions: instructions.replace(/^---\n[\s\S]*?\n---\n/, '').trim() });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, (request, extra) => call(request.params.name, request.params.arguments, extra.signal));
  const close = () => { closed = true; for (const child of active) child.kill(); };
  server.onclose = close;
  return { server, call, close, repo };
}
