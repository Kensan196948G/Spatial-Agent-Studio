#!/usr/bin/env node
/**
 * Build the V2.1 static UI shell into dist/web.
 *
 * The V2.1 HTML is the visual source of truth; bridge.js adds real API data,
 * authentication, approvals and site selection. GitHub Pages/Cloudflare Pages
 * deploys dist/web.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = join(root, 'dist', 'web');
const src = join(root, 'web-v21');
const apiBase = (process.env.SAS_API_BASE ?? process.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(src, out, { recursive: true });

const indexPath = join(out, 'index.html');
const html = readFileSync(indexPath, 'utf8');
if (!html.includes('__SAS_API_BASE__')) {
  throw new Error('web-v21/index.html is missing the __SAS_API_BASE__ placeholder');
}
writeFileSync(indexPath, html.replaceAll('__SAS_API_BASE__', apiBase));

console.log(`[build:v21] dist/web ready (apiBase=${apiBase || '(same-origin)'})`);
