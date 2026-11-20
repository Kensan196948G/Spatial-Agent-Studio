#!/usr/bin/env node
/**
 * Lightweight secret scan for the MVP repository.
 * Scans tracked source/documentation paths for common credential patterns.
 * This is a guardrail, not a replacement for gitleaks/trivy.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TARGETS = ['src', 'scripts', 'db', 'deploy', 'docs', 'tests', 'e2e'];
const FILES = ['README.md', 'package.json', 'index.html', '.env.example'];
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'reference', 'playwright-report', 'test-results']);

const PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/g },
  { name: 'GitHub token', re: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { name: 'OpenAI-style key', re: /sk-[A-Za-z0-9]{20,}/g },
  { name: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/g },
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { name: 'JWT', re: /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = [];
for (const target of TARGETS) {
  try {
    const st = statSync(join(ROOT, target));
    if (st.isDirectory()) files.push(...walk(join(ROOT, target)));
    else files.push(join(ROOT, target));
  } catch {
    // optional path
  }
}
for (const f of FILES) {
  try {
    if (statSync(join(ROOT, f)).isFile()) files.push(join(ROOT, f));
  } catch {
    // optional
  }
}

const findings = [];
for (const file of files) {
  if (file.endsWith('.map') || file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.gif')) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file: relative(ROOT, file), line, name, sample: m[0].slice(0, 8) + '…' });
    }
  }
}

if (findings.length) {
  console.error(`[secret-scan] ${findings.length} potential secret(s) found:`);
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.name}  (${f.sample})`);
  process.exit(1);
}

console.log(`[secret-scan] OK — scanned ${files.length} files, no credential patterns found.`);
