// Marketplace entries select the canonical skills; no generated skill trees are committed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { plugins, repoRoot } from '../src/catalog.mjs';

const { version } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const entries = [];
for (const [name, title, skills] of plugins) {
  const original = JSON.parse(await fs.readFile(path.join(repoRoot, 'chatgpt-plugins', name, 'plugin.json'), 'utf8'));
  const editor = skills[0] !== 'dataviz';
  entries.push({
    name, source: './', strict: false, version,
    description: editor ? `Baoyu ${title}: upstream skills for editable local artifacts. Install the shared baoyu-editor host MCP separately for Cowork.` : original.description,
    author: original.author, license: original.license,
    skills: [...skills.map(skill => `./skills/${skill}`), ...(editor ? ['./claude-plugins/integration-skills/cowork-editor'] : [])],
  });
}
const marketplace = {
  name: 'baoyu-design', owner: { name: 'Baoyu Design contributors' },
  metadata: { description: 'Upstream design skills with a separately installed shared host editor MCP.', version },
  plugins: entries,
};
const target = path.join(repoRoot, '.claude-plugin/marketplace.json');
const text = JSON.stringify(marketplace, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (await fs.readFile(target, 'utf8') !== text) throw new Error('Claude marketplace is stale; run npm run build --prefix claude-plugins.');
} else {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, text);
}
console.log(`${process.argv.includes('--check') ? 'Checked' : 'Built'} Claude marketplace (${entries.length} skill-only plugins).`);
