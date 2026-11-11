// Assemble ZIPs directly from canonical files; only ignored dist/ archives are written.
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync } from 'fflate';
import { plugins, repoRoot } from '../src/catalog.mjs';

const selected = process.argv.slice(2);
if (selected.some(name => !plugins.some(([id]) => id === name))) throw new Error('Pass plugin names such as baoyu-slides, or no names for all plugins.');
const { version } = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
const out = path.join(repoRoot, 'claude-plugins/dist');
await fs.mkdir(out, { recursive: true });
const options = { mtime: new Date('2026-11-11T00:00:00Z') };
async function files(source, prefix, entries) {
  for (const entry of (await fs.readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(source, entry.name), name = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await files(file, name, entries);
    else if (entry.isFile()) entries[name] = [new Uint8Array(await fs.readFile(file)), options];
    else throw new Error(`Unsupported plugin entry (no external symlinks): ${file}`);
  }
}
for (const [name, title, skills] of plugins) {
  if (selected.length && !selected.includes(name)) continue;
  const original = JSON.parse(await fs.readFile(path.join(repoRoot, 'chatgpt-plugins', name, 'plugin.json'), 'utf8'));
  const editor = skills[0] !== 'dataviz';
  const manifest = {
    name, version,
    description: editor ? `Baoyu ${title}: upstream skills and Cowork host-editor guidance. Requires the separately installed baoyu-editor MCP.` : original.description,
    author: original.author, license: original.license,
  };
  const entries = { '.claude-plugin/plugin.json': [new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n'), options] };
  for (const skill of skills) await files(path.join(repoRoot, 'skills', skill), `skills/${skill}`, entries);
  if (editor) await files(path.join(repoRoot, 'claude-plugins/integration-skills/cowork-editor'), 'skills/cowork-editor', entries);
  await files(path.join(repoRoot, 'chatgpt-plugins', name, 'assets'), 'assets', entries);
  for (const file of ['LICENSE', 'NOTICE.md']) entries[file] = [new Uint8Array(await fs.readFile(path.join(repoRoot, file))), options];
  entries['README.md'] = [new TextEncoder().encode(`# Baoyu ${title} for Claude\n\n${manifest.description}\n\n${editor ? 'Desktop starts the shared MCP; open_artifact starts/reuses the host editor automatically. Author and implement saved comments through the upstream skill in the shared workspace. No server needs to be started manually.\n\n' : ''}See claude-plugins/README.md in the checkout for setup and limitations. Terms: LICENSE and NOTICE.md.\n`), options];
  const archive = path.join(out, `${name}.zip`);
  await fs.writeFile(archive, zipSync(entries, { level: 6 }));
  console.log(archive);
}
