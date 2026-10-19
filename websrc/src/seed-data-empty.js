// PRODUCT BUILD stub for ./seed-data.js — vite.config.js aliases the
// real seed to this file under PRODUCT_BUILD=1, so the private room's
// payload (her socials, workers, rename record) never enters the
// public bundle. Same export shape as the real seed, all empty:
// the product app fills its data from the signed-in user's own
// Firestore space (user-store.js), never from a bundled seed.
export const SEED = {
  "generated_from": "",
  "supervisor": {
    "line": "",
    "name": "",
    "updated": ""
  },
  "socials": [],
  "rename": {
    "detail": "",
    "name_line": "",
    "state": "",
    "state_short": ""
  },
  "workers": []
};
