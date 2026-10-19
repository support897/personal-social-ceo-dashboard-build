// Web arrangement (Vercel build only — Capacitor keeps using plain
// `npm run build`, where dist/index.html IS the app).
//
// The public home page (promo.html) becomes the site's front door at /,
// and the app itself moves to /app/ untouched: same bundle, same assets
// (all paths are absolute), same service worker. /privacy.html stays a
// real static file at its exact URL.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

mkdirSync('dist/app', { recursive: true });
copyFileSync('dist/index.html', 'dist/app/index.html');
copyFileSync('promo.html', 'dist/index.html');

// The installed-web-app door should open the app, not the front door.
const manifestPath = 'dist/manifest.webmanifest';
if (existsSync(manifestPath)) {
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  m.start_url = '/app/';
  writeFileSync(manifestPath, JSON.stringify(m, null, 2));
}
console.log('arranged: / = home page, /app/ = the app');
