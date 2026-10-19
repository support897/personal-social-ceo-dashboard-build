// Clone features — DEFAULT (every production build): OFF.
// vite.config.js aliases this module to ./clone-features-clone.js
// ONLY under CLONE_BUILD=1 (Ilse's private Ruefly clone). With the
// flag off, every export below is inert and no clone surface, route
// or string ships in a production bundle.
export const CLONE_FEATURES = false;
export function cloneNavHtml() { return ""; }
export function renderCloneBrandsPage() {
  const host = document.querySelector("#content");
  if (host) host.innerHTML = `<section class="panel"><p class="empty">That page is not here.</p></section>`;
}
