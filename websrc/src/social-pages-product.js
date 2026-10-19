// PRODUCT build stubs for ./social-pages.js — vite.config.js aliases
// ./social-pages.js to this file under PRODUCT_BUILD=1. The owner
// posting room does not exist in the product: every export is inert,
// and this file carries none of the room's strings (no brands data
// path, no connect routes, no posting copy).
export function postingNavHtml() { return ""; }
export function renderPostingPage() {
  const host = document.querySelector("#content");
  if (host) host.innerHTML = `<section class="panel"><p class="empty">That page is not here.</p></section>`;
}
