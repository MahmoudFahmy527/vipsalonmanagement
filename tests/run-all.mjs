#!/usr/bin/env node
/**
 * The one command a newcomer runs: `npm test`.
 * Tier 0 (static syntax) → Tier 1 (API suite, green ×2). One ✓/✗ per tier,
 * single verdict, non-zero exit on failure. (UNIFIED_TESTING_GUIDELINE §6.)
 * Tier 1.5/2 browser reachability checks are run interactively — see TEST_COVERAGE.md.
 */
import { execSync, spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (name.endsWith('.js') || name.endsWith('.mjs')) out.push(p);
  }
  return out;
}

let failed = false;

// ── Tier 0: static syntax on every JS/MJS file ──
process.stdout.write('Tier 0 (static syntax) … ');
try {
  for (const f of walk(process.cwd())) execSync(`node --check "${f}"`, { stdio: 'pipe' });
  console.log('✓');
} catch (e) {
  console.log('✗\n' + (e.stderr ? e.stderr.toString() : e.message));
  failed = true;
}

// ── Tier 1: API suite (spawns its own server, runs green ×2) ──
console.log('Tier 1 (API suite, green ×2):');
const api = spawnSync(process.execPath, ['tests/run-api.mjs'], { stdio: 'inherit' });
if (api.status !== 0) failed = true;

console.log('\n' + (failed ? '✗ TESTS FAILED' : '✓ ALL TESTS PASSED'));
process.exit(failed ? 1 : 0);
