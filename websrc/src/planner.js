// ------------------------------------------------------------ planner
// PLANNER — Build 1 of Ruefly's road to its single 100% build
// (the Free plan's own words in src/plans.js are the spec: a
// visual calendar, drafts and planned posts unlimited, captions
// and hashtag groups saved and reused, posting reminders so the
// user can post BY HAND on time — the planning, the states and
// the queue live here; the reminder wiring is slice B and lives
// in src/reminders.js, hooked from the saves below).
//
// Data (all under the caller's own users/{uid} space, read by
// loadUserSpace in src/user-store.js):
//   plannedPosts/{postId}  { brandId, platform, caption, hashtags,
//     scheduledFor (ISO datetime | null), state, order, createdAt,
//     updatedAt } — state is "draft" | "planned" | "posted".
//   captionLibrary/{id}    { name, caption, hashtags } — the saved
//     groups the composer reuses.
//   brands/{brandId}       the record a post keys to (the clone's
//     key of record): { name, channels: [], createdAt, updatedAt }
//     at this slice — Build 2 grows the same records, no migration.
//
// HONESTY FENCES: the verbs here are plan · draft · schedule (in
// the app) · remind · track · organise. Ruefly never posts,
// publishes or sends anything for anyone: a post becomes "posted"
// only by the user's own hand ("I posted it"). Platforms are
// PLANNING labels only — no connection or OAuth surface exists
// in this slice. Detachment law untouched: nothing here names,
// shows or suggests anyone else's accounts.
import { $, esc, DATA, accountMode } from "./main.js";
import { firebaseUser } from "app-firebase";
import { t, lang } from "./i18n.js";
import { syncPostReminder, cancelPostReminder, reconcileReminders, remindersAsked, showReminderAsk } from "./reminders.js";

export const PLATFORMS = ["Instagram", "Facebook", "TikTok", "YouTube", "Threads"];

const store = () => import("./user-store.js");
const nowIso = () => new Date().toISOString();
const TZ = "Australia/Brisbane"; // the app's home clock (topbar)

// ------------------------------------------------------------ styles
// The planner's own shapes, planted like the clone's — styles.css
// (and every other surface) stays untouched by this slice.
(function plantStyles() {
  if (document.getElementById("plannerStyles")) return;
  const el = document.createElement("style");
  el.id = "plannerStyles";
  el.textContent = `
.pp-week{display:flex;gap:6px;margin:4px 0 14px}
.pp-day{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:9px 2px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);position:relative}
.pp-day .pp-dow{font-size:11.5px;font-weight:700;color:var(--ink-soft);text-transform:uppercase;letter-spacing:.04em}
.pp-day b{font-size:16px}
.pp-day.on{border-color:var(--burgundy);background:var(--pink-soft)}
.pp-count{position:absolute;top:5px;right:6px;min-width:17px;height:17px;border-radius:999px;background:#FF5A48;color:var(--ink);font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 4px}
.pp-row{display:flex;align-items:center;gap:10px;padding:11px 4px;border-top:1px solid var(--line);cursor:pointer}
.pp-row:first-of-type{border-top:0}
.pp-move{display:flex;flex-direction:column;gap:3px}
.pp-move button{width:26px;height:22px;border-radius:7px;border:1px solid var(--line);background:var(--card);color:var(--ink-soft);font-size:12px;line-height:1;padding:0}
.pp-move button:disabled{opacity:.3;cursor:default}
.pp-main{flex:1;min-width:0}
.pp-main .pp-top{font-weight:700;font-size:15px}
.pp-main .pp-when{display:block;color:var(--ink-soft);font-size:13.5px;margin-top:1px}
.pp-main .pp-cap{display:block;color:var(--ink-soft);font-size:13.5px;margin-top:1px;white-space:normal}
.pp-over{color:#B3261E;font-weight:600}
.pp-state-posted{background:#FFB43A;color:var(--ink)}
.pp-state-draft{background:transparent;border:1px solid var(--line);color:var(--ink-soft)}
.pp-card{text-align:left;width:min(480px,100%);max-height:88vh;overflow-y:auto}
.pp-card label{display:block;font-weight:700;font-size:13px;margin:13px 0 5px}
.pp-card select.pp-field{appearance:auto}
.pp-card textarea.pp-field{height:auto;min-height:74px;padding:10px 12px;resize:vertical}
.pp-card .pp-actions{display:flex;gap:10px;margin-top:16px}
.pp-card .pp-actions .btn{flex:1;padding:12px 10px;font-size:15px}
.pp-state-actions{display:flex;gap:10px;margin-top:10px}
.pp-state-actions .btn{flex:1}
.pp-danger{margin-top:14px;width:100%}
.pp-note{min-height:18px}`;
  document.head.appendChild(el);
})();

// ------------------------------------------------------------ dates
// All day maths reads on the app's home clock (Brisbane), the
// same clock todayStr and the topbar use: a post planned for
// Tuesday sits on Tuesday here whatever the device's zone says.
const dayKeyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const dayOf = (date) => dayKeyFmt.format(date); // YYYY-MM-DD
const parseDay = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const fmtDay = (date) => date.toISOString().slice(0, 10);

function weekOf(dayStr) {
  const d = parseDay(dayStr);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
  return Array.from({ length: 7 }, (_, i) => fmtDay(new Date(monday.getTime() + i * 864e5)));
}
function dayParts(dayStr) {
  const loc = lang() === "es" ? "es" : "en-AU";
  const d = parseDay(dayStr);
  return {
    dow: new Intl.DateTimeFormat(loc, { weekday: "short", timeZone: "UTC" }).format(d),
    num: d.getUTCDate(),
    full: new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d),
  };
}
function whenLabel(iso) {
  if (!iso) return t("planner.noDate");
  const loc = lang() === "es" ? "es" : "en-AU";
  return new Intl.DateTimeFormat(loc, {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", timeZone: TZ,
  }).format(new Date(iso));
}
// datetime-local values are Brisbane wall time here (the app's
// clock): the input shows and reads the time the user plans by.
function isoToInput(iso) {
  if (!iso) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const hh = String(Number(p.hour) % 24).padStart(2, "0");
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`;
}
function inputToIso(val) {
  if (!val) return null;
  const [dp, tp] = String(val).split("T");
  const [y, mo, da] = dp.split("-").map(Number);
  const [hh, mm] = (tp || "09:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, da, hh, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, Number(p.hour) % 24, +p.minute, +p.second);
  return new Date(guess - (asUtc - guess)).toISOString();
}

// ------------------------------------------------------------ data
const posts = () => [...((DATA && DATA.plannedPosts) || [])]
  .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0)
    || String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
const brands = () => (DATA && DATA.brands) || [];
const groups = () => (DATA && DATA.captionLibrary) || [];
const brandName = (id) => {
  const b = brands().find((x) => x.key === id || x.id === id);
  return b ? String(b.name || "") : "";
};
const nextOrder = () => posts().reduce((m, p) => Math.max(m, Number(p.order) || 0), 0) + 1;
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ------------------------------------------------------------ page
let selDay = null; // Brisbane YYYY-MM-DD; defaults to today

function rowHtml(p, { arrows = true, index = -1, total = 0 } = {}) {
  const cap = String(p.caption || "").trim();
  return `
  <div class="pp-row" data-post="${esc(p.key)}" role="button" tabindex="0" aria-label="${esc(t("planner.editTitle"))}">
    ${arrows ? `<span class="pp-move">
      <button type="button" data-up="${esc(p.key)}" aria-label="${esc(t("planner.moveUp"))}" ${index <= 0 ? "disabled" : ""}>▲</button>
      <button type="button" data-down="${esc(p.key)}" aria-label="${esc(t("planner.moveDown"))}" ${index >= total - 1 ? "disabled" : ""}>▼</button>
    </span>` : ""}
    <span class="pp-main">
      <span class="pp-top">${esc(brandName(p.brandId))} · ${esc(p.platform || "")}</span>
      <span class="pp-when">${esc(whenLabel(p.scheduledFor))}</span>
      ${cap ? `<span class="pp-cap">${esc(cap)}</span>` : ""}
    </span>
    <span class="pill pp-state-${esc(p.state || "draft")}">${esc(t(`planner.state.${p.state || "draft"}`))}</span>
  </div>`;
}

function wireRows(host, list, { arrows = true } = {}) {
  host.querySelectorAll("[data-post]").forEach((row) => {
    row.addEventListener("click", () => {
      const p = list.find((x) => x.key === row.dataset.post);
      if (p) openComposer(p);
    });
  });
  if (!arrows) return;
  host.querySelectorAll("[data-up]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); movePost(b.dataset.up, -1); }));
  host.querySelectorAll("[data-down]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); movePost(b.dataset.down, 1); }));
}

async function movePost(key, dir) {
  const user = firebaseUser();
  if (!user) return;
  const list = posts();
  const i = list.findIndex((p) => p.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  const a = list[i], b = list[j];
  const oa = Number(a.order) || 0, ob = Number(b.order) || 0;
  a.order = ob; b.order = oa;
  a.updatedAt = nowIso(); b.updatedAt = nowIso();
  try {
    const st = await store();
    const { key: _ka, ...ra } = a;
    const { key: _kb, ...rb } = b;
    await st.saveUserRecord(user, "plannedPosts", a.key, ra);
    await st.saveUserRecord(user, "plannedPosts", b.key, rb);
  } catch { /* the in-app order stands for this visit; the next load re-reads the truth */ }
  renderPlannerPage();
}

export function renderPlannerPage() {
  const host = $("#content");
  if (!host) return;
  if (accountMode !== "user" || !DATA) {
    host.innerHTML = `<section class="panel"><h3>${esc(t("nav.planner"))}</h3><p class="empty">${esc(t("planner.needAccount"))}</p></section>`;
    return;
  }
  const list = posts();
  const today = dayOf(new Date());
  if (!selDay) selDay = today;
  const week = weekOf(selDay);
  const countFor = (d) => list.filter((p) => p.scheduledFor && dayOf(new Date(p.scheduledFor)) === d).length;
  const dayList = list.filter((p) => p.scheduledFor && dayOf(new Date(p.scheduledFor)) === selDay);
  const sel = dayParts(selDay);
  host.innerHTML = `
  <section class="hero">
    <h2>${esc(t("nav.planner"))}</h2>
    <p>${esc(t("planner.intro"))}</p>
  </section>
  <section class="panel">
    <div class="panel-head"><h3>${esc(t("planner.weekTitle"))}</h3></div>
    <div class="pp-week" role="tablist" aria-label="${esc(t("planner.weekTitle"))}">
      ${week.map((d) => { const dp = dayParts(d); const c = countFor(d); return `
      <button class="pp-day ${d === selDay ? "on" : ""}" type="button" data-day="${d}" role="tab" aria-selected="${d === selDay}">
        <span class="pp-dow">${esc(dp.dow)}</span><b>${dp.num}</b>${c ? `<span class="pp-count">${c}</span>` : ""}
      </button>`; }).join("")}
    </div>
    <div class="panel-head"><h3>${esc(t("planner.dayTitle", { day: sel.full }))}</h3></div>
    ${dayList.length ? dayList.map((p) => rowHtml(p, { arrows: false })).join("") : `<p class="empty">${esc(t("planner.dayEmpty"))}</p>`}
  </section>
  <section class="panel" id="plannerQueue">
    <div class="panel-head"><h3>${esc(t("planner.queueTitle"))}</h3><button class="btn primary" id="ppPlanBtn" type="button">${esc(t("planner.planBtn"))}</button></div>
    ${list.length ? list.map((p, i) => rowHtml(p, { index: i, total: list.length })).join("") : `<p class="empty">${esc(t("planner.queueEmpty"))}</p>`}
  </section>`;
  host.querySelectorAll("[data-day]").forEach((b) => b.addEventListener("click", () => { selDay = b.dataset.day; renderPlannerPage(); }));
  const planBtn = $("#ppPlanBtn");
  if (planBtn) planBtn.addEventListener("click", () => openComposer(null));
  wireRows(host, list);
  // Reminders (slice B): keep the device's pending nudges in line
  // with the queue — fire-and-forget, and a render never prompts.
  reconcileReminders(list);
}

// ------------------------------------------------------------ composer
// One sheet, two doors in: "Plan a post" (a fresh record) and a
// queue row tap (that record, editable). The sheet carries the
// whole edit: brand (+ add a brand), platform, caption, hashtags
// with the saved-groups library, an optional date+time, and the
// state moves in the user's own hand ("I posted it" / "Back to
// planned"). Delete is the user's own record, plainly confirmed
// in place (tap once to arm, again to delete).
let composer = null; // { post|null, brandId, deleteArmed, busy }

function closeComposer() {
  const ov = document.getElementById("plannerOverlay");
  if (ov) ov.remove();
  document.removeEventListener("keydown", composerEsc);
  composer = null;
}
function composerEsc(e) { if (e.key === "Escape" && !(composer && composer.busy)) closeComposer(); }

function openComposer(post) {
  composer = {
    post: post || null,
    brandId: post ? post.brandId : (brands().length ? (brands()[0].key || brands()[0].id) : ""),
    deleteArmed: false,
    busy: false,
  };
  paintComposer({
    platform: post ? (post.platform || "Instagram") : "Instagram",
    caption: post ? (post.caption || "") : "",
    hashtags: post ? (post.hashtags || "") : "",
    when: post ? isoToInput(post.scheduledFor) : "",
  });
}

// Per-platform writing room (chunk-audit C-018): the character
// limits the destination platforms enforce, from the category
// norms. Only firm public caps are listed — a platform without
// one shows the plain count and never an invented limit. The
// counter WARNS; it never blocks a save (the plan is the user's;
// the platform's refusal is what they are being warned about).
const PLATFORM_LIMITS = {
  Instagram: { chars: 2200, tags: 30 },
  Threads: { chars: 500 },
  TikTok: { chars: 2200 },
  YouTube: { chars: 5000 },
};

function syncComposer() {
  // Read the live fields back into the working copy, so a repaint
  // (after adding a brand or a group) never loses typed words.
  const cap = $("#ppCaption"), tags = $("#ppTags"), when = $("#ppWhen"),
    plat = $("#ppPlatform"), brand = $("#ppBrand");
  return {
    platform: plat ? plat.value : "Instagram",
    caption: cap ? cap.value : "",
    hashtags: tags ? tags.value : "",
    when: when ? when.value : "",
    brandId: brand ? brand.value : (composer ? composer.brandId : ""),
  };
}

function paintComposer(vals) {
  groupArmedFor = ""; // ISSUE-022: every repaint disarms removal
  closeComposerOverlayOnly();
  // The selected brand's kit hashtag banks (chunk-audit C-020):
  // saved on the brand's kit, offered in this editor for the
  // brand's own posts. Banks are { name: [tag, ...] }.
  const curBrand = brands().find((b) => (b.key || b.id) === composer.brandId);
  const myBanks = Object.entries((curBrand && curBrand.kit && curBrand.kit.hashtag_banks) || {});
  const post = composer.post;
  const myBrands = brands();
  const myGroups = groups();
  const stripNames = ((DATA && DATA.workers) || []).map((w) => w.name).filter(Boolean);
  const overlay = document.createElement("div");
  overlay.className = "upgrade-overlay";
  overlay.id = "plannerOverlay";
  overlay.innerHTML = `
  <section class="upgrade-card pp-card" role="dialog" aria-modal="true" aria-label="${esc(post ? t("planner.editTitle") : t("planner.newTitle"))}">
    <h3 class="upgrade-title">${esc(post ? t("planner.editTitle") : t("planner.newTitle"))}</h3>
    <label for="ppBrand">${esc(t("planner.brand"))}</label>
    ${myBrands.length ? `
    <select class="tour-field pp-field" id="ppBrand">
      ${myBrands.map((b) => `<option value="${esc(b.key || b.id)}" ${composer.brandId === (b.key || b.id) ? "selected" : ""}>${esc(b.name || "")}</option>`).join("")}
    </select>` : `
    <p class="empty">${esc(t("planner.noBrands"))}</p>
    ${stripNames.length ? `<p class="form-note">${esc(t("planner.alsoOnHome", { names: stripNames.join(" · ") }))}</p>` : ""}`}
    <div class="name-row">
      <input class="tour-field" id="ppNewBrand" type="text" maxlength="80" placeholder="${esc(t("planner.brandNamePh"))}" aria-label="${esc(t("planner.brandNamePh"))}" />
      <button class="btn soft" id="ppAddBrand" type="button">${esc(t("planner.addBrand"))}</button>
    </div>
    <label for="ppPlatform">${esc(t("planner.platform"))}</label>
    <select class="tour-field pp-field" id="ppPlatform">
      ${PLATFORMS.map((p) => `<option value="${esc(p)}" ${vals.platform === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
    </select>
    <label for="ppCaption">${esc(t("planner.caption"))}</label>
    <textarea class="tour-field pp-field" id="ppCaption" maxlength="5000" placeholder="${esc(t("planner.captionPh"))}">${esc(vals.caption)}</textarea>
    <p class="form-note" id="ppCount" aria-live="polite"></p>
    ${myGroups.length ? `
    <label for="ppGroup">${esc(t("captions.useLabel"))}</label>
    <select class="tour-field pp-field" id="ppGroup">
      <option value="">${esc(t("captions.pick"))}</option>
      ${myGroups.map((g) => `<option value="${esc(g.key || g.id)}">${esc(g.name || "")}</option>`).join("")}
    </select>
    <button class="btn soft" id="ppGroupRemove" type="button">${esc(t("captions.removeGroup"))}</button>` : ""}
    <label for="ppTags">${esc(t("planner.hashtags"))}</label>
    <input class="tour-field" id="ppTags" type="text" maxlength="1000" placeholder="${esc(t("planner.hashtagsPh"))}" value="${esc(vals.hashtags)}" />
    ${myBanks.length ? `
    <label for="ppKitBank">${esc(t("planner.kitBankLabel"))}</label>
    <select class="tour-field pp-field" id="ppKitBank">
      <option value="">${esc(t("planner.kitBankPick"))}</option>
      ${myBanks.map(([name]) => `<option value="${esc(name)}">${esc(name)}</option>`).join("")}
    </select>` : ""}
    <div class="name-row">
      <input class="tour-field" id="ppGroupName" type="text" maxlength="60" placeholder="${esc(t("captions.namePh"))}" aria-label="${esc(t("captions.namePh"))}" />
      <button class="btn soft" id="ppGroupSave" type="button">${esc(t("captions.saveAs"))}</button>
    </div>
    <label for="ppWhen">${esc(t("planner.when"))}</label>
    <input class="tour-field" id="ppWhen" type="datetime-local" value="${esc(vals.when)}" />
    <p class="form-note">${esc(t("planner.whenNote"))}</p>
    <div class="pp-actions">
      <button class="btn soft" id="ppCancel" type="button">${esc(t("common.cancel"))}</button>
      <button class="btn primary" id="ppSave" type="button">${esc(t("common.save"))}</button>
    </div>
    ${post ? `
    <div class="pp-state-actions">
      ${post.state !== "posted"
        ? `<button class="btn soft" id="ppPosted" type="button">${esc(t("planner.postedIt"))}</button>`
        : `<button class="btn soft" id="ppBackPlanned" type="button">${esc(t("planner.backToPlanned"))}</button>`}
      <button class="btn soft" id="ppDuplicate" type="button">${esc(t("planner.duplicate"))}</button>
    </div>
    <button class="btn soft pp-danger" id="ppDelete" type="button">${esc(t("planner.delete"))}</button>` : ""}
    <p class="form-note pp-note" id="ppNote"></p>
  </section>`;
  document.body.appendChild(overlay);
  document.addEventListener("keydown", composerEsc);
  wireComposer();
}

function closeComposerOverlayOnly() {
  const ov = document.getElementById("plannerOverlay");
  if (ov) ov.remove();
  document.removeEventListener("keydown", composerEsc);
}

let groupArmedFor = "";

function wireComposer() {
  const note = (msg) => { const n = $("#ppNote"); if (n) n.textContent = msg; };
  const brandSel = $("#ppBrand");
  if (brandSel) brandSel.addEventListener("change", () => {
    composer.brandId = brandSel.value;
    // Repaint so the kit hashtag banks follow the brand (C-020);
    // syncComposer carries the typed words across the repaint.
    paintComposer(syncComposer());
  });
  const grp = $("#ppGroup");
  if (grp) grp.addEventListener("change", () => {
    // ISSUE-022: changing the pick disarms a pending group removal.
    groupArmedFor = "";
    const gr0 = $("#ppGroupRemove");
    if (gr0) gr0.textContent = t("captions.removeGroup");
    const g = groups().find((x) => (x.key || x.id) === grp.value);
    if (!g) return;
    const cap = $("#ppCaption"), tags = $("#ppTags");
    if (cap) cap.value = g.caption || "";
    if (tags) tags.value = g.hashtags || "";
    paintCount();
  });
  // The live counter (C-018): characters + hashtags against the
  // selected platform's firm limits, warning when over.
  const paintCount = () => {
    const el = $("#ppCount");
    if (!el) return;
    const cap = $("#ppCaption"), tags = $("#ppTags"), plat = $("#ppPlatform");
    const chars = cap ? cap.value.length : 0;
    const tagCount = tags ? (tags.value.match(/#/g) || []).length : 0;
    const platform = plat ? plat.value : "";
    const lim = PLATFORM_LIMITS[platform] || null;
    let line = lim
      ? t("planner.countOf", { count: chars, limit: lim.chars, platform })
      : t("planner.count", { count: chars });
    // ISSUE-019: the hashtag segment always renders as one clean
    // clause ("0 of 30 hashtags"), never a dangling "of 30" after
    // the count segment collapses at zero.
    if (lim && lim.tags) line += ` · ${t("planner.countTagsOfFull", { count: tagCount, limit: lim.tags })}`;
    else if (tagCount) line += ` · ${t("planner.countTags", { count: tagCount })}`;
    const over = Boolean(lim && (chars > lim.chars || (lim.tags && tagCount > lim.tags)));
    el.textContent = over ? `${line} · ${t("planner.overLimit", { platform })}` : line;
    el.classList.toggle("pp-over", over);
  };
  const capEl = $("#ppCaption"), tagsEl = $("#ppTags"), platEl = $("#ppPlatform");
  if (capEl) capEl.addEventListener("input", paintCount);
  if (tagsEl) tagsEl.addEventListener("input", paintCount);
  if (platEl) platEl.addEventListener("change", paintCount);
  paintCount();
  // Kit hashtag banks (C-020): picking a bank appends its tags
  // to the hashtags field, the same fill shape as caption groups.
  const bankSel = $("#ppKitBank");
  if (bankSel) bankSel.addEventListener("change", () => {
    const brand = brands().find((b) => (b.key || b.id) === composer.brandId);
    const bank = brand && brand.kit && brand.kit.hashtag_banks
      ? brand.kit.hashtag_banks[bankSel.value] : null;
    bankSel.value = "";
    if (!bank || !bank.length) return;
    const tags = $("#ppTags");
    if (!tags) return;
    const add = bank.join(", ");
    tags.value = tags.value.trim() ? `${tags.value.trim()}, ${add}` : add;
    paintCount();
  });
  const addBrand = $("#ppAddBrand");
  if (addBrand) addBrand.addEventListener("click", async () => {
    const name = (($("#ppNewBrand") || {}).value || "").trim();
    if (!name || composer.busy) return;
    const user = firebaseUser();
    if (!user) return;
    const vals = syncComposer();
    composer.busy = true;
    try {
      const st = await store();
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
        + "-" + Math.random().toString(36).slice(2, 8);
      // The clone's brand record shape (subset of record): Build 2
      // grows logo + channels on these same docs, no migration.
      const record = { name, channels: [], createdAt: nowIso(), updatedAt: nowIso() };
      await st.saveUserRecord(user, "brands", id, record);
      if (DATA) (DATA.brands = DATA.brands || []).push({ ...record, key: id });
      composer.brandId = id;
      composer.busy = false;
      paintComposer(vals);
      note(t("planner.saved"));
    } catch { composer.busy = false; note(t("planner.saveFailed")); }
  });
  const grpSave = $("#ppGroupSave");
  if (grpSave) grpSave.addEventListener("click", async () => {
    if (composer.busy) return;
    const name = (($("#ppGroupName") || {}).value || "").trim();
    const vals = syncComposer();
    if (!name) { note(t("captions.needName")); return; }
    if (!vals.caption.trim() && !vals.hashtags.trim()) { note(t("captions.needWords")); return; }
    const user = firebaseUser();
    if (!user) return;
    composer.busy = true;
    try {
      const st = await store();
      const id = newId("cap");
      const record = { name, caption: vals.caption, hashtags: vals.hashtags };
      await st.saveUserRecord(user, "captionLibrary", id, record);
      if (DATA) (DATA.captionLibrary = DATA.captionLibrary || []).push({ ...record, key: id });
      composer.busy = false;
      paintComposer(vals);
      note(t("captions.saved"));
    } catch { composer.busy = false; note(t("planner.saveFailed")); }
  });
  // ISSUE-022: caption groups get the delete parity brands got in
  // ISSUE-004 — pick the group, tap Remove, tap again to confirm.
  // Deleting a group never touches posts: a post holds its own
  // caption + hashtags from the moment they were filled in.
  const grpRemove = $("#ppGroupRemove");
  if (grpRemove) grpRemove.addEventListener("click", async () => {
    if (composer.busy) return;
    const sel = $("#ppGroup");
    const id = sel ? sel.value : "";
    const g = groups().find((x) => (x.key || x.id) === id);
    if (!g) { note(t("captions.pick")); return; }
    if (groupArmedFor !== id) {
      groupArmedFor = id;
      grpRemove.textContent = t("captions.removeArm");
      return;
    }
    const user = firebaseUser();
    if (!user) return;
    composer.busy = true;
    try {
      const st = await store();
      await st.deleteUserRecord(user, "captionLibrary", id);
      if (DATA) DATA.captionLibrary = (DATA.captionLibrary || []).filter((x) => (x.key || x.id) !== id);
      composer.busy = false;
      paintComposer(syncComposer());
      note(t("captions.removed", { name: g.name || "" }));
    } catch { composer.busy = false; note(t("planner.saveFailed")); }
  });
  const cancel = $("#ppCancel");
  if (cancel) cancel.addEventListener("click", closeComposer);
  const save = $("#ppSave");
  if (save) save.addEventListener("click", () => saveComposer(null));
  const posted = $("#ppPosted");
  if (posted) posted.addEventListener("click", () => saveComposer("posted"));
  const back = $("#ppBackPlanned");
  if (back) back.addEventListener("click", () => saveComposer("back"));
  const dup = $("#ppDuplicate");
  if (dup) dup.addEventListener("click", () => duplicateComposer());
  const del = $("#ppDelete");
  if (del) del.addEventListener("click", async () => {
    if (composer.busy || !composer.post) return;
    if (!composer.deleteArmed) {
      composer.deleteArmed = true;
      del.textContent = t("planner.deleteArm");
      return;
    }
    const user = firebaseUser();
    if (!user) return;
    composer.busy = true;
    try {
      const st = await store();
      await st.deleteUserRecord(user, "plannedPosts", composer.post.key);
      if (DATA && DATA.plannedPosts) DATA.plannedPosts = DATA.plannedPosts.filter((p) => p.key !== composer.post.key);
      cancelPostReminder(composer.post.key);
      closeComposer();
      renderPlannerPage();
    } catch { composer.busy = false; note(t("planner.saveFailed")); }
  });
}

// Duplicate (chunk-audit C-019, built under HQ's ruling): the
// editor's current words saved as a NEW post in the draft state,
// then the editor reopens on the copy. Bounded on purpose: no
// state carry-over (a copy never lands as posted), no reminder
// is scheduled for it here — saving the copy runs that step.
async function duplicateComposer() {
  if (!composer || composer.busy || !composer.post) return;
  const vals = syncComposer();
  const brandId = vals.brandId || composer.brandId;
  const user = firebaseUser();
  if (!user || !brandId) return;
  composer.busy = true;
  const record = {
    brandId,
    platform: vals.platform,
    caption: vals.caption,
    hashtags: vals.hashtags,
    scheduledFor: inputToIso(vals.when),
    state: "draft",
    order: nextOrder(),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  try {
    const st = await store();
    const id = newId("post");
    await st.saveUserRecord(user, "plannedPosts", id, record);
    if (DATA) (DATA.plannedPosts = DATA.plannedPosts || []).push({ ...record, key: id });
    composer.busy = false;
    openComposer({ ...record, key: id });
    const n = $("#ppNote");
    if (n) n.textContent = t("planner.duplicated");
    renderPlannerPage();
  } catch {
    composer.busy = false;
    const n = $("#ppNote");
    if (n) n.textContent = t("planner.saveFailed");
  }
}

async function saveComposer(forceState) {
  if (!composer || composer.busy) return;
  const note = (msg) => { const n = $("#ppNote"); if (n) n.textContent = msg; };
  const vals = syncComposer();
  const brandId = vals.brandId || composer.brandId;
  if (!brandId) { note(t("planner.noBrands")); return; }
  const user = firebaseUser();
  if (!user) return;
  const post = composer.post;
  const whenIso = inputToIso(vals.when);
  let state;
  if (forceState === "posted") state = "posted";
  else if (forceState === "back") state = whenIso ? "planned" : "draft";
  else if (post && post.state === "posted") state = "posted"; // the state buttons move a posted post, not Save
  else state = whenIso ? "planned" : "draft";
  const record = {
    brandId,
    platform: vals.platform,
    caption: vals.caption,
    hashtags: vals.hashtags,
    scheduledFor: whenIso,
    state,
    order: post ? (Number(post.order) || 0) : nextOrder(),
    createdAt: post ? (post.createdAt || nowIso()) : nowIso(),
    updatedAt: nowIso(),
  };
  composer.busy = true;
  try {
    const st = await store();
    const id = post ? post.key : newId("post");
    await st.saveUserRecord(user, "plannedPosts", id, record);
    if (DATA) {
      DATA.plannedPosts = DATA.plannedPosts || [];
      const i = DATA.plannedPosts.findIndex((p) => p.key === id);
      if (i >= 0) DATA.plannedPosts[i] = { ...record, key: id };
      else DATA.plannedPosts.push({ ...record, key: id });
    }
    closeComposer();
    renderPlannerPage();
    afterSavedReminder({ ...record, key: id });
  } catch { composer.busy = false; note(t("planner.saveFailed")); }
}

// ------------------------------------------------------------ reminders
// After any save (slice B): the post's device reminder follows
// its state — planned with a future time schedules (or replaces)
// the nudge, everything else clears it. The FIRST plan-with-a-
// time also earns Ruefly's one permission ask, in the app's own
// voice, with a "Not now" that is respected: if the device has
// never answered and the sheet has never gone up, it goes up now;
// a "yes" there schedules the very post that earned the ask.
async function afterSavedReminder(saved) {
  try {
    const r = await syncPostReminder(saved);
    if (!r.scheduled && r.permission === "prompt"
      && saved.state === "planned" && saved.scheduledFor
      && Date.parse(saved.scheduledFor) > Date.now()
      && !remindersAsked()) {
      showReminderAsk(async (state) => {
        if (state === "granted") { try { await syncPostReminder(saved); } catch {} }
      });
    }
  } catch {}
}
