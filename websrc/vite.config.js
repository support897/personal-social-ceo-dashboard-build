import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Accounts phase gate (SR-F3): until Ilse's Firebase project exists, the
// build carries NO Firebase code at all — "app-firebase" resolves to the
// no-op stub. When the VITE_FIREBASE_* vars arrive, it resolves to the real
// shell (src/firebase.js) in the same build command.
const firebaseImpl = process.env.FIREBASE_OFF
  ? './src/firebase-off.js'
  : './src/firebase.js';

const alias = [
  { find: /^app-firebase$/, replacement: fileURLToPath(new URL(firebaseImpl, import.meta.url)) },
];

// BUILD VARIANTS (PRODUCT STRIP, 15 Oct): three flavours of the
// product entry, chosen by env flag —
//  - room (default `npm run build` / `build:room`): the private room
//    build for her own host; carries the seed + room literals.
//  - product (`PRODUCT_BUILD=1`, `build:product`, and `build:pages`):
//    the public build. Two aliases strip the room out of it:
//    ./seed-data.js resolves to the empty stub (no room payload),
//    and ./room-strings.js resolves to its generic equivalents
//    (no owner literals in any label or matcher).
//  - ceo (`CEO_BUILD=1`): the separate CEO host; unaffected — it
//    never imported the seed or the room strings.
const product = Boolean(process.env.PRODUCT_BUILD);
if (product) {
  alias.push({ find: /^\.\/seed-data\.js$/, replacement: fileURLToPath(new URL('./src/seed-data-empty.js', import.meta.url)) });
  alias.push({ find: /^\.\/room-strings\.js$/, replacement: fileURLToPath(new URL('./src/room-strings-product.js', import.meta.url)) });
  alias.push({ find: /^\.\/sister-apps\.js$/, replacement: fileURLToPath(new URL('./src/sister-apps-product.js', import.meta.url)) });
  // OA-6 (Security, 15 Oct): the room machinery (worker pages) lives
  // in ./room-pages.js; the product build swaps in the inert stubs,
  // so no worker router ships in the public bundle. The
  // ROOM_FEATURES flag folds the worker route itself out with it.
  alias.push({ find: /^\.\/room-pages\.js$/, replacement: fileURLToPath(new URL('./src/room-pages-product.js', import.meta.url)) });
  // OA-6: the owner posting room (brands data path + connect frame)
  // lives in ./social-pages.js; the product build swaps in inert stubs.
  alias.push({ find: /^\.\/social-pages\.js$/, replacement: fileURLToPath(new URL('./src/social-pages-product.js', import.meta.url)) });
  alias.push({ find: /^\.\/room-features\.js$/, replacement: fileURLToPath(new URL('./src/room-features-product.js', import.meta.url)) });
}

// CLONE BUILD (CLONE_BUILD=1, Ilse's private Ruefly clone only):
// swaps the inert clone-features module for the real one (the
// "Ilse's copy" marker + the Brands area). Every other build —
// room, product, ceo — resolves ./clone-features.js to the inert
// default, so nothing clone-shaped can ship anywhere else.
if (process.env.CLONE_BUILD) {
  alias.push({ find: /^\.\/clone-features\.js$/, replacement: fileURLToPath(new URL('./src/clone-features-clone.js', import.meta.url)) });
}

// SEPARATE HOSTING LAW (Ilse via HQ, 15 Oct): the product and the CEO
// dashboard live on DIFFERENT hosts, never the same host. So there are
// two builds, never one bundle with both:
//  - default `npm run build`        → dist/      the product ONLY
//    (index.html; the CEO entry is not an input, so no owner page,
//    no owner chunk and no "/owner" string can appear in it).
//  - `npm run build:ceo` (CEO_BUILD=1) → dist-ceo/  the CEO surface
//    ONLY: owner.html becomes the host's index.html at its root,
//    with the public dir disabled so no product asset rides along;
//    arrange-ceo.mjs then copies in ONLY the public files the owner
//    page itself references (its mark + fonts).
// Both pages share the same "app-firebase" alias, so the OFF build
// carries no Firebase code on either surface.
const ceo = Boolean(process.env.CEO_BUILD);

export default defineConfig({
  publicDir: ceo ? false : 'public',
  resolve: {
    alias,
  },
  build: {
    sourcemap: false,
    target: 'es2020',
    outDir: ceo ? 'dist-ceo' : 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: ceo
        ? { index: fileURLToPath(new URL('./owner.html', import.meta.url)) }
        : { main: fileURLToPath(new URL('./index.html', import.meta.url)) },
    }
  }
});
