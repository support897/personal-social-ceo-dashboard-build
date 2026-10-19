// PRODUCT build stubs for ./room-pages.js — vite.config.js aliases
// ./room-pages.js to this file under PRODUCT_BUILD=1. The room's
// worker pages do not exist in the product: every export is inert,
// and this file carries none of the room's strings (no router labels,
// no room page copy).
export function workerSubLinksHtml() { return ""; }
export function renderWorkerPage() {
  const host = document.querySelector("#content");
  if (host) host.innerHTML = `<section class="panel"><p class="empty">That page is not here.</p></section>`;
}
export function workerGroupsHtml() { return ""; }
export function refreshWorkerGroups() {}
export function sideRoomsHtml() { return ""; }
export function supervisorPanelHtml() { return ""; }
export function homeRoomsPanelHtml() { return ""; }
export function workerCard() { return ""; }
export function touchUpWorkerScans() {}
export async function fetchRoomHome() {
  return { supervisor: null, socials: [], rename: null, workers: [] };
}
