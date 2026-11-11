// Executable entry point, including when Desktop invokes a symlink/cache alias.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import { createBridge } from './server.mjs';

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or later is required.');
  const { values, positionals } = parseArgs({ options: { repo: { type: 'string' } }, allowPositionals: true });
  if (positionals.length) throw new Error('Usage: node src/stdio.mjs [--repo /absolute/path/to/baoyu-design]');
  const bridge = await createBridge(values.repo);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { bridge.close(); process.exit(0); });
  await bridge.server.connect(new StdioServerTransport());
} catch (error) {
  process.stderr.write(`Baoyu editor MCP startup failed: ${error.message}\n`);
  process.exitCode = 1;
}
