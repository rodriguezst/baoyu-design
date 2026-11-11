import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { plugins, repoRoot } from '../src/catalog.mjs';

test('marketplace selects canonical skills and has no per-plugin MCP or escaping paths', async () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'claude-plugins/scripts/build.mjs'), '--check']);
  const market = JSON.parse(await fs.readFile(path.join(repoRoot, '.claude-plugin/marketplace.json'), 'utf8'));
  assert.equal(market.plugins.length, plugins.length);
  assert.equal(await fs.stat(path.join(repoRoot, '.mcp.json')).catch(() => null), null, 'Root-source plugins must not implicitly load a root MCP');
  for (const entry of market.plugins) {
    assert.equal(entry.source, './');
    assert.equal(entry.strict, false);
    assert.equal(entry.mcpServers, undefined);
    for (const skill of entry.skills) {
      assert.ok(skill.startsWith('./') && !skill.split('/').includes('..'));
      await fs.access(path.join(repoRoot, skill, 'SKILL.md'));
    }
    const expected = plugins.find(([name]) => name === entry.name)[2];
    assert.deepEqual(entry.skills.filter(p => p.startsWith('./skills/')), expected.map(s => `./skills/${s}`));
  }
});

test('all ZIPs preserve canonical skill bytes, supporting files and notices without bundling MCP', async () => {
  execFileSync(process.execPath, [path.join(repoRoot, 'claude-plugins/scripts/pack.mjs')]);
  for (const [name, , skills] of plugins) {
    const zipped = unzipSync(await fs.readFile(path.join(repoRoot, 'claude-plugins/dist', `${name}.zip`)));
    const manifest = JSON.parse(Buffer.from(zipped['.claude-plugin/plugin.json']).toString());
    assert.equal(manifest.name, name);
    assert.equal(manifest.mcpServers, undefined);
    assert.ok(zipped['LICENSE'] && zipped['NOTICE.md']);
    assert.equal(Boolean(zipped['skills/cowork-editor/SKILL.md']), name !== 'baoyu-dataviz');
    assert.ok(!zipped['.mcp.json']);
    for (const file of Object.keys(zipped)) {
      assert.ok(!file.startsWith('mcp/') && !file.includes('node_modules/') && !file.split('/').includes('..'));
      if (skills.some(skill => file.startsWith(`skills/${skill}/`))) {
        assert.ok(Buffer.from(zipped[file]).equals(await fs.readFile(path.join(repoRoot, file))), `${name}: changed upstream file ${file}`);
      }
    }
    for (const skill of skills) {
      assert.ok(zipped[`skills/${skill}/SKILL.md`]);
      if (skill.startsWith('claude-')) assert.ok(zipped[`skills/${skill}/scripts/artifact.mjs`]);
    }
  }
  // Packaging writes only dist/, so source folders cannot accumulate copied skills.
  assert.equal(await fs.stat(path.join(repoRoot, 'claude-plugins/baoyu-slides')).catch(() => null), null);
});
