// GitHub Pages arrangement — runs AFTER the normal web arrangement
// (arrange-web.mjs / arrange-ceo.mjs), always on a COPY. The Vercel
// trees (dist/, dist-ceo/) are never modified by this script.
//
// GitHub Pages project sites live under a path prefix
// (support897.github.io/<repo>/), where root-absolute references
// (/assets/…, /icons/…, /sw.js) escape the prefix and 404. This pass
// copies the arranged tree and rewrites the whitelisted static-asset
// literals to relative paths that resolve inside the prefix:
//
//   product (dist-pages/):   promo page at the site root, the app
//     page one level deep at app/ — so the app page, its JS/CSS and
//     its service worker use ../ (the manifest is re-based too).
//   ceo (dist-pages-ceo/):   the CEO page IS the site root — its
//     references become ./ .
//
// Only whitelisted static prefixes are touched (assets, icons,
// fonts, sw.js, manifest, favicon, plus /app/ inside the product
// service worker). API paths inside the bundles (/v1/…, the
// Supabase realtime "/api/broadcast" suffix, …) are NOT same-origin
// file references and are deliberately left alone.
import {
  cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { extname, join } from 'node:path';

const ceo = process.argv.includes('--ceo');
const SRC = ceo ? 'dist-ceo' : 'dist';
const DST = ceo ? 'dist-pages-ceo' : 'dist-pages';

if (!existsSync(SRC)) {
  throw new Error(`arrange-pages: ${SRC}/ missing — run the normal build first`);
}
if (!ceo && !existsSync(join(SRC, 'app', 'index.html'))) {
  throw new Error('arrange-pages: dist/app/index.html missing — run arrange-web.mjs first (build:pages does)');
}

rmSync(DST, { recursive: true, force: true });
cpSync(SRC, DST, { recursive: true });

const counts = new Map();
const bump = (k) => counts.set(k, (counts.get(k) || 0) + 1);

function rewriteFile(path, rules) {
  let text = readFileSync(path, 'utf8');
  const before = text;
  for (const [name, re, rep] of rules) {
    text = text.replace(re, (...args) => { bump(name); return rep(...args); });
  }
  if (text !== before) writeFileSync(path, text);
}

function walk(dir, exts, fn) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, fn);
    else if (exts.includes(extname(p))) fn(p);
  }
}

// HTML src=/href= attributes, root-absolute → the given prefix.
const attrRules = (prefix) => [
  ['attr', /((?:src|href)=")\//g, (m, g1) => `${g1}${prefix}`],
];
// Quoted JS string literals for the whitelisted static prefixes.
const jsRules = (prefix) => [
  ['js-static', /(["'`])\/(assets|icons|fonts)\//g, (m, q, dir) => `${q}${prefix}${dir}/`],
  ['js-sw', /(["'`])\/sw\.js/g, (m, q) => `${q}${prefix}sw.js`],
  ['js-manifest', /(["'`])\/manifest\.webmanifest/g, (m, q) => `${q}${prefix}manifest.webmanifest`],
  ['js-favicon', /(["'`])\/favicon/g, (m, q) => `${q}${prefix}favicon`],
  // Vite's preload helper builds chunk URLs as "/" + dep (the build
  // base, baked in as `return"/"+t` — exactly one hit per entry
  // bundle). Re-base it so lazy chunks resolve inside the prefix.
  ['js-vite-base', /return"\/"\+/g, () => `return"${prefix}"+`],
];
// CSS url(...) references (quoted or bare).
const cssRules = (prefix) => [
  ['css-url', /url\((["']?)\//g, (m, q) => `url(${q}${prefix}`],
];

// EVERY .html file in the tree gets the attribute + CSS url()
// rewrites, with the prefix set by the file's depth below the
// site root (root files "./", one level deep "../"). Depth-based
// on purpose: pages the pass does not name — privacy.html, whose
// inline @font-face escaped the prefix (QA F1) — are covered
// exactly like the promo / app / CEO pages.
function rewriteHtmlTree() {
  const visit = (dir, depth) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) visit(p, depth + 1);
      else if (extname(p) === '.html') {
        const prefix = depth === 0 ? './' : '../'.repeat(depth);
        rewriteFile(p, [...attrRules(prefix), ...cssRules(prefix)]);
      }
    }
  };
  visit(DST, 0);
}

if (ceo) {
  // CEO page sits at the site root: everything re-bases to ./
  rewriteHtmlTree();
  walk(join(DST, 'assets'), ['.js'], (p) => rewriteFile(p, jsRules('./')));
  if (existsSync(join(DST, 'assets'))) {
    walk(join(DST, 'assets'), ['.css'], (p) => rewriteFile(p, cssRules('./')));
  }
} else {
  // Promo + privacy pages at the site root (./), app page one
  // level deep (../) — every .html file, via the depth walk.
  rewriteHtmlTree();
  // Bundles + styles serve the app page only.
  walk(join(DST, 'assets'), ['.js'], (p) => rewriteFile(p, jsRules('../')));
  walk(join(DST, 'assets'), ['.css'], (p) => rewriteFile(p, cssRules('../')));
  // Service worker sits at the site root but speaks for the app:
  // its icon + app URLs re-base to ./
  rewriteFile(join(DST, 'sw.js'), [
    ['sw-icon', /(["'])\/icons\//g, (m, q) => `${q}./icons/`],
    ['sw-app', /(["'])\/app\//g, (m, q) => `${q}./app/`],
  ]);
  // Manifest: re-base onto the prefix. start_url/scope become
  // relative; icon srcs drop their leading ../ or / so they resolve
  // from the manifest's own URL (the site root).
  const manifestPath = join(DST, 'manifest.webmanifest');
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    m.start_url = './app/';
    m.scope = './';
    if (Array.isArray(m.icons)) {
      for (const icon of m.icons) {
        if (typeof icon.src === 'string') icon.src = icon.src.replace(/^(\.\.\/|\/)+/, '');
      }
    }
    writeFileSync(manifestPath, JSON.stringify(m, null, 2));
    bump('manifest');
  }
}

const summary = [...counts.entries()].map(([k, n]) => `${k}×${n}`).join(' ');
console.log(`arrange-pages: ${SRC}/ -> ${DST}/ (${ceo ? 'ceo' : 'product'}) rewrites: ${summary || 'none'}`);
