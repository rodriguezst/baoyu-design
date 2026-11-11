// Print a launch configuration for review; never modify Desktop's settings.
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../src/catalog.mjs';

console.log(JSON.stringify({ mcpServers: { 'baoyu-editor': {
  command: process.execPath,
  args: [fileURLToPath(new URL('../src/stdio.mjs', import.meta.url)), '--repo', repoRoot],
} } }, null, 2));
