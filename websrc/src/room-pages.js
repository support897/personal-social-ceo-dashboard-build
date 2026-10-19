// ------------------------------------------------------- room pages
// The legacy ROOM machinery of Ruefly: the worker pages (overview /
// research / experiments / week) with their status, deliverables,
// cases, socials and backup blocks. This module is ROOM BUILD ONLY.
// The product build never ships it: vite.config.js aliases
// ./room-pages.js to ./room-pages-product.js under PRODUCT_BUILD=1,
// where every export is an inert stub — so no worker router and no
// room page copy can appear in the public bundle's bytes
// (Security OA-6, 15 Oct). The functions here read the app state
// through live bindings imported from ./main.js and are only ever
// called at runtime.
import "./room.css";
import { SOCIALS_PANEL_LABEL } from "./room-strings.js";
import { SISTER_APPS } from "./sister-apps.js";
import { $, esc, fmtDate, dotClass, ICONS, socialRow, callAdmin, todayStr, DATA, accountMode, WORKER_ICONS, WORKER_ICON_FALLBACK } from "./main.js";

// The worker page's own tone map (the home socials rows keep theirs
// in ./main.js — same values, separate surface).
const SOCIAL_TONE = { live: "dot-live", part: "dot-part", none: "dot-wait" };

const SUBPAGES = [
  ["overview", "Overview"],
  ["research", "Research"],
  ["experiments", "Experiments"],
  ["week", "This Week"],
];
// ------------------------------------------------- shell furniture
// The sidebar worker groups, the side-foot sister links and the home
// room panels live here (room build only) so their labels and the
// #workerGroups identifier never enter the product bundle's bytes —
// main.js interpolates these fragments behind its mode gates, and
// the product stubs return "" (Security OA-6, 15 Oct).
function workerGroupsInnerHtml(r) {
  return DATA.workers.map((w) => `
        <div class="side-group">
          <a class="side-link ${r.slug === w.slug ? "on" : ""}" data-slug="${w.slug}" href="#/w/${w.slug}" title="${esc(w.name)}"><span class="side-ico accent-${w.accent}">${WORKER_ICONS[w.slug] || WORKER_ICON_FALLBACK}</span><span class="side-txt">${esc(w.name)}</span><span class="dot ${dotClass(w.status?.state)}"></span></a>
          ${workerSubLinksHtml(w, r)}
        </div>`).join("");
}
export function workerGroupsHtml(r) {
  return `<span class="side-group-title">Rooms</span>
        <span id="workerGroups">${workerGroupsInnerHtml(r)}</span>`;
}
export function refreshWorkerGroups(r) {
  const wg = document.querySelector("#workerGroups");
  if (wg) wg.innerHTML = workerGroupsInnerHtml(r);
}
export function sideRoomsHtml() {
  return `
        <p class="side-foot-title">Other rooms</p>
        ${SISTER_APPS.map((a) => a.url
          ? `<a class="side-ext" href="${a.url}" target="_blank" rel="noopener" title="${esc(a.name)}"><span class="ext-ico">${ICONS.ext}</span><span class="side-txt">${esc(a.name)}</span></a>`
          : `<span class="side-ext is-off" title="${esc(a.name)} · soon"><span class="ext-ico">${ICONS.ext}</span><span class="side-txt">${esc(a.name)} · soon</span></span>`).join("")}`;
}
export function supervisorPanelHtml() {
  const sup = DATA.supervisor || {};
  return `
    <section class="panel supervisor-panel">
      <div class="panel-head"><h3>Quality Supervisor</h3><span class="pill">${esc(sup.updated ? fmtDate(sup.updated) : "")}</span></div>
      <p>${esc(sup.line || "No supervisor line recorded yet.")}</p>
    </section>`;
}
export function homeRoomsPanelHtml() {
  return `
    <section class="panel">
      <div class="panel-head"><h3>Other rooms</h3></div>
      <div class="sister-row">
        ${SISTER_APPS.map((a) => a.url
          ? `<a class="sister-card" href="${a.url}" target="_blank" rel="noopener"><b>${esc(a.name)}</b><small>${esc(a.note)} ↗</small></a>`
          : `<div class="sister-card is-pending"><b>${esc(a.name)}</b><small>${esc(a.note)}</small></div>`).join("")}
      </div>
    </section>`;
}

export function workerSubLinksHtml(w, r) {
  return r.slug === w.slug ? SUBPAGES.map(([key, label]) => `<a class="side-sub ${r.sub === key ? "on" : ""}" data-slug="${w.slug}" data-sub="${key}" href="#/w/${w.slug}/${key}"><span class="sub-ico">${ICONS[key] || ""}</span><span class="side-txt">${label}</span></a>`).join("") : "";
}

function statusBlock(w) {
  const st = w.status || {};
  return `
  <section class="panel accent-left-${w.accent}">
    <div class="panel-head"><h3>Status</h3><span class="pill"><span class="dot ${dotClass(st.state)}"></span> ${esc(st.state || "")}</span></div>
    <p class="latest-line">${esc(st.latest || "Nothing logged yet.")}</p>
    <dl class="kv">
      <dt>Scan</dt><dd>${st.scan_date ? `${st.scan_done_today ? "Done" : "Last done"} ${esc(fmtDate(st.scan_date))}` : "No scan logged yet"}<br /><small>${esc(w.scan_label || "")}</small></dd>
      <dt>Finding</dt><dd>${st.finding ? esc(st.finding) : "No finding yet."}</dd>
    </dl>
    ${st.detail ? `<p class="detail">${esc(st.detail)}</p>` : ""}
  </section>`;
}

function deliverablesBlock(w) {
  const items = w.deliverables || [];
  return `
  <section class="panel">
    <div class="panel-head"><h3>Latest deliverables</h3></div>
    ${items.length ? items.map((d) => `
      <div class="x-item">
        <button class="x-head" data-expand aria-expanded="false">
          <b>${esc(d.title)}</b>
          <span class="x-meta">${esc(fmtDate(d.delivered_on || d.date))}<span class="x-chev">▾</span></span>
        </button>
        <div class="x-body" hidden>
          <p>${esc(d.detail || "")}</p>
          ${d.verdict ? `<p class="verdict">Gate: ${esc(d.verdict)}</p>` : ""}
        </div>
      </div>`).join("") : `<p class="empty">Nothing delivered yet.</p>`}
  </section>`;
}

function casesBlock(w) {
  if (!w.cases) return "";
  return `
  <section class="panel">
    <div class="panel-head"><h3>The cases</h3><span class="pill">aussie-scammers.vercel.app</span></div>
    ${w.cases.map((c) => `
      <div class="x-item">
        <button class="x-head" data-expand aria-expanded="false">
          <b>Case ${c.n}: ${esc(c.who)}</b>
          <span class="x-meta"><span class="case-state">${esc(c.state)}</span><span class="x-chev">▾</span></span>
        </button>
        <div class="x-body" hidden><p class="case-note">${esc(c.note)}</p></div>
      </div>`).join("")}
    <p class="fine">Reported and alleged only.</p>
  </section>`;
}

function socialsBlock(w) {
  if (!w.socials?.length) return "";
  return `
  <section class="panel">
    <div class="panel-head"><h3>${accountMode === "user" ? "Socials" : SOCIALS_PANEL_LABEL}</h3></div>
    ${w.socials.map(socialRow).join("")}
  </section>`;
}

function repoBlock(w) {
  // Her backup surface is CEO furniture — it never renders in a
  // user's room (Detachment Law: her room is not the product).
  if (accountMode === "user") return "";
  return `
  <section class="panel">
    <div class="panel-head"><h3>Backup</h3></div>
    ${w.repo_url ? `<p><a href="${esc(w.repo_url)}" target="_blank" rel="noopener">${esc(w.repo_label || w.repo_url)} ↗</a></p>`
      : `<p class="empty">${esc(w.repo_label || "No repo yet.")}</p>`}
  </section>`;
}

function renderOverview(w) {
  $("#content").innerHTML = `
    <section class="hero slim"><h2>${esc(w.name)}</h2><p>${esc(w.blurb)}</p></section>
    ${statusBlock(w)}${socialsBlock(w)}${casesBlock(w)}${deliverablesBlock(w)}${repoBlock(w)}`;
}

function renderResearch(w) {
  const entries = w.research || [];
  $("#content").innerHTML = `
    <section class="hero slim"><h2>${esc(w.name)}: Research</h2></section>
    ${entries.length ? entries.map((e) => `
      <article class="panel research-entry">
        <div class="panel-head"><h3>${esc(fmtDate(e.entry_date || e.date))}</h3></div>
        <p>${esc(e.finding)}</p>
        ${e.sources ? `<p class="sources">Sources: ${esc(e.sources)}</p>` : ""}
      </article>`).join("")
    : `<section class="panel"><p class="empty">No research yet.</p></section>`}`;
}

function renderExperiments(w) {
  const items = w.experiments || [];
  $("#content").innerHTML = `
    <section class="hero slim"><h2>${esc(w.name)}: Experiments</h2></section>
    ${w.experiments_note ? `<section class="panel"><p>${esc(w.experiments_note)}</p></section>` : ""}
    ${items.length ? items.map((e) => `
      <article class="panel exp-card">
        <div class="x-item">
          <button class="x-head" data-expand aria-expanded="false">
            <b>${esc(e.title)}</b>
            <span class="x-meta"><span class="pill">Check ${esc(fmtDate(e.check_date))}</span><span>${e.verdict ? "Verdict in" : "Still running"}</span><span class="x-chev">▾</span></span>
          </button>
          <div class="x-body" hidden>
            <dl class="kv">
              <dt>Hypothesis</dt><dd>${esc(e.hypothesis || "")}</dd>
              <dt>Judged by</dt><dd>${esc(e.metric || "")}</dd>
              <dt>Verdict</dt><dd>${e.verdict ? esc(e.verdict) : "Running."}</dd>
            </dl>
          </div>
        </div>
      </article>`).join("")
    : `<section class="panel"><p class="empty">No experiments running.</p></section>`}`;
}

const ROLLUP_LABELS = ["Numbers", "One learning", "One experiment", "One ask"];
function renderWeek(w) {
  const r = w.rollup;
  $("#content").innerHTML = `
    <section class="hero slim"><h2>${esc(w.name)}: This Week</h2></section>
    ${r ? `<section class="panel">
      <div class="panel-head"><h3>Week of ${esc(fmtDate(r.week_of))}</h3></div>
      ${(r.lines || []).map((line, i) => `<div class="roll-line"><span class="roll-tag">${esc(ROLLUP_LABELS[i] || "Note")}</span><p>${esc(line)}</p></div>`).join("")}
      ${r.note ? `<p class="fine">${esc(r.note)}</p>` : ""}
    </section>` : `<section class="panel"><p class="empty">No roll-up yet.</p></section>`}`;
}

export function renderWorkerPage(w, r) {
  ({ overview: renderOverview, research: renderResearch, experiments: renderExperiments, week: renderWeek }[r.sub] || renderOverview)(w);
}

// ------------------------------------------------- room data + cards
// The room-state loader and the worker-card renderer live here
// (room build only) so the get_home fetch, the per-worker fetches,
// the scan strings and the card template never enter the product
// bundle's bytes (Security OA-6, 15 Oct). main.js's loadData keeps
// the preview/seed path and delegates the live room fetch to
// fetchRoomHome; the home strip calls workerCard only for a
// legacy room session (user + demo homes render brandCard).
export function touchUpWorkerScans(data) {
  for (const w of data.workers || []) {
    if (w.status) w.status.scan_done_today = w.status.scan_date === todayStr;
  }
}

export async function fetchRoomHome() {
  const home = await callAdmin({ action: "get_home" });
  const data = { supervisor: home.supervisor, socials: home.socials || [], rename: home.rename || null, workers: home.workers };
  await Promise.all(data.workers.map(async (w) => {
    const full = await callAdmin({ action: "get_worker", slug: w.slug });
    Object.assign(w, full.worker);
  }));
  return data;
}

export function workerCard(w, needsYou = false) {
  const st = w.status || {};
  return `
  <a class="worker-card accent-top-${w.accent}" href="#/w/${w.slug}">
    <div class="wc-head"><h3>${esc(w.name)}</h3><span class="dot ${dotClass(st.state)}" title="${esc(st.state || "")}"></span></div>
    <p class="wc-short">${esc(w.short)}</p>
    <p class="wc-latest">${esc(st.latest || "Nothing logged yet.")}</p>
    <p class="wc-scan">${st.scan_date ? `Last scan ${esc(fmtDate(st.scan_date))}${st.scan_done_today ? " · done today" : ""}` : esc(w.scan_label || "")}</p>
    ${needsYou ? `<span class="wc-flag">Needs you</span>` : ""}<span class="wc-open">Open →</span>
  </a>`;
}
