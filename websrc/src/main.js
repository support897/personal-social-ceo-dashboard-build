import { createClient } from "@supabase/supabase-js";
import "./styles.css";
import { LIVE, SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTIONS_URL } from "./config.js";
import { FIREBASE_ON, watchFirebaseUser, completeEmailLink, signUpWithPassword, signInWithPassword, sendPasswordReset, signInGoogle, signInApple, signOutUser, signInDemoAnon, reauthenticateCurrentUser, deleteCurrentUser } from "app-firebase";
import { SEED } from "./seed-data.js";
import { workerSubLinksHtml, renderWorkerPage, workerGroupsHtml, refreshWorkerGroups, sideRoomsHtml, supervisorPanelHtml, homeRoomsPanelHtml, workerCard, fetchRoomHome, touchUpWorkerScans } from "./room-pages.js";
import { postingNavHtml, renderPostingPage } from "./social-pages.js";
import { ROOM_FEATURES } from "./room-features.js";
import { CLONE_FEATURES, cloneNavHtml, renderCloneBrandsPage } from "./clone-features.js";
import { renderPlannerPage } from "./planner.js";
import { reminderPermission, requestReminderPermission, reconcileReminders, cancelAllPostReminders } from "./reminders.js";
import { BRANDS_FEATURES, brandsNavHtml, renderBrandsPage } from "./brands-product.js";
import { WAITING_ON_OWNER_LABEL, HERO_OWNER_LINE, WITH_OWNER_RE, SOCIALS_OWNER_LABEL, SOCIALS_PANEL_LABEL, SOCIALS_BRAND_LABEL } from "./room-strings.js";
import { FREE_PLAN, PLUS_PLAN, resolvePlan, accountCapHit } from "./plans.js";
import { TOUR_STOPS, TOUR_LAST, decideTour, applyGuideEvent, tourCardHtml, reofferCardHtml, tourState } from "./tour.js";
import { t, tList, lang, onLangChange, setLang } from "./i18n.js";

// ---------------------------------------------------------------- state
// Remember this device: after one successful set/unlock, the owner key the
// function hands back is stored in localStorage — no expiry, no session
// limit — so on this device the room opens straight in, with no password
// ever asked again. "Lock this device" (sidebar foot) is the only way the
// stored key leaves the device, short of clearing the browser's site data.
const OWNER_KEY_STORAGE = "social_owner_key";
let ownerKey = "";
try { ownerKey = localStorage.getItem(OWNER_KEY_STORAGE) || ""; } catch { ownerKey = ""; }
let supabase = null;
let session = null;
if (LIVE) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
const previewMode = !LIVE;
let previewAuthed = false;

export const $ = (s) => document.querySelector(s);
export const esc = (v = "") => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
// Dates read in the active language (i18n): es-ES on a Spanish
// device, en-AU otherwise. Cached per language.
const dateFmts = {
  en: new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
  es: new Intl.DateTimeFormat("es-ES", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
};
const dateFmt = { format: (d) => dateFmts[lang()].format(d) };
export const fmtDate = (v) => (v ? dateFmts[lang()].format(new Date(v + (String(v).length === 10 ? "T00:00:00" : ""))) : t("common.noDate"));
export const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Brisbane" }).format(new Date());

function hasAccess() { return previewMode ? previewAuthed : Boolean(session?.access_token || ownerKey); }

// ---------------------------------------------------------------- api
// The admin-api function runs with verify_jwt on, so the Supabase gateway
// refuses any call that carries only the apikey header (401
// UNAUTHORIZED_NO_AUTH_HEADER — the reply that used to surface in the app
// as a bare "Something went wrong."). Every call therefore also sends the
// public anon key as a Bearer token, exactly like the Apex room does. The
// anon key is public by design; the real proving is the password / the
// owner key / her email session, checked inside the function.
async function callPublic(body) {
  const r = await fetch(`${FUNCTIONS_URL}/admin-api`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.error || data.message || "Something went wrong.");
  return data;
}
export async function callAdmin(body) {
  const headers = { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  else {
    headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
    if (ownerKey) headers["x-owner-key"] = ownerKey;
  }
  const r = await fetch(`${FUNCTIONS_URL}/admin-api`, { method: "POST", headers, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.ok) throw new Error(data.error || data.message || "Something went wrong.");
  return data;
}

// Data comes from the seed bundle in preview, or admin-api when live.
// Both shapes match: { supervisor, socials, rename, workers: [...] }.
export let DATA = null;

async function loadData() {
  if (previewMode) {
    DATA = structuredClone(SEED);
    touchUpWorkerScans(DATA);
    return;
  }
  DATA = await fetchRoomHome();
}

// ---------------------------------------------------------------- login
// DOOR v4 (her approval, 15 Oct 22:26; sheet of record:
// your_files/signup-mockup/v4/ruefly.html). PAGE 1 holds ONLY the
// sign-up, big and centred: the mark, the name, "Sign in or make
// your account", the two provider ICON buttons (logos only), "or
// with email", ONE email field and a round next arrow — and at
// the very bottom the tiny quiet demo line. Nothing else. The
// password waits on STEP 2, the same surface: the email shown
// with a Change link, ONE password field, ONE button, the forgot
// line. The standing one-button walk (continueWithEmail) runs on
// step 2 exactly as before. Joining asks no name and no plan
// here: the name is the tour's first stop, inside the app.
let doorStep = 1;
let doorBusy = false;

// Dogfood fix (ISSUE-018, build-7 retest): the busy latch must
// release on EVERY completion path. The b7 handlers painted the
// honest error line from their catch and only then reset the
// flag in a finally — a live flag over a dead-painted button, so
// the door stayed disabled until reload after any failed submit.
// settleDoor() is the single release: flag down first, then, if
// the door is still what is mounted, a repaint that brings the
// buttons back with the final line showing.
function settleDoor() {
  // The release is the WHOLE busy state: latch and label together
  // (ISSUE-018 built the latch half; ISSUE-021 the label half).
  doorBusy = false;
  doorNotice = "";
  if (document.querySelector(".door-wrap")) renderLogin();
}
let demoBoxOpen = false;
let doorEmail = "";
// The deletion landing (Apple closure F1, SR filming note): when
// an account (or a demo session) is deleted, the app lands back
// here and the confirmation must READ as a steady state, not a
// toast that can vanish before it is read. doorNotice holds that
// line on the door — painted by every renderLogin — until the
// visitor next interacts (types / signs in / opens the demo),
// whose handlers clear it.
let doorNotice = "";
const GOOGLE_G_ICON = `<svg width="24" height="24" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.3 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.3 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>`;
const APPLE_ICON = `<svg width="23" height="23" viewBox="0 0 24 24" fill="#33302C" aria-hidden="true"><path d="M17.05 12.54c-.03-2.89 2.36-4.27 2.47-4.34-1.35-1.97-3.44-2.24-4.18-2.27-1.78-.18-3.47 1.05-4.37 1.05-.9 0-2.29-1.02-3.77-1-1.94.03-3.72 1.13-4.72 2.86-2.01 3.49-.51 8.66 1.45 11.5.96 1.39 2.1 2.94 3.6 2.88 1.45-.06 2-.93 3.74-.93s2.24.93 3.77.9c1.56-.02 2.55-1.41 3.5-2.8 1.1-1.62 1.56-3.18 1.58-3.26-.03-.02-3.04-1.17-3.07-4.59zM14.16 4.06c.8-.97 1.34-2.32 1.19-3.66-1.15.05-2.55.77-3.38 1.74-.74.86-1.39 2.23-1.22 3.55 1.29.1 2.6-.65 3.41-1.63z"/></svg>`;
const NEXT_ARROW_ICON = `<svg width="27" height="27" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15M13 5l7 7-7 7" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// The demo's quiet seat at the bottom of the door (both steps):
// the approved line, and under it — only once tapped — the demo's
// two standing doors, unchanged (one-tap explore + the code).
function doorDemoHtml() {
  return `
  <div class="door-demo">
    <button class="door-demo-line" id="demoLine" type="button">${t("door.demoLine")}</button>
    <div class="door-demo-box" id="demoBox" ${demoBoxOpen ? "" : "hidden"}>
      <button class="btn primary full" id="fbDemoBtn" type="button" ${doorBusy ? "disabled" : ""}>${esc(t("door.demoExplore"))}</button>
      <p class="form-note">${esc(t("door.demoNote"))}</p>
      <form id="fbCodeForm" class="login-form alt">
        <label for="fbCode">${esc(t("door.demoCodeLabel"))}</label>
        <input id="fbCode" type="text" placeholder="${esc(t("door.demoCodePh"))}" autocomplete="off" />
        <button class="btn soft full" type="submit" ${doorBusy ? "disabled" : ""}>${esc(t("door.demoCodeBtn"))}</button>
      </form>
    </div>
  </div>`;
}

function renderLogin(message = "") {
  applyDocLang();
  if (doorStep === 2 && FIREBASE_ON) { renderDoorStep2(); return; }
  $("#app").innerHTML = `
  <main class="door-wrap">
    <section class="door-page">
      <div class="door-mark"><img src="/icons/mark.svg" alt="" /></div>
      <h1 class="door-name">Ruefly</h1>
      <p class="door-sub">${esc(t("door.sub"))}</p>
      ${previewMode ? `
        <div class="preview-note">Preview mode. The real current state.</div>
        <button class="btn primary full" id="previewBtn">Open my social room</button>` : ""}
      ${FIREBASE_ON ? `
      <div class="door-icons">
        <button class="door-ibtn" id="fbGoogleLogin" type="button" aria-label="${esc(t("door.google"))}" ${doorBusy ? "disabled" : ""}>${GOOGLE_G_ICON}</button>
        <button class="door-ibtn" id="fbAppleLogin" type="button" aria-label="${esc(t("door.apple"))}" ${doorBusy ? "disabled" : ""}>${APPLE_ICON}</button>
      </div>
      <div class="door-or"><span>${esc(t("door.orEmail"))}</span></div>
      <form id="fbDoorForm" class="door-form" novalidate>
        <input id="fbEmailLogin" type="email" placeholder="${esc(t("door.emailPh"))}" autocomplete="email" value="${esc(doorEmail)}" />
        <button class="door-next" type="submit">${esc(t("door.next"))} ${NEXT_ARROW_ICON}</button>
        <p class="form-note" id="fbLoginStatus">${esc(fbMsg)}</p>
      </form>` : ""}
      ${doorNotice ? `<p class="door-notice" role="status">${esc(doorNotice)}</p>` : ""}
    </section>
    ${FIREBASE_ON ? doorDemoHtml() : ""}
  </main>`;
  wireDoor();
  if (previewMode) {
    $("#previewBtn").addEventListener("click", () => { previewAuthed = true; boot(); });
    return;
  }
}

// The door's shared wiring (both steps): the demo line + its two
// doors, and the provider doors. Step-specific forms wire in
// their own renders below.
function wireDoor() {
  if (!FIREBASE_ON) return;
  const line = $("#demoLine");
  if (line) line.addEventListener("click", () => {
    const box = $("#demoBox");
    if (!box) return;
    box.hidden = !box.hidden;
    demoBoxOpen = !box.hidden;
    if (!box.hidden) { const c = $("#fbCode"); if (c) c.focus(); }
  });
  const demoBtn = $("#fbDemoBtn");
  if (demoBtn) demoBtn.addEventListener("click", () => { doorNotice = ""; startDemo(""); });
  const codeForm = $("#fbCodeForm");
  if (codeForm) codeForm.addEventListener("submit", (e) => { e.preventDefault(); doorNotice = ""; startDemo($("#fbCode").value || ""); });
  const g = $("#fbGoogleLogin");
  if (g) g.addEventListener("click", async () => { if (doorBusy) return; doorBusy = true; doorNotice = ""; const em = $("#fbEmailLogin"); if (em && em.value.trim()) doorEmail = em.value.trim(); fbMsg = t("account.oneMoment"); renderLogin(); try { await signInGoogle(); } catch (err) { fbMsg = fbFriendly(err); } finally { settleDoor(); } });
  const a = $("#fbAppleLogin");
  if (a) a.addEventListener("click", async () => { if (doorBusy) return; doorBusy = true; doorNotice = ""; const em = $("#fbEmailLogin"); if (em && em.value.trim()) doorEmail = em.value.trim(); fbMsg = t("account.oneMoment"); renderLogin(); try { await signInApple(); } catch (err) { fbMsg = fbFriendly(err); } finally { settleDoor(); } });
  const form = $("#fbDoorForm");
  if (form) form.addEventListener("submit", (e) => {
    e.preventDefault();
    const em = ($("#fbEmailLogin").value || "").trim();
    doorEmail = em;
    if (!em) { fbMsg = t("auth.typeEmail"); renderLogin(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { fbMsg = t("auth.emailBad"); renderLogin(); return; }
    fbMsg = "";
    doorNotice = "";
    doorStep = 2;
    renderLogin();
  });
}

// DOOR v4, STEP 2: the email, shown with a Change link; ONE
// password field; ONE button running the one-button walk
// (continueWithEmail: sign in first, create on a credential
// miss — the user never picks a road); the forgot line. A fresh
// create lands inside the app, where the tour's first stop asks
// the name — never a gate on the door.
function renderDoorStep2() {
  $("#app").innerHTML = `
  <main class="door-wrap">
    <section class="door-page">
      <div class="door-mark"><img src="/icons/mark.svg" alt="" /></div>
      <h1 class="door-name">Ruefly</h1>
      <p class="door-email-row"><b>${esc(doorEmail)}</b> <button class="door-change" id="doorChange" type="button">${esc(t("door.change"))}</button></p>
      <form id="fbPwForm" class="door-form">
        <label for="fbPasswordLogin">${esc(t("door.passwordLabel"))}</label>
        <input id="fbPasswordLogin" type="password" placeholder="${esc(t("common.password"))}" autocomplete="current-password" />
        <button class="btn primary full" type="submit" ${doorBusy ? "disabled" : ""}>${esc(t("door.continueEmail"))}</button>
        <button class="door-forgot" type="button" id="fbPwReset">${esc(t("door.forgot"))}</button>
        <p class="form-note" id="fbLoginStatus">${esc(fbMsg)}</p>
      </form>
    </section>
    ${doorDemoHtml()}
  </main>`;
  wireDoor();
  $("#doorChange").addEventListener("click", () => { doorStep = 1; fbMsg = ""; doorNotice = ""; renderLogin(); });
  $("#fbPwForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (doorBusy) return;
    doorNotice = "";
    const pw = $("#fbPasswordLogin").value || "";
    if (!pw) { fbMsg = t("auth.typePassword"); renderLogin(); return; }
    doorBusy = true;
    fbMsg = t("account.oneMoment");
    renderLogin();
    try { await continueWithEmail(doorEmail, pw); }
    catch (err) { fbMsg = fbFriendly(err); }
    finally { settleDoor(); }
  });
  $("#fbPwReset").addEventListener("click", async () => {
    try { await sendPasswordReset(doorEmail); fbMsg = t("auth.resetSent"); }
    catch (err) { fbMsg = fbFriendly(err); }
    renderLogin();
  });
  const pw = $("#fbPasswordLogin");
  if (pw) pw.focus();
}

// ---------------------------------------------------------------- shell
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (ROOM_FEATURES && parts[0] === "w" && parts[1]) return { page: "worker", slug: parts[1], sub: parts[2] || "overview" };
  if (ROOM_FEATURES && parts[0] && parts[0].split("?")[0] === "posting") return { page: "posting" };
  if (parts[0] === "planner") return { page: "planner" };
  if (parts[0] === "notifications") return { page: "notifications" };
  if (parts[0] === "account") return { page: "account" };
  if (CLONE_FEATURES && parts[0] === "brands") return { page: "brands" };
  if (BRANDS_FEATURES && parts[0] === "brands") return { page: "brands", brandId: parts[1] || "" };
  if (parts[0] === "plans") return { page: "plans" };
  return { page: "home" };
}

const ico = (paths) => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const BELL_ICON = ico('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>');
// Sidebar/menu icons — clean inline SVGs in the app's palette (currentColor),
// never letter tiles, never emoji. One intuitive picture per destination.
export const ICONS = {
  home: ico('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'),
  overview: ico('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  research: ico('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  experiments: ico('<path d="M10 2v6.3L4.6 18a2 2 0 0 0 1.8 3h11.2a2 2 0 0 0 1.8-3L14 8.3V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>'),
  week: ico('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  lock: ico('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  ext: ico('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  panel: ico('<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/>'),
};
export const WORKER_ICONS = {
  "personal-brand": ico('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  "personal-content": ico('<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>'),
  "personal-marketing": ico('<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'),
  "aussie-scammers": ico('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
  "human-video": ico('<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
};
export const WORKER_ICON_FALLBACK = ico('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>');
function pageName(r) {
  if (r.page === "planner") return t("nav.planner");
  if (ROOM_FEATURES && r.page === "posting") return "Posting";
  if (r.page === "notifications") return t("nav.notifications");
  if (r.page === "account") return t("nav.account");
  if (CLONE_FEATURES && r.page === "brands") return "Brands";
  if (BRANDS_FEATURES && r.page === "brands") return t("brands.title");
  if (r.page === "plans") return t("plans.title");
  if (r.page === "home") return accountMode === "user" ? t("nav.socials") : SOCIALS_OWNER_LABEL;
  return DATA.workers.find((w) => w.slug === r.slug)?.name || "";
}

export function dotClass(state) {
  return { live: "dot-live", active: "dot-live", "part-done": "dot-part", waiting: "dot-wait", paused: "dot-wait" }[state] || "dot-wait";
}

// Sidebar collapse: the topbar toggle hides the sidebar COMPLETELY (zero
// sidebar pixels; her order 11 Oct 2026) and brings it back. Open, the
// sidebar stays beside the content at every width — collapsible, never
// stacked.
// Sidebar Adaptive Law (Ilse, 14 Oct 2026; supersedes the remembered-choice
// behaviour): the sidebar starts HIDDEN on every load, at every width, so
// the app opens with the full screen. The toggle is per-session only —
// nothing is remembered between loads.
let navClosedSession = true;

// Nav shape (house law, 14 Oct): grouped areas, ONE area open at a
// time. Worker subpages render only under the room you are in; the
// rare pages sit in a "More" group that starts closed every load.
// Session-only state, like the sidebar itself: nothing persists.
let navMoreOpen = false;
let shellWorkerSlug = undefined;
function renderShell() {
  applyDocLang();
  const r = route();
  const startClosed = navClosedSession ? " nav-closed" : "";
  shellWorkerSlug = r.page === "worker" ? r.slug : null;
  const moreOpen = navMoreOpen || r.page === "notifications" || r.page === "account" || r.page === "brands";
  $("#app").innerHTML = `
  <div class="shell${startClosed}" id="shell">
    <aside class="sidebar" id="sidebar">
      <div class="side-brand"><img src="/icons/mark.svg" alt="" /><span><b>RUEFLY</b><small>${accountMode === "user" ? esc(t("nav.socialsSmall")) : SOCIALS_BRAND_LABEL}</small></span></div>
      <nav class="side-nav">
        <span class="side-group-title">${accountMode === "user" ? esc(t("nav.socials")) : SOCIALS_OWNER_LABEL}</span>
        <a class="side-link ${r.page === "home" ? "on" : ""}" data-slug="" href="#/" title="${accountMode === "user" ? esc(t("nav.socials")) : SOCIALS_OWNER_LABEL}"><span class="side-ico">${ICONS.home}</span><span class="side-txt">${accountMode === "user" ? esc(t("nav.socials")) : SOCIALS_OWNER_LABEL}</span></a>
        <a class="side-link ${r.page === "planner" ? "on" : ""}" data-nav="planner" href="#/planner" title="${esc(t("nav.planner"))}"><span class="side-ico">${ICONS.week}</span><span class="side-txt">${esc(t("nav.planner"))}</span></a>
        ${accountMode === "user" ? brandsNavHtml(r) : ""}
        ${workerGroupsHtml(r)}
        ${postingNavHtml(r)}
        <button class="side-group-toggle" id="moreToggle" aria-expanded="${moreOpen}">${esc(t("nav.more"))} <span class="more-chev">${moreOpen ? "▾" : "▸"}</span></button>
        <span class="more-group${moreOpen ? " open" : ""}" id="moreGroup">
        <a class="side-link ${r.page === "notifications" ? "on" : ""}" data-nav="notifications" href="#/notifications" title="${esc(t("nav.notifications"))}"><span class="side-ico">${BELL_ICON}</span><span class="side-txt">${esc(t("nav.notifications"))}</span></a>
        ${FIREBASE_ON ? `<a class="side-link ${r.page === "account" ? "on" : ""}" data-nav="account" href="#/account" title="${esc(t("nav.account"))}"><span class="side-ico">${WORKER_ICONS["personal-brand"]}</span><span class="side-txt">${esc(t("nav.account"))}</span></a>` : ""}
        ${CLONE_FEATURES ? cloneNavHtml(r) : ""}
        </span>
      </nav>
      <div class="side-foot">
        ${(!previewMode && accountMode !== "user") ? sideRoomsHtml() : ""}
        <button class="side-ext as-btn" id="signOutBtn" title="${accountMode === "user" ? esc(t("nav.signOut")) : "Lock this device"}"><span class="ext-ico">${ICONS.lock}</span><span class="side-txt">${accountMode === "user" ? esc(t("nav.signOut")) : "Lock this device"}</span></button>
      </div>
    </aside>
    <div class="main-col">
      <header class="topbar">
        <button class="menu-btn" id="menuBtn" aria-label="${esc(t("nav.menuBtn"))}" aria-expanded="${startClosed ? "false" : "true"}" title="${esc(t("nav.menuBtn"))}">${ICONS.panel}</button>
        <div class="top-title"><b>${esc(pageName(r))}</b><small>${esc(dateFmt.format(new Date()))} · Brisbane</small></div>
        ${accountMode === "user"
          ? (isDemoSession() ? `<span class="preview-pill">${esc(t("nav.demoPill"))}</span>` : `<span class="live-pill">${esc(t("nav.accountPill"))}</span>`)
          : previewMode ? `<span class="preview-pill">Preview data</span>` : `<span class="live-pill">Live</span>`}
      </header>
      ${isDemoSession() ? `<div class="demo-banner">${esc(t("home.demoBanner"))}</div>` : ""}
      <main class="content" id="content"></main>
    </div>
  </div>`;
  $("#menuBtn").addEventListener("click", () => {
    const closed = $("#shell").classList.toggle("nav-closed");
    navClosedSession = closed;
    $("#menuBtn").setAttribute("aria-expanded", String(!closed));
  });
  const mainColEl = document.querySelector(".main-col");
  if (mainColEl) mainColEl.addEventListener("click", (e) => {
    if (e.target.closest("#menuBtn")) return; // the button toggles itself
    const shell = $("#shell");
    if (shell && !shell.classList.contains("nav-closed")
        && window.matchMedia("(max-width: 720px)").matches) {
      shell.classList.add("nav-closed");
      navClosedSession = true;
      const mb = $("#menuBtn");
      if (mb) mb.setAttribute("aria-expanded", "false");
    }
  });

  const moreBtn = $("#moreToggle");
  if (moreBtn) moreBtn.addEventListener("click", () => {
    navMoreOpen = !navMoreOpen;
    const mg = $("#moreGroup");
    if (mg) mg.classList.toggle("open", navMoreOpen);
    moreBtn.setAttribute("aria-expanded", String(navMoreOpen));
    const cv = moreBtn.querySelector(".more-chev");
    if (cv) cv.textContent = navMoreOpen ? "▾" : "▸";
  });
  // Expandable rows: one delegated listener, survives in-place navigation.
  $("#content").addEventListener("click", (e) => {
    const head = e.target.closest("[data-expand]");
    if (!head) return;
    const body = head.parentElement.querySelector(".x-body");
    const open = head.getAttribute("aria-expanded") === "true";
    head.setAttribute("aria-expanded", String(!open));
    if (body) body.hidden = open;
  });
  $("#signOutBtn").addEventListener("click", async () => {
    ownerKey = ""; previewAuthed = false;
    try { localStorage.removeItem(OWNER_KEY_STORAGE); } catch {}
    if (supabase) await supabase.auth.signOut();
    session = null;
    if (accountMode === "user") {
      // Signing out of the per-user base returns to the doors.
      // ISSUE-021, the bypass (found on build 10's retest): this
      // handler used to tear the session down inline and repaint
      // the door itself — the one exit that never travelled
      // exitUserMode, and by flipping the mode first it disarmed
      // the watcher's funnel too, so nothing settled the door.
      // A normal account never noticed (its door state was already
      // settled); a demo session carries startDemo's busy latch +
      // "One moment…" in with it, and they stranded on the door
      // for good. Exit through the funnel, like every other exit.
      try { await signOutUser(); } catch {}
      exitUserMode(t("auth.signedOut"));
      return;
    }
    renderLogin();
  });
  renderContent(r);
}

// ---------------------------------------------------------------- pages
// What is waiting on Ilse, derived only from recorded truth: a worker in
// "waiting" state, a deliverable whose gate says "With Ilse", and each
// roll-up's ask line (line 4). Nothing here is guessed. It only flags the
// worker cards — her task list itself lives in the Needs Me app.
function needsYouItems() {
  const items = [];
  for (const w of DATA.workers) {
    const st = w.status || {};
    if (st.state === "waiting" && st.latest) {
      items.push({ slug: w.slug, sub: "overview", name: w.name, text: st.latest });
    }
    let gated = false;
    for (const d of w.deliverables || []) {
      if (WITH_OWNER_RE.test(String(d.verdict || "").trim())) {
        items.push({ slug: w.slug, sub: "overview", name: w.name, text: `"${d.title}": ${d.verdict}` });
        gated = true;
      }
    }
    const ask = w.rollup?.lines?.[3];
    if (ask && !gated) items.push({ slug: w.slug, sub: "week", name: w.name, text: ask });
  }
  return items;
}

// The product's own brand card (user + demo home strip): the
// user's own brands, with no room machinery in it — no worker
// link, no scan line. The room's workerCard lives in
// ./room-pages.js and renders only for a legacy room session.
function brandCard(w) {
  const st = w.status || {};
  // Dogfood fix (ISSUE-008): the whole card answers a tap, not just
  // its name — it opens the Brands page, where the brand opens.
  return `
  <div class="brand-card link-card" data-goto-brands role="button" tabindex="0" aria-label="${esc(w.name || "")}">
    <div class="brand-head"><h3>${esc(w.name)}</h3><span class="dot ${dotClass(st.state)}" title="${esc(st.state || "")}"></span></div>
    <p class="brand-short">${esc(w.short)}</p>
  </div>`;
}

const SOCIAL_TONE = { live: "dot-live", part: "dot-part", none: "dot-wait" };
export function socialRow(s) {
  return `
      <div class="social-row">
        <div class="social-head"><span class="dot ${SOCIAL_TONE[s.tone] || "dot-wait"}"></span><b>${esc(s.platform)}</b><span class="case-state social-state">${esc(s.state)}</span></div>
        <p class="social-line">${esc(s.line)}</p>
        ${s.detail ? `<p class="social-detail">${esc(s.detail)}</p>` : ""}
      </div>`;
}

// ------------------------------------------------------- build 3
// THE CONNECTION LAYER (product, per user). A user's connected
// accounts live as records at users/{uid}/connections/{platform}
// — display + state only: a platform token NEVER lives in
// Firestore for the product (the OAuth exchange is server-side,
// and its token home is the named custody joint in
// api/_lib/user-connect.js; until that lands, the connect sheet
// states plainly that connections open soon — no dead buttons).
// Own accounts only, official OAuth only (Detachment Law): no
// surface here can show, suggest or link anyone else's account.
export const CONNECT_PLATFORMS = [
  { id: "instagram", name: "Instagram", via: "meta" },
  { id: "facebook", name: "Facebook", via: "meta" },
  { id: "youtube", name: "YouTube", via: "google" },
  { id: "tiktok", name: "TikTok", via: "tiktok" },
  { id: "threads", name: "Threads", via: "threads" },
];
export const platformName = (id) => (CONNECT_PLATFORMS.find((p) => p.id === id) || {}).name || String(id || "");

// The panel's connections, in the platform order of record.
function userConnections() {
  const rows = (DATA && Array.isArray(DATA.connections)) ? DATA.connections : [];
  const order = new Map(CONNECT_PLATFORMS.map((p, i) => [p.id, i]));
  return rows.slice().sort((a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99));
}

// Visible state, from the record alone — never guessed: a
// needs-reconnect state exists only because a real check wrote
// it (with its reason) onto the record; paused is the user's
// own toggle; anything else standing is Connected.
function connectionState(rec) {
  if (rec.status === "needs-reconnect") return { word: t("connect.stateNeeds"), tone: "part", needs: true };
  if (rec.paused) return { word: t("connect.statePaused"), tone: "none", needs: false };
  return { word: t("connect.stateConnected"), tone: "live", needs: false };
}

function connectionRow(rec) {
  const st = connectionState(rec);
  const row = {
    platform: platformName(rec.key),
    tone: st.tone,
    state: st.word,
    line: rec.handle ? t("connect.connectedAs", { handle: String(rec.handle).replace(/^@/, "") }) : "",
    detail: st.needs ? String(rec.reason || t("connect.needsLine")) : "",
  };
  return `
  <div class="conn-block">
    ${socialRow(row)}
    <div class="conn-actions">
      <button class="btn soft" type="button" data-conn-pause="${esc(rec.key)}">${esc(rec.paused ? t("connect.resume") : t("connect.pause"))}</button>
      <button class="btn soft" type="button" data-conn-disconnect="${esc(rec.key)}">${esc(t("connect.disconnect"))}</button>
    </div>
  </div>`;
}

// One honest line at the top of the accounts panel (a disconnect
// leaves its note here); cleared when the sheet opens or the
// page changes under the router.
let socialsNote = "";

function socialsFront() {
  const rows = DATA.socials || [];
  const rn = DATA.rename;
  const user = accountMode === "user";
  if (user) {
    // The product's accounts panel reads the user's OWN
    // connections records — never the app meta doc (the legacy
    // room's socials field stays the room's source, below).
    const conns = userConnections();
    return `
  <section class="panel socials-panel">
    <div class="panel-head"><h3>${esc(t("home.accountsTitle"))}</h3></div>
    ${socialsNote ? `<p class="latest-line">${esc(socialsNote)}</p>` : ""}
    ${conns.length ? conns.map(connectionRow).join("") : `<p class="empty">${esc(t("home.noAccounts"))}</p>`}
    <p><button class="btn soft" id="addAccountBtn" type="button">${esc(t("home.addAccount"))}</button></p>
  </section>
  ${rn ? `
  <section class="panel rename-panel">
    <div class="panel-head"><h3>${esc(t("home.newName"))}</h3><span class="pill">${esc(rn.state_short || t("home.waiting"))}</span></div>
    <p class="latest-line">${esc(rn.name_line || "")}</p>
    <p>${esc(rn.state || "")}</p>
    ${rn.detail ? `<p class="detail">${esc(rn.detail)}</p>` : ""}
  </section>` : ""}`;
  }
  return `
  <section class="panel socials-panel">
    <div class="panel-head"><h3>${user ? esc(t("home.accountsTitle")) : SOCIALS_PANEL_LABEL}</h3></div>
    ${rows.length ? rows.map(socialRow).join("") : (user
      ? `<p class="empty">${esc(t("home.noAccounts"))}</p><p><a class="btn soft" href="#/account">${esc(t("home.addAccount"))}</a></p>`
      : `<p class="empty">No platforms yet.</p>`)}
    ${user && rows.length ? `<p><button class="btn soft" id="addAccountBtn">${esc(t("home.addAccount"))}</button></p>` : ""}
  </section>
  ${rn ? `
  <section class="panel rename-panel">
    <div class="panel-head"><h3>${esc(t("home.newName"))}</h3><span class="pill">${esc(rn.state_short || (user ? t("home.waiting") : WAITING_ON_OWNER_LABEL))}</span></div>
    <p class="latest-line">${esc(rn.name_line || "")}</p>
    <p>${esc(rn.state || "")}</p>
    ${rn.detail ? `<p class="detail">${esc(rn.detail)}</p>` : ""}
  </section>` : ""}`;
}

// The greeting (door v4): "Hello, friend" until the user's own
// name lands on their profile (the tour's first stop, the
// re-offer, or Account), then their name. A missing name blocks
// nothing; the greeting simply stays generic.
function greetingName() {
  const nm = String((userProfile && (userProfile.name || userProfile.personaName)) || "").trim();
  return nm || t("home.friend");
}

function renderHome() {
  const sup = DATA.supervisor || {};
  const user = accountMode === "user";
  const needsSlugs = new Set(needsYouItems().map((i) => i.slug));
  $("#content").innerHTML = `
    <section class="hero">
      ${user ? `<p class="greet-line">${t("home.greeting", { name: esc(greetingName()) })}</p>` : ""}
      <h2>${user ? esc(t("home.title")) : HERO_OWNER_LINE}</h2>
    </section>
    ${guideCardHtml()}
    ${socialsFront()}
    ${previewMode ? "" : `
    <div class="panel-head section-label"><h3>${user ? esc(t("home.workersLabel")) : "Workers"}</h3></div>
    <section class="strip">
      ${DATA.workers.length
        ? DATA.workers.map((w) => user ? brandCard(w) : workerCard(w, needsSlugs.has(w.slug))).join("")
        : (user ? `<p class="empty">${esc(t("home.noBrands"))}</p>` : "")}
    </section>`}
    ${(!previewMode && !user) ? supervisorPanelHtml() : ""}
    ${(!previewMode && !user) ? homeRoomsPanelHtml() : ""}`;
  wireGuideCard();
  wireSocialsPanel();
  document.querySelectorAll("[data-goto-brands]").forEach((el) => {
    const go = () => { location.hash = "#/brands"; };
    el.addEventListener("click", go);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  });
}

function wireSocialsPanel() {
  const add = $("#addAccountBtn");
  if (add) add.addEventListener("click", accountAddTap);
  document.querySelectorAll("[data-conn-pause]").forEach((b) =>
    b.addEventListener("click", () => toggleConnectionPause(b.dataset.connPause)));
  document.querySelectorAll("[data-conn-disconnect]").forEach((b) =>
    b.addEventListener("click", () => disconnectPlatform(b.dataset.connDisconnect)));
}

// Pause is the user's own toggle on their own record: planning
// keeps working; only the connection's state word changes.
async function toggleConnectionPause(platform) {
  if (accountMode !== "user" || !fbUser || !DATA) return;
  const rec = (DATA.connections || []).find((c) => c.key === platform);
  if (!rec) return;
  const { key, ...body } = rec;
  const next = { ...body, paused: !rec.paused, updatedAt: new Date().toISOString() };
  try {
    const store = await userStore();
    await store.saveUserRecord(fbUser, "connections", platform, next);
    rec.paused = next.paused;
    rec.updatedAt = next.updatedAt;
  } catch {}
  renderContent(route());
}

// Disconnect removes the user's own connection record. The
// platform side is revoked by the server route when it is live
// (api/_lib/user-connect.js); the record here goes either way,
// and the panel carries the honest note.
async function disconnectPlatform(platform) {
  if (accountMode !== "user" || !fbUser || !DATA) return;
  try {
    const store = await userStore();
    await store.removeUserRecord(fbUser, "connections", platform);
    DATA.connections = (DATA.connections || []).filter((c) => c.key !== platform);
    socialsNote = t("connect.disconnectedNote", { platform: platformName(platform) });
  } catch {}
  renderContent(route());
}

// ------------------------------------------------- connect sheet
// "Add an account" (user mode) opens this sheet: one row per
// platform, what connecting does in plain words, and the state
// as it honestly stands. While the token custody joint is not
// landed, every Connect button is DISABLED with its reason line
// under it — the app's not-yet pattern (the Plans page states
// "not switched on" the same way) — never a live button that
// does nothing. A connected platform reads its standing instead.
function openConnectSheet() {
  if (accountMode !== "user") return;
  closeConnectSheet();
  socialsNote = "";
  const demo = isDemoSession();
  const conns = new Map(userConnections().map((c) => [c.key, c]));
  const overlay = document.createElement("div");
  overlay.className = "upgrade-overlay";
  overlay.id = "connectOverlay";
  overlay.innerHTML = `
  <section class="upgrade-card conn-card" role="dialog" aria-modal="true" aria-label="${esc(t("connect.title"))}">
    <h3 class="upgrade-title">${esc(t("connect.title"))}</h3>
    <p class="upgrade-line">${esc(t("connect.intro"))}</p>
    ${CONNECT_PLATFORMS.map((p) => {
      const rec = conns.get(p.id);
      return `
    <div class="conn-sheet-row">
      <div class="conn-sheet-head"><b>${esc(p.name)}</b></div>
      <p class="social-line">${esc(t("connect.p." + p.id))}</p>
      ${rec
        ? `<p class="latest-line">${esc(rec.handle ? t("connect.connectedAs", { handle: String(rec.handle).replace(/^@/, "") }) : t("connect.stateConnected"))}</p>`
        : `<button class="btn soft" type="button" disabled>${esc(t("connect.btn"))}</button>
           <p class="form-note">${esc(demo ? t("connect.demoReason") : t("connect.soon"))}</p>`}
    </div>`;
    }).join("")}
    <div class="upgrade-actions">
      <button class="btn primary" id="connectClose" type="button">${esc(t("connect.close"))}</button>
    </div>
  </section>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeConnectSheet(); });
  document.body.appendChild(overlay);
  $("#connectClose").addEventListener("click", closeConnectSheet);
  document.addEventListener("keydown", connectEscClose);
  const first = $("#connectClose");
  if (first) first.focus();
}

function connectEscClose(e) { if (e.key === "Escape") closeConnectSheet(); }

function closeConnectSheet() {
  const overlay = document.getElementById("connectOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", connectEscClose);
}

// ------------------------------------------------- AI writing help
// Build 3: the BYO-key AI content chat, seated on the Account
// page. SR 5.1.2(i) is designed in, not bolted on: the surface
// NAMES the provider and takes the user's consent (recorded on
// their profile, with its time) BEFORE any key field or any
// call exists. The KEY CUSTODY SHAPE, named for Security's
// ruling: the key is held ONLY on this device (localStorage,
// under ruefly.aiKey.<provider>) — never written to Firestore,
// never logged, never shown again after entry; removing it is
// one tap. Calls go from this device straight to the provider
// with the user's own key; what comes back is saved as a DRAFT
// in the user's own space (users/{uid}/aiDrafts, the caption
// shape {caption, hashtags} the planner's library folds into)
// — drafts only, never posted, never sent anywhere else.
export const AI_PROVIDERS = [
  { id: "openai", name: "OpenAI" },
  { id: "anthropic", name: "Anthropic" },
  { id: "google", name: "Google" },
];
const aiProviderName = (id) => (AI_PROVIDERS.find((p) => p.id === id) || {}).name || String(id || "");
const aiKeySlot = (provider) => `ruefly.aiKey.${provider}`;
function aiSavedKey(provider) {
  try { return localStorage.getItem(aiKeySlot(provider)) || ""; } catch { return ""; }
}
let aiState = { provider: "openai", busy: false, error: "", prompt: "" };

function aiConsentAt(provider) {
  const c = (userProfile && userProfile.aiConsent) || {};
  return (c[provider] && c[provider].at) || "";
}

function aiChatHtml() {
  if (accountMode !== "user" || !userProfile || isDemoSession()) return "";
  const provider = aiState.provider;
  const consented = Boolean(aiConsentAt(provider));
  const hasKey = Boolean(aiSavedKey(provider));
  const drafts = (DATA && Array.isArray(DATA.aiDrafts)) ? DATA.aiDrafts : [];
  return `
      <div class="panel-head"><h3>${esc(t("aichat.title"))}</h3></div>
      <p>${esc(t("aichat.intro"))}</p>
      <p class="form-note">${esc(t("aichat.providerLabel"))}</p>
      <div class="bg-row">
        ${AI_PROVIDERS.map((p) => `<button class="btn ${provider === p.id ? "primary" : "soft"}" type="button" data-ai-provider="${p.id}">${esc(p.name)}</button>`).join("")}
      </div>
      ${!consented ? `
      <p>${esc(t("aichat.consent", { provider: aiProviderName(provider) }))}</p>
      <p class="form-note">${esc(t("aichat.keyFrom." + provider))}</p>
      <button class="btn primary" id="aiConsentBtn" type="button">${esc(t("aichat.understand"))}</button>`
      : hasKey ? `
      <p class="latest-line">${esc(t("aichat.keySaved"))}</p>
      <button class="btn soft" id="aiKeyRemove" type="button">${esc(t("aichat.keyRemove"))}</button>
      <label for="aiPrompt">${esc(t("aichat.promptLabel"))}</label>
      <textarea id="aiPrompt" class="ai-prompt" rows="3" maxlength="4000" placeholder="${esc(t("aichat.promptPh"))}">${esc(aiState.prompt || "")}</textarea>
      <div class="start-actions">
        <button class="btn primary" id="aiWrite" type="button" ${aiState.busy ? "disabled" : ""}>${esc(aiState.busy ? t("aichat.writing") : t("aichat.write"))}</button>
      </div>
      ${aiState.error ? `<p class="form-note">${esc(aiState.error)}</p>` : ""}`
      : `
      <label for="aiKey">${esc(t("aichat.keyLabel", { provider: aiProviderName(provider) }))}</label>
      <input id="aiKey" type="password" placeholder="${esc(t("aichat.keyPh"))}" autocomplete="off" />
      <div class="start-actions">
        <button class="btn primary" id="aiKeySave" type="button">${esc(t("aichat.keySave"))}</button>
      </div>`}
      <div class="panel-head"><h3>${esc(t("aichat.draftsTitle"))}</h3></div>
      ${drafts.length ? drafts.map((d) => `
      <div class="ai-draft">
        <p class="social-line">${esc(d.caption || "")}</p>
        <p class="form-note">${esc(t("aichat.draftFrom", { provider: aiProviderName(d.provider), date: fmtDate(String(d.createdAt || "").slice(0, 10)) }))}</p>
        <button class="btn soft" type="button" data-ai-draft-del="${esc(d.key)}">${esc(t("aichat.draftDelete"))}</button>
      </div>`).join("") : `<p class="empty">${esc(t("aichat.noDrafts"))}</p>`}`;
}

function wireAiChat() {
  document.querySelectorAll("[data-ai-provider]").forEach((b) =>
    b.addEventListener("click", () => {
      aiState = { ...aiState, provider: b.dataset.aiProvider, error: "" };
      renderContent(route());
    }));
  const consentBtn = $("#aiConsentBtn");
  if (consentBtn) consentBtn.addEventListener("click", async () => {
    if (!userProfile) return;
    userProfile.aiConsent = { ...(userProfile.aiConsent || {}), [aiState.provider]: { at: new Date().toISOString() } };
    try { const store = await userStore(); await store.saveUserProfile(fbUser, userProfile); } catch {}
    renderContent(route());
  });
  const keySave = $("#aiKeySave");
  if (keySave) keySave.addEventListener("click", () => {
    const v = (($("#aiKey") && $("#aiKey").value) || "").trim();
    if (!v) return;
    try { localStorage.setItem(aiKeySlot(aiState.provider), v); } catch {}
    const field = $("#aiKey");
    if (field) field.value = "";
    renderContent(route());
  });
  const keyRemove = $("#aiKeyRemove");
  if (keyRemove) keyRemove.addEventListener("click", () => {
    try { localStorage.removeItem(aiKeySlot(aiState.provider)); } catch {}
    aiState = { ...aiState, error: "" };
    renderContent(route());
  });
  const write = $("#aiWrite");
  if (write) write.addEventListener("click", runAiChat);
  document.querySelectorAll("[data-ai-draft-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      try {
        const store = await userStore();
        await store.removeUserRecord(fbUser, "aiDrafts", b.dataset.aiDraftDel);
        if (DATA) DATA.aiDrafts = (DATA.aiDrafts || []).filter((d) => d.key !== b.dataset.aiDraftDel);
      } catch {}
      renderContent(route());
    }));
}

// The provider call, from this device, with the user's own key.
// A refusal (the provider rejecting the key) and a reach failure
// are different honest lines; anything else unexpected reads as
// a reach failure rather than a guess.
async function callAiProvider(provider, key, prompt) {
  if (provider === "openai") {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { const e = new Error("provider"); e.status = r.status; throw e; }
    const data = await r.json();
    return String((((data.choices || [])[0] || {}).message || {}).content || "").trim();
  }
  if (provider === "anthropic") {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: "claude-3-5-haiku-latest", max_tokens: 600, messages: [{ role: "user", content: prompt }] }),
    });
    if (!r.ok) { const e = new Error("provider"); e.status = r.status; throw e; }
    const data = await r.json();
    return (data.content || []).map((b) => (b && b.type === "text" ? b.text : "")).join("").trim();
  }
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!r.ok) { const e = new Error("provider"); e.status = r.status; throw e; }
  const data = await r.json();
  const parts = ((((data.candidates || [])[0] || {}).content || {}).parts) || [];
  return parts.map((p) => (p && p.text) || "").join("").trim();
}

async function runAiChat() {
  if (aiState.busy || accountMode !== "user" || !fbUser) return;
  const provider = aiState.provider;
  const key = aiSavedKey(provider);
  const prompt = (($("#aiPrompt") && $("#aiPrompt").value) || "").trim();
  aiState = { ...aiState, prompt };
  if (!key) return;
  if (!prompt) { aiState = { ...aiState, error: t("aichat.errEmpty") }; renderContent(route()); return; }
  aiState = { ...aiState, busy: true, error: "" };
  renderContent(route());
  try {
    const text = await callAiProvider(provider, key, prompt);
    if (!text) throw new Error("empty");
    const rec = {
      provider,
      prompt,
      caption: text,
      hashtags: "",
      createdAt: new Date().toISOString(),
    };
    const id = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const store = await userStore();
    await store.saveUserRecord(fbUser, "aiDrafts", id, rec);
    if (DATA) DATA.aiDrafts = [{ ...rec, key: id }, ...(DATA.aiDrafts || [])];
    aiState = { ...aiState, busy: false, error: "", prompt: "" };
  } catch (e) {
    const refused = e && (e.status === 400 || e.status === 401 || e.status === 403);
    aiState = {
      ...aiState, busy: false,
      error: refused
        ? t("aichat.errBadKey", { provider: aiProviderName(provider) })
        : t("aichat.errReach", { provider: aiProviderName(provider) }),
    };
  }
  renderContent(route());
}

function renderContent(r) {
  if (r.page === "planner") return renderPlannerPage();
  if (r.page === "home") return renderHome();
  if (r.page === "notifications") return renderNotifications();
  if (r.page === "account") return renderAccount();
  if (CLONE_FEATURES && r.page === "brands") return renderCloneBrandsPage();
  if (BRANDS_FEATURES && r.page === "brands") return renderBrandsPage(r);
  if (r.page === "plans") return renderPlans();
  if (ROOM_FEATURES && r.page === "posting") return renderPostingPage();
  if (ROOM_FEATURES) {
    const w = DATA.workers.find((x) => x.slug === r.slug);
    if (!w) { $("#content").innerHTML = `<section class="panel"><p class="empty">That worker is not here.</p></section>`; return; }
    return renderWorkerPage(w, r);
  }
  return renderHome();
}


// ------------------------------------------------------- user mode (P3, slice 2)
// Two data homes, never mixed:
//  - "legacy": today's doors (owner key / her Supabase session /
//    preview seed) — her private CEO room, untouched by this slice,
//    reachable exactly as before whenever no Firebase user is
//    signed in;
//  - "user": the per-user Firestore base (src/user-store.js). Any
//    Firebase sign-in — email link, Google, Apple, or an anonymous
//    demo session — puts the app in user mode, and every read/write
//    stays inside that user's users/{uid} folder.
// DETACHMENT LAW: user mode never shows, suggests, or links the
// founder's own accounts; a user meets an empty app and their own
// accounts to connect, nothing of hers anywhere in it.
export let accountMode = "legacy";
let userProfile = null;
let entitlement = null; // _entitlements/{uid} (Payments Chapter §3): read at entry, never written here
let userEntering = false;
let demoCode = "";
// ------------------------------------------------------------------
// THE TOUR (door v4, her approval 15 Oct 22:26): the standalone
// name step is RETIRED. Joining lands a new account straight
// inside the app, and Rue's tour (src/tour.js: the stops, the
// decision, the guide reducer) opens there as ONE centred
// pop-up over the real app. enterUserMode decides from the
// load: a profile THIS entry created (loadUserSpace's isNew)
// tours from stop 1; a returning sign-in never tours. A name
// step closed or skipped unanswered arms the ONE quiet
// re-offer for the next visit (HQ 22:06) on the profile's guide
// record; tourSkipThisLoad keeps the re-offer out of the very
// session the skip happened in.
let tourActive = false;
let tourPending = false;
let reofferPending = false;
let tourSkipThisLoad = false;
let tourBusy = false;

function closeTourOverlayEl() {
  const ov = document.getElementById("tourOverlay");
  if (ov) ov.remove();
}

async function guideEvent(event, payload) {
  if (!userProfile) return;
  userProfile.guide = applyGuideEvent(userProfile.guide, event, payload);
  try { const store = await userStore(); await store.saveUserProfile(fbUser, userProfile); } catch {}
}

function setSidebarOpen(open) {
  const shell = $("#shell");
  if (!shell) return;
  shell.classList.toggle("nav-closed", !open);
  navClosedSession = !open;
  const mb = $("#menuBtn");
  if (mb) mb.setAttribute("aria-expanded", String(open));
}

// Where the real app stands behind the pop-up, per stop: the
// menu stop opens the sidebar (its sliver shape on a phone);
// the area stops ride the router to the page or panel the stop
// is about. The overlay itself is body-level, so shell paints
// and route changes never tear it down.
function applyTourBackdrop() {
  const stop = TOUR_STOPS[Math.min(Math.max(0, Number(userProfile?.guide?.tourStep) || 0), TOUR_LAST)];
  if (!stop) return;
  if (stop.go === "menu") { setSidebarOpen(true); return; }
  setSidebarOpen(false);
  const want = stop.go === "account" ? "#/account"
    : String(stop.go).startsWith("planner") ? "#/planner" : "#/";
  if (want !== "#/" && location.hash !== want) location.hash = want;
  if (want === "#/" && location.hash !== "#/" && location.hash !== "" && location.hash !== "#") location.hash = "#/";
  const go = stop.go;
  setTimeout(() => {
    if (!tourActive) return;
    if (go === "home-brands") { const el = document.querySelector(".strip"); if (el) el.scrollIntoView({ block: "start" }); }
    else if (go === "home-accounts") { const el = document.querySelector(".socials-panel"); if (el) el.scrollIntoView({ block: "start" }); }
    else if (go === "planner-queue") { const el = document.getElementById("plannerQueue"); if (el) el.scrollIntoView({ block: "start" }); else window.scrollTo(0, 0); }
    else window.scrollTo(0, 0);
  }, 90);
}

function tourEscClose(e) { if (e.key === "Escape") endTour(); }

function startTour() {
  if (accountMode !== "user" || isDemoSession() || !userProfile) return;
  tourPending = false;
  paintTour();
}

function paintTour() {
  closeTourOverlayEl();
  const idx = Math.min(Math.max(0, Number(userProfile?.guide?.tourStep) || 0), TOUR_LAST);
  const overlay = document.createElement("div");
  overlay.className = "tour-overlay";
  overlay.id = "tourOverlay";
  overlay.innerHTML = tourCardHtml(idx, {
    nameValue: idx === 0 ? String(userProfile.name || fbUser?.displayName || "") : "",
  });
  document.body.appendChild(overlay);
  tourActive = true;
  // R-002(i): presentation itself is the marker — written as the
  // card paints, so even a process-close at the first stop leaves
  // proof the tour ran (the b7 build could not tell "abandoned at
  // stop 1" from "never shown", and the re-offer pre-empted).
  if (userProfile && !tourState(userProfile.guide).presented) guideEvent("presented");
  applyTourBackdrop();
  const close = $("#tourClose");
  if (close) close.addEventListener("click", () => endTour());
  const skip = $("#tourSkip");
  if (skip) skip.addEventListener("click", () => endTour());
  const next = $("#tourNext");
  if (next) next.addEventListener("click", () => tourNext());
  document.addEventListener("keydown", tourEscClose);
  const field = $("#tourName");
  if (field) field.focus();
}

// Stop 1's field, read on EVERY way forward or out (HQ 22:52):
// a typed name saves on Next, on Skip tour and on the ✕ alike,
// through the profile's own save path (the same doc, filled in
// place). A blank field simply sails — nothing anywhere in the
// tour or the re-offer stops to demand a name; the one
// next-visit re-offer is the catch for the passed-by name.
async function captureTourName() {
  if (!userProfile) return;
  const field = $("#tourName");
  if (!field) return;
  const nm = (field.value || "").trim();
  if (nm && nm !== String(userProfile.name || "")) {
    userProfile.name = nm;
    try { const store = await userStore(); await store.saveUserProfile(fbUser, userProfile); } catch {}
  }
}

async function tourNext() {
  if (!tourActive || tourBusy || !userProfile) return;
  tourBusy = true;
  try {
    const idx = Math.min(Math.max(0, Number(userProfile.guide?.tourStep) || 0), TOUR_LAST);
    if (idx === 0) await captureTourName();
    if (idx >= TOUR_LAST) { await endTour(); return; }
    await guideEvent("next");
    paintTour();
  } finally { tourBusy = false; }
}

async function endTour() {
  if (!tourActive) return;
  await captureTourName();
  tourActive = false;
  closeTourOverlayEl();
  document.removeEventListener("keydown", tourEscClose);
  setSidebarOpen(false);
  const named = Boolean(String(userProfile?.name || "").trim());
  if (!named) tourSkipThisLoad = true;
  await guideEvent("end", { named });
  if (document.querySelector("#shell")) renderContent(route());
}

// The ONE quiet re-offer (HQ 22:06), shown on a later visit
// when the tour's name step went unanswered. Build-7 retest
// (R-002(ii)): a SHOWING spends nothing — the flag flips only
// when the user ANSWERS (Save, with or without a name typed, or
// Not now). A ✕, an Escape or a reload leave it unspent, so the
// offer honestly survives to the next visit instead of dying
// unseen.
function showNameReoffer() {
  if (accountMode !== "user" || isDemoSession() || !userProfile) return;
  reofferPending = false;
  closeTourOverlayEl();
  const overlay = document.createElement("div");
  overlay.className = "tour-overlay";
  overlay.id = "tourOverlay";
  overlay.innerHTML = reofferCardHtml();
  document.body.appendChild(overlay);
  const reEsc = (e) => { if (e.key === "Escape") closeReoffer(); };
  function closeReoffer() {
    closeTourOverlayEl();
    document.removeEventListener("keydown", reEsc);
  }
  document.addEventListener("keydown", reEsc);
  const x = $("#reofferClose");
  if (x) x.addEventListener("click", closeReoffer);
  const skip = $("#reofferSkip");
  if (skip) skip.addEventListener("click", async () => { await guideEvent("reoffer-answered"); closeReoffer(); });
  const save = $("#reofferSave");
  if (save) save.addEventListener("click", async () => {
    const nm = (($("#reofferName")?.value) || "").trim();
    if (nm && userProfile) {
      userProfile.name = nm;
      try { const store = await userStore(); await store.saveUserProfile(fbUser, userProfile); } catch {}
    }
    await guideEvent("reoffer-answered");
    closeReoffer();
    if (nm && document.querySelector("#shell")) renderContent(route());
  });
  const field = $("#reofferName");
  if (field) field.focus();
}
const userStore = () => import("./user-store.js");
function isDemoSession() { return accountMode === "user" && Boolean(fbUser?.isAnonymous); }

async function enterUserMode() {
  if (!fbUser || userEntering) return;
  if (accountMode === "user") {
    if (route().page === "account" && document.querySelector("#content")) renderContent(route());
    return;
  }
  userEntering = true;
  let unlockFailed = false;
  try {
    const store = await userStore();
    let loaded;
    if (fbUser.isAnonymous) {
      // Demo door: unlock FIRST (the rules deny an anon session any
      // read/write under users/ until its unlock record's hash
      // matches _demo/config), then seed on first visit only.
      try { await store.unlockDemo(fbUser, demoCode || store.DEMO_CODE_PLACEHOLDER); }
      catch (e) { unlockFailed = true; throw e; }
      loaded = await store.loadUserSpace(fbUser).catch(async (e) => {
        if (!e || e.message !== "demo-not-unlocked") throw e;
        await store.seedDemoSpace(fbUser);
        return store.loadUserSpace(fbUser);
      });
    } else {
      // Door v4: no name gate at entry, and no peek. The load
      // creates the profile (a provider displayName rides its
      // first write inside loadUserSpace, as before); the tour
      // decided below asks the name inside the app.
      loaded = await store.loadUserSpace(fbUser);
    }
    DATA = loaded.data;
    userProfile = loaded.profile;
    // The entitlement record rides entry for real accounts (the
    // demo's fabricated space holds none). A refused or missing
    // read is null — plans.js fails paid closed on it.
    entitlement = fbUser.isAnonymous ? null : await store.loadEntitlement(fbUser).catch(() => null);
    accountMode = "user";
    fbMsg = "";
    // ISSUE-021, the source half: a successful entry SETTLES the
    // door it came through. startDemo (and the door handlers) set
    // the busy latch + label on the way in; while inside the app
    // they are invisible, but any exit that repaints the door
    // would inherit them. No session carries a live latch or
    // label inside the app from here on.
    doorBusy = false;
    doorNotice = "";
    applyBackgroundChoice();
    // CEO counters: the once-a-day session stamp (+ the returning
    // count it can carry). Fire-and-forget — it never blocks entry.
    store.touchSession(fbUser, userProfile).catch(() => {});
    // The tour decision (door v4): made from THIS load, before
    // the shell paints, so Rue's card never flashes behind the
    // pop-up. Demo sessions never reach it (the anon branch is
    // separate, and decideTour is only consulted here).
    if (!fbUser.isAnonymous) {
      const decision = decideTour(userProfile, {
        isNew: Boolean(loaded.isNew),
        skippedThisLoad: tourSkipThisLoad,
      });
      tourPending = Boolean(decision && decision.show === "tour");
      reofferPending = Boolean(decision && decision.show === "reoffer");
    }
    renderShell();
    if (tourPending) startTour();
    else if (reofferPending) showNameReoffer();
  } catch (e) {
    console.warn("[p3] user mode entry failed:", e && (e.code || e.message));
    const wasAnon = Boolean(fbUser?.isAnonymous);
    if (wasAnon) { try { await signOutUser(); } catch {} }
    accountMode = "legacy";
    userProfile = null;
    entitlement = null;
    // ISSUE-018: an entry that fails back to the door (the demo's
    // wrong-code path lands here) must never inherit the latch —
    // nor its label: the b8 retest found the "One moment…" notice
    // still painted beside the error line on this path.
    doorBusy = false;
    doorNotice = "";
    fbMsg = wasAnon
      ? (unlockFailed ? t("auth.demoBadCode") : t("auth.demoFailed"))
      : t("auth.loadFailed");
    renderLogin(fbMsg);
  } finally { userEntering = false; }
}

function exitUserMode(message = "") {
  // Reminders (planner slice B): the device keeps no pending
  // nudges for an account that has left it — sign-out and the
  // account-deletion flow both exit through here.
  if (DATA && DATA.plannedPosts) cancelAllPostReminders(DATA.plannedPosts);
  // Chunk-audit fix (C-014): the BYO AI keys are per-device
  // localStorage slots; left alone they would survive sign-out
  // and deletion, and the NEXT account on this device would
  // inherit (and spend) the previous user's key. Both exits
  // funnel through here, so the keys are wiped here — the
  // deletion promise ("everything saved will be deleted") and
  // the sign-out both now hold for the keys too.
  try { for (const p of AI_PROVIDERS) localStorage.removeItem(aiKeySlot(p.id)); } catch {}
  accountMode = "legacy";
  userProfile = null;
  entitlement = null;
  DATA = null;
  demoCode = "";
  doorStep = 1;
  doorEmail = "";
  tourActive = false;
  tourPending = false;
  reofferPending = false;
  closeTourOverlayEl();
  doorBusy = false; // ISSUE-018: the door never inherits a latch
  // ISSUE-021: nor its label — leaving a successful demo otherwise
  // repainted the door still wearing startDemo's "One moment…"
  // (and the latch rode with it in the testers' build-9 run).
  doorNotice = "";
  renderLogin(message);
}

// Both demo doors land here: the one-tap button passes no code (the
// app's own door code applies); the code form passes what was typed.
// The session is anonymous; enterUserMode (via the auth watcher, or
// directly when the watcher has not fired yet) does unlock + seed.
async function startDemo(code) {
  // Dogfood fix (ISSUE-015): entering the demo can take a while on a
  // slow connection — the door says so and the buttons rest, instead
  // of sitting silent and tappable.
  if (doorBusy) return;
  doorBusy = true;
  fbMsg = "";
  doorNotice = t("account.oneMoment");
  demoCode = (code || "").trim();
  renderLogin();
  try {
    const u = await signInDemoAnon();
    if (u) { fbUser = u; enterUserMode(); }
  } catch (e) {
    console.warn("[p3] demo sign-in failed:", e && (e.code || e.message));
    doorBusy = false;
    doorNotice = "";
    fbMsg = fbFriendly(e);
    renderLogin(fbMsg);
  }
}

// Law E: the profile's background choice, applied on entry. "brand"
// is the app's own board look (Cream ground); white and black rest
// the ground on plain white / the ink wall — the overrides live in
// styles.css under html[data-bg]. The "upload" choice paints the
// user's own photo (profile background.imageRef) on a fixed layer
// behind the app, under a soft cream veil (styles.css #bgPhotoLayer)
// so words stay readable over any photo.
function applyBackgroundChoice() {
  const bgc = (userProfile && userProfile.background) || {};
  const choice = bgc.choice || "brand";
  document.documentElement.dataset.bg = choice;
  let layer = document.getElementById("bgPhotoLayer");
  if (choice === "upload" && bgc.imageRef) {
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "bgPhotoLayer";
      layer.setAttribute("aria-hidden", "true");
      layer.innerHTML = `<div class="bg-photo"></div><div class="bg-veil"></div>`;
      document.body.appendChild(layer);
    }
    layer.querySelector(".bg-photo").style.backgroundImage = `url("${bgc.imageRef}")`;
    layer.style.display = "";
  } else if (layer) {
    layer.style.display = "none";
  }
}

// Law E upload: the picked photo is shrunk on the device (longest
// edge 1600px, JPEG) and the data URL rides the profile doc's
// background.imageRef — the user's own data under their own
// account, read by loadUserSpace and swept on account deletion
// with everything else. A busy photo that would push the profile
// doc toward Firestore's 1 MiB ceiling steps its edge down until
// the data URL fits safely.
function downscaleBgImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1;
      let edge = Math.min(1600, longest);
      const render = () => {
        const s = edge / longest;
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * s));
        c.height = Math.max(1, Math.round(img.naturalHeight * s));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", 0.82);
      };
      let out = render();
      while (out.length > 700000 && edge > 400) { edge = Math.round(edge * 0.8); out = render(); }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

// The guide's first beat, state-driven (Rue's full walk is a later
// slice): the bubble words are the Lab spec's, verbatim. Shows only
// in user mode, only while the saved guide state says unfinished +
// not hidden; hiding writes the state back to the user's profile.
function guideCardHtml() {
  if (accountMode !== "user" || !userProfile || !userProfile.guide) return "";
  if (tourPending || tourActive) return ""; // Rue is already on screen, touring
  if (userProfile.guide.finished || userProfile.guide.hidden) return "";
  return `
  <section class="panel guide-card">
    <img class="guide-mark" src="/icons/media-generation-rue-firefly-pose-hello-wave2-0-b2cc42bc-5bba-49ef-b717-cc5a771f8625.webp" alt="" />
    <div class="guide-body">
      <p class="guide-bubble">${esc(t("home.guideBubble"))}</p>
      <p class="guide-note">${esc(t("home.guideNote"))}</p>
    </div>
    <div class="guide-actions">
      <button class="btn primary" id="guideAdd">${esc(t("home.addAccount"))}</button>
      <button class="btn soft" id="guideHide">${esc(t("home.guideHide"))}</button>
    </div>
  </section>`;
}
function wireGuideCard() {
  const add = $("#guideAdd");
  if (add) add.addEventListener("click", accountAddTap);
  const hide = $("#guideHide");
  if (hide) hide.addEventListener("click", async () => {
    if (!userProfile) return;
    userProfile.guide = { ...userProfile.guide, hidden: true };
    try { const store = await userStore(); await store.saveUserProfile(fbUser, userProfile); } catch {}
    renderContent(route());
  });
}

// ------------------------------------------------- upgrade moment
// The house popup (her order, 15 Oct 21:39): when a FREE user taps
// a paid extra — hits the plan edge — Rue invites the upgrade AT
// THAT MOMENT ONLY. Never on app open, never on a timer, never a
// nag: one response per edge tap, and "Not now" (or a tap on the
// backdrop) closes it and leaves the app fully usable.
//
// The edge that exists in the app today is the free plan's own
// account cap (plans.js: Free Forever holds up to 2 connected
// accounts; accounts 3–5 are Plus, per the locked feature split).
// Both "Add an account" taps — the home accounts panel and the
// guide card — run through accountAddTap: under the cap they go
// where they always went (the Account page); AT the cap the tap
// IS the edge, and the popup answers it. Nothing about what is
// free vs paid changes here — the cap is the locked split's own.
//
// Guards (all of them, every time): user mode only, and never a
// demo session (isDemoSession) — the demo explores freely. The
// legacy room never reaches it (accountAddTap's callers render
// only in user mode, and showUpgradePopup re-checks). The CEO
// surface is a separate bundle (owner.js) and never imports this.
// Plan standing (HQ ruling 15 Oct, 21:59): the cap arms ONLY
// for a record positively read as Free Forever — plans.js
// resolvePlan, from the user's OWN profile (a desk-stamped plan
// field plus the profile's age). Paid, comped, free-month and
// unreadable records all sail: the tap goes where it always
// went and no popup fires.
function userAccountCount() {
  // Build 3: in the product, the cap counts the user's own
  // CONNECTION records (the accounts they actually connected).
  // The legacy room keeps counting its own socials rows.
  if (accountMode === "user") {
    return (DATA && Array.isArray(DATA.connections) ? DATA.connections : []).length;
  }
  return (DATA && Array.isArray(DATA.socials) ? DATA.socials : []).length;
}

function accountAddTap() {
  if (accountMode === "user" && !isDemoSession()
      && accountCapHit(userProfile, userAccountCount(), entitlement, authCreatedAt()).capped) {
    showUpgradePopup();
    return;
  }
  // Build 3: a signed-in user's Add opens the connect sheet
  // (their own accounts, platform by platform). The legacy room
  // keeps its standing road to the Account page.
  if (accountMode === "user") { openConnectSheet(); return; }
  location.hash = "#/account";
}

// The popup's words read the language layer at paint time (the
// price pair stays the locked A$ text from plans.js — the words
// around it translate, the prices never convert here).
function upgradeCopy() {
  const state = planState();
  const plus = Boolean(state) && state.key === "plus";
  return {
    title: t("popup.title"),
    line: plus ? t("popup.linePlus") : t("popup.line"),
    price: plus ? t("popup.pricePlus") : t("popup.price", { price: PLUS_PLAN.priceLine }),
    foot: t("popup.foot"),
  };
}

export function showUpgradePopup() {
  if (accountMode !== "user" || isDemoSession()) return false;
  // The fence, re-checked at the popup itself: only a resolved
  // state AT its cap ever sees this card — Free Forever at 2, or
  // Plus at 5 since the payments wiring. The card's words are
  // per-plan (upgradeCopy): a Plus holder is told about Plus's
  // shelf, never the free plan's (QA's build-12 copy finding).
  if (!accountCapHit(userProfile, userAccountCount(), entitlement, authCreatedAt()).capped) return false;
  closeUpgradePopup();
  const copy = upgradeCopy();
  const overlay = document.createElement("div");
  overlay.className = "upgrade-overlay";
  overlay.id = "upgradeOverlay";
  overlay.innerHTML = `
  <section class="upgrade-card" role="dialog" aria-modal="true" aria-label="${esc(t("popup.aria"))}">
    <img class="upgrade-mark" src="/icons/media-generation-rue-firefly-pose-encourage-0-ecf12e2e-a6cf-4155-bb74-5467927dc8c4.webp" alt="" />
    <h3 class="upgrade-title">${esc(copy.title)}</h3>
    <p class="upgrade-line">${esc(copy.line)}</p>
    <p class="upgrade-price">${esc(copy.price)}</p>
    <div class="upgrade-actions">
      <button class="btn primary" id="upgradeSeePlans">${esc(t("common.seePlans"))}</button>
      <button class="btn soft" id="upgradeNotNow">${esc(t("common.notNow"))}</button>
    </div>
    <p class="upgrade-foot">${esc(copy.foot)}</p>
  </section>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeUpgradePopup(); });
  document.body.appendChild(overlay);
  $("#upgradeNotNow").addEventListener("click", closeUpgradePopup);
  $("#upgradeSeePlans").addEventListener("click", () => {
    closeUpgradePopup();
    location.hash = "#/plans";
  });
  document.addEventListener("keydown", upgradeEscClose);
  const first = $("#upgradeSeePlans");
  if (first) first.focus();
  return true;
}

function upgradeEscClose(e) { if (e.key === "Escape") closeUpgradePopup(); }

export function closeUpgradePopup() {
  const overlay = document.getElementById("upgradeOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", upgradeEscClose);
}

// ------------------------------------------------------------ plans
// The Plans page: the shelf, stated plainly from plans.js (the
// same data the popup reads, so the two can never disagree).
// Plans are picked HERE, or at the moment a paid extra calls —
// never while joining (her door-first order). Paying is not
// switched on in the app yet, and the page says so: it sells
// nothing, it informs. Studio is named as coming later, with no
// price — the locked file's rule is sell it only when built.
function planCardHtml(plan, isCurrent) {
  const points = tList(`plan.${plan.id}.points`);
  return `
  <section class="panel plan-card">
    <div class="panel-head"><h3>${esc(plan.name)}</h3><span class="pill">${esc(plan.priceLine)}</span></div>
    ${isCurrent ? `<p class="latest-line">${esc(t("plans.current"))}</p>` : ""}
    ${(points.length ? points : plan.points).map((p) => `<p class="plan-point">${esc(p)}</p>`).join("")}
  </section>`;
}

// The Plans page banner: the same resolution the cap reads
// (plans.js resolvePlan, from the user's own profile), stated
// per state — mirroring the Needs Me banner's shapes. Signed-out
// and demo sessions hold no plan record, so they get no banner.
// The account's age, from the AUTH record (server-issued,
// client-unwritable) — never from the profile's own field
// (see plans.js: QA's build-12 createdAt finding).
const authCreatedAt = () => (fbUser && fbUser.metadata && fbUser.metadata.creationTime) || "";

function planState() {
  return accountMode === "user" && !isDemoSession() ? resolvePlan(userProfile, entitlement, authCreatedAt()) : null;
}

function renderPlans() {
  const state = planState();
  const banner = !state ? ""
    : state.key === "plus" ? `<section class="panel"><p>${t("plans.banner.plan", { name: "Plus" })}</p></section>`
    : state.key === "studio" ? `<section class="panel"><p>${t("plans.banner.plan", { name: "Studio" })}</p></section>`
    : state.key === "top" ? `<section class="panel"><p>${t("plans.banner.top")}</p></section>`
    : state.key === "month" ? `<section class="panel"><p>${t("plans.banner.month")}</p></section>`
    : state.key === "free" ? `<section class="panel"><p>${t("plans.banner.free")}</p></section>`
    : `<section class="panel"><p>${t("plans.banner.unknown")}</p></section>`;
  $("#content").innerHTML = `
    <section class="hero">
      <h2>${esc(t("plans.title"))}</h2>
      <p>${esc(t("plans.intro"))}</p>
    </section>
    ${banner}
    ${planCardHtml(FREE_PLAN, Boolean(state) && (state.key === "free" || state.key === "month"))}
    ${planCardHtml(PLUS_PLAN, Boolean(state) && (state.key === "plus" || state.key === "top"))}
    <section class="panel">
      <p>${esc(t("plans.notOnSale"))}</p>
      <p class="detail">${esc(t("plans.studioLater"))}</p>
      ${accountMode === "user" ? `<p><a class="btn soft" href="#/account">${esc(t("plans.backToAccount"))}</a></p>` : ""}
    </section>`;
}

// ------------------------------------------- account deletion (F1)
// The privacy page's promise, made real: "open Account and choose
// Delete my account. It happens straight away." One control on the
// Account page serves both signed-in states honestly:
//  - a real account: its Firestore space (users/{uid}) and then
//    the Firebase sign-in itself are deleted;
//  - a demo session: the seeded space under its anonymous uid and
//    then the anonymous sign-in are deleted — the sheet's words
//    say "demo session", never "account".
// The confirm sheet is plain: what goes, that it cannot be undone,
// a clear Cancel and a clear Delete of equal weight. No hidden
// exits, no shaming, nothing pre-ticked.
//
// Order is chosen so a partial state can always be spoken about
// truthfully:
//  0. identity is re-proven BEFORE anything is removed (the
//     password re-check, or the provider popup when the session
//     is stale) — a failure here deletes nothing;
//  1. the saved data goes (user-store deleteUserSpace);
//  2. the sign-in goes (deleteCurrentUser), with one re-auth +
//     retry if Firebase still calls the session stale.
// If step 2 fails after step 1, the session is signed out and the
// door carries the partial line as its steady notice — the data
// is gone, the sign-in remains, and the words say exactly that.
let deleteBusy = false;

function openDeleteSheet() {
  if (accountMode !== "user" || !fbUser) return;
  closeDeleteSheet();
  const demo = Boolean(fbUser.isAnonymous);
  const providers = (fbUser.providerData || []).map((p) => p && p.providerId);
  const needsPw = !demo && providers.includes("password");
  const overlay = document.createElement("div");
  overlay.className = "upgrade-overlay";
  overlay.id = "deleteOverlay";
  overlay.innerHTML = `
  <section class="upgrade-card" role="dialog" aria-modal="true" aria-label="${esc(t("account.delete"))}">
    <h3 class="upgrade-title">${esc(t("account.delete"))}</h3>
    <p class="upgrade-line">${esc(demo ? t("account.deleteSheetLineDemo") : t("account.deleteSheetLine"))}</p>
    ${needsPw ? `<p class="upgrade-line">${esc(t("account.deletePwNote"))}</p>
    <input class="tour-field" id="deletePw" type="password" placeholder="${esc(t("common.password"))}" autocomplete="current-password" />` : ""}
    <div class="upgrade-actions">
      <button class="btn soft" id="deleteCancel" type="button">${esc(t("account.deleteCancel"))}</button>
      <button class="btn primary" id="deleteConfirm" type="button">${esc(t("account.delete"))}</button>
    </div>
    <p class="form-note" id="deleteNote"></p>
  </section>`;
  document.body.appendChild(overlay);
  $("#deleteCancel").addEventListener("click", closeDeleteSheet);
  $("#deleteConfirm").addEventListener("click", runAccountDeletion);
  document.addEventListener("keydown", deleteEscClose);
  const field = $("#deletePw");
  if (field) field.focus();
}

function deleteEscClose(e) { if (e.key === "Escape" && !deleteBusy) closeDeleteSheet(); }

function closeDeleteSheet() {
  const overlay = document.getElementById("deleteOverlay");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", deleteEscClose);
}

async function runAccountDeletion() {
  if (deleteBusy || !fbUser || accountMode !== "user") return;
  const user = fbUser;
  const demo = Boolean(user.isAnonymous);
  const providers = (user.providerData || []).map((p) => p && p.providerId);
  const confirmBtn = $("#deleteConfirm");
  const cancelBtn = $("#deleteCancel");
  const note = $("#deleteNote");
  const pwField = $("#deletePw");
  const pw = pwField ? (pwField.value || "") : "";
  const failInSheet = (msg) => {
    deleteBusy = false;
    if (note) note.textContent = msg;
    if (confirmBtn) confirmBtn.disabled = false;
    if (cancelBtn) cancelBtn.disabled = false;
  };
  deleteBusy = true;
  if (confirmBtn) confirmBtn.disabled = true;
  if (cancelBtn) cancelBtn.disabled = true;
  if (note) note.textContent = t("account.deleting");

  // Step 0: prove it is really them, before anything is removed.
  if (!demo) {
    try {
      if (providers.includes("password")) {
        if (!pw) { failInSheet(t("auth.typePassword")); return; }
        await reauthenticateCurrentUser(pw);
      } else if (providers.includes("google.com") || providers.includes("apple.com")) {
        const last = Date.parse((user.metadata && user.metadata.lastSignInTime) || "");
        if (!isFinite(last) || Date.now() - last > 4 * 60 * 1000) {
          await reauthenticateCurrentUser();
        }
      }
    } catch (e) { failInSheet(fbFriendly(e)); return; }
  }

  // Step 1: their saved data, under users/{uid} only.
  try {
    const store = await userStore();
    const manifest = await store.deleteUserSpace(user);
    try { console.info("[account] deleted space:", manifest); } catch {}
  } catch (e) {
    deleteBusy = false;
    closeDeleteSheet();
    fbMsg = e && e.progressed ? t("account.deleteStuck") : t("account.deleteFailed");
    if (document.querySelector("#content")) renderContent(route());
    return;
  }

  // Step 2: the sign-in itself. One re-auth + retry if Firebase
  // still calls the session stale; beyond that, the partial state
  // is stated on the door, never hidden.
  let removed = true;
  try {
    await deleteCurrentUser();
  } catch (e) {
    removed = false;
    if (!demo && String((e && e.code) || "").includes("requires-recent-login")) {
      try {
        await reauthenticateCurrentUser(pw || undefined);
        await deleteCurrentUser();
        removed = true;
      } catch {}
    }
  }
  deleteBusy = false;
  closeDeleteSheet();
  if (!removed) {
    doorNotice = t("account.deletePartial");
    try { await signOutUser(); } catch {}
    if (accountMode === "user") exitUserMode(); else renderLogin();
    return;
  }
  doorNotice = demo ? t("account.deletedDemo") : t("account.deleted");
  try { await signOutUser(); } catch {}
  if (accountMode === "user") exitUserMode(); else renderLogin();
}

// ------------------------------------------------------- account (P1)
// The sign-in doors (Firebase Auth, ILSE-STANDARD §5). P3 (slice 2)
// moves the data under the account: any Firebase sign-in enters
// user mode (above) and reads only that user's own Firestore space.
// A signed-out user here sees the doors and nothing of anyone's data.

// THE ONE-BUTTON EMAIL ROAD (her shape, 15 Oct 21:26 + Quality's
// delta): the email form is email + password + ONE button,
// "Continue with email" — a first-time user never decides whether
// they are "creating" or "signing in". The walk:
//   1. SIGN IN with the entered email + password. Success enters
//      exactly as a returning sign-in (the auth watcher runs
//      enterUserMode; the name step shows only in its standing
//      empty-name fill case).
//   2. On a CREDENTIAL MISS only (user-not-found / wrong-password /
//      invalid-credential), CREATE the account with the same
//      details. Success is a brand-new account, so the watcher
//      lands on the name step exactly as the old Create button did.
//   3. Any other sign-in error (too-many-requests, invalid-email,
//      network…) is NOT a miss: it is rethrown untouched, so its
//      standing friendly line shows and no account is created.
// Error mapping on the create road (via fbFriendly at the call
// site): weak-password -> "Password needs at least 6 characters.";
// too-many-requests -> its standing line. email-already-in-use
// means the account exists and the password was simply wrong — it
// is converted HERE to the same generic credential error a wrong
// password earns, so the shown line is "Email or password did not
// match." and the failure never reveals which road failed.
async function continueWithEmail(email, pw) {
  try {
    await signInWithPassword(email, pw);
    return;
  } catch (err) {
    const code = (err && err.code) || "";
    const credentialMiss = code.includes("user-not-found")
      || code.includes("wrong-password")
      || code.includes("invalid-credential");
    if (!credentialMiss) throw err;
  }
  try {
    await signUpWithPassword(email, pw);
  } catch (err) {
    const code = (err && err.code) || "";
    if (code.includes("email-already-in-use")) {
      const generic = new Error("Email or password did not match.");
      generic.code = "auth/invalid-credential";
      throw generic;
    }
    throw err;
  }
}

function fbFriendly(err) {
  const code = (err && err.code) || "";
  // Dogfood fix (ISSUE-006): a network failure says so. It is the
  // failure a real user on a bad connection hits most, and it used
  // to fall through to the generic line with no hint at all.
  if (code.includes("network-request-failed")) return t("auth.network");
  if (code.includes("operation-not-allowed")) return t("auth.doorNotOpen");
  if (code.includes("invalid-email")) return t("auth.emailBad");
  if (code.includes("email-already-in-use")) return t("auth.emailInUse");
  if (code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-credential")) return t("auth.credMismatch");
  if (code.includes("weak-password")) return t("auth.weakPw");
  if (code.includes("too-many-requests")) return t("auth.tooMany");
  if (code.includes("popup-closed")) return t("auth.popupClosed");
  if (code.includes("expired-action-code") || code.includes("invalid-action-code")) return t("auth.linkOld");
  return t("auth.generic");
}

function renderAccount() {
  const host = $("#content");
  if (!FIREBASE_ON) {
    host.innerHTML = `<section class="panel"><h3>${esc(t("nav.account"))}</h3><p class="empty">${esc(t("account.setup"))}</p></section>`;
    return;
  }
  if (fbUser === undefined) {
    host.innerHTML = `<section class="panel"><h3>${esc(t("nav.account"))}</h3><p class="empty">${esc(t("account.oneMoment"))}</p></section>`;
    return;
  }
  if (fbUser) {
    if (accountMode === "user" && userProfile) {
      const demo = fbUser.isAnonymous;
      const bg = (userProfile.background && userProfile.background.choice) || "brand";
      const bgImg = (userProfile.background && userProfile.background.imageRef) || null;
      host.innerHTML = `<section class="panel"><h3>${esc(t("nav.account"))}</h3>
      ${demo
        ? `<p><b>${esc(t("nav.demoPill"))}.</b> ${t("account.demoLine", { name: esc(userProfile.personaName || userProfile.displayName || "Demo Owner") })}</p>`
        : `<p>${t("account.signedInAs", { name: esc(userProfile.name || fbUser.email || "") })}${userProfile.name && fbUser.email ? ` · ${esc(fbUser.email)}` : ""}</p>
      <p>${esc(t("account.thingsFollow"))}</p>`}
      ${fbMsg ? `<p>${esc(fbMsg)}</p>` : ""}
      ${demo ? "" : `
      <div class="panel-head"><h3>${esc(t("common.yourName"))}</h3></div>
      <p>${esc(t("account.nameBlurb"))}</p>
      <div class="name-row">
        <input id="acctName" type="text" maxlength="60" placeholder="${esc(t("common.yourName"))}" autocomplete="name" value="${esc(userProfile.name || "")}" />
        <button class="btn soft" id="acctNameSave" type="button">${esc(t("common.save"))}</button>
      </div>
      <p class="form-note" id="acctNameNote"></p>
      <div class="panel-head"><h3>${esc(t("account.bgTitle"))}</h3></div>
      <p>${esc(t("account.bgBlurb"))}</p>
      <div class="bg-row">
        ${[["brand", t("account.bg.brand")], ["white", t("account.bg.white")], ["black", t("account.bg.black")]].map(([v, label]) => `<button class="btn ${bg === v ? "primary" : "soft"}" data-bg="${v}">${esc(label)}</button>`).join("")}
        <button class="btn ${bg === "upload" ? "primary" : "soft"}" id="bgUploadBtn" type="button">${esc(t("account.bg.upload"))}</button>
      </div>
      ${bgImg ? `<div class="bg-row">
        <button class="btn soft" id="bgReplaceBtn" type="button">${esc(t("account.bg.replace"))}</button>
        <button class="btn soft" id="bgRemoveBtn" type="button">${esc(t("account.bg.remove"))}</button>
      </div>` : ""}
      <input id="bgFile" type="file" accept="image/*" hidden />
      <p class="form-note">${esc(t("account.bgPhotoNote"))}</p>
      <div class="panel-head"><h3>${esc(t("plans.title"))}</h3></div>
      <p>${esc(t("account.plansBlurb"))}</p>
      <button class="btn soft" id="plansOpen">${esc(t("common.seePlans"))}</button>
      <div class="panel-head"><h3>${esc(t("account.exportTitle"))}</h3></div>
      <p>${esc(t("account.exportBlurb"))}</p>
      <button class="btn soft" id="acctExport" type="button">${esc(t("account.exportBtn"))}</button>
      <p class="form-note" id="acctExportNote"></p>
      ${aiChatHtml()}
      <div class="panel-head"><h3>${esc(t("account.guideTitle"))}</h3></div>
      <p>${esc(t("account.guideBlurb"))}</p>
      <button class="btn soft" id="guideReopen">${esc(t("account.guideTitle"))}</button>
      <div class="panel-head"><h3>${esc(t("account.ownerTitle"))}</h3></div>
      <p>${esc(t("account.ownerBlurb"))}</p>
      <button class="btn soft" id="ownerRoomBtn">${esc(t("account.ownerBtn"))}</button>`}
      <div class="start-actions">
        <button class="btn soft" id="fbOut">${demo ? esc(t("account.exitDemo")) : esc(t("nav.signOut"))}</button>
      </div>
      <div class="panel-head"><h3>${esc(t("account.delete"))}</h3></div>
      <p>${esc(demo ? t("account.deleteBlurbDemo") : t("account.deleteBlurb"))}</p>
      <button class="btn soft" id="acctDelete" type="button">${esc(t("account.delete"))}</button></section>`;
      host.querySelectorAll("[data-bg]").forEach((b) => b.addEventListener("click", async () => {
        userProfile.background = { ...(userProfile.background || {}), choice: b.dataset.bg };
        try { const store = await userStore(); await store.saveUserProfile(fbUser, userProfile); } catch {}
        applyBackgroundChoice();
        renderShell();
      }));
      // Law E, the fourth choice: your own photo. With a photo
      // already saved, the button just re-picks it; without one it
      // opens the picker. The photo itself is downscaled on the
      // device and saved on the profile (background.imageRef);
      // "previous" remembers the choice to return to on Remove.
      const bgFileEl = $("#bgFile");
      const saveBg = async () => { try { const store = await userStore(); await store.saveUserProfile(fbUser, userProfile); } catch {} };
      const bgUp = $("#bgUploadBtn");
      if (bgUp) bgUp.addEventListener("click", async () => {
        const cur = userProfile.background || {};
        if (cur.imageRef) {
          userProfile.background = { ...cur, previous: cur.choice === "upload" ? (cur.previous || "brand") : cur.choice, choice: "upload" };
          await saveBg();
          applyBackgroundChoice();
          renderShell();
        } else if (bgFileEl) bgFileEl.click();
      });
      const bgRep = $("#bgReplaceBtn");
      if (bgRep) bgRep.addEventListener("click", () => { if (bgFileEl) bgFileEl.click(); });
      const bgRem = $("#bgRemoveBtn");
      if (bgRem) bgRem.addEventListener("click", async () => {
        const cur = userProfile.background || {};
        const back = ["brand", "white", "black"].includes(cur.previous) ? cur.previous : "brand";
        userProfile.background = { choice: back, imageRef: null, previous: null };
        await saveBg();
        applyBackgroundChoice();
        renderShell();
      });
      if (bgFileEl) bgFileEl.addEventListener("change", async () => {
        const f = bgFileEl.files && bgFileEl.files[0];
        if (!f) return;
        try {
          const dataUrl = await downscaleBgImage(f);
          const cur = userProfile.background || {};
          const prev = cur.choice && cur.choice !== "upload" ? cur.choice : (cur.previous || "brand");
          userProfile.background = { choice: "upload", imageRef: dataUrl, previous: prev };
          await saveBg();
        } catch {}
        applyBackgroundChoice();
        renderShell();
      });
      const po = $("#plansOpen");
      if (po) po.addEventListener("click", () => { location.hash = "#/plans"; });
      const ex = $("#acctExport");
      if (ex) ex.addEventListener("click", () => {
        // Data export (chunk-audit C-001, built under HQ's ruling):
        // the user's whole space as one JSON file — brands,
        // planned posts, caption groups, connections and AI
        // drafts, assembled from the loaded space. Delivered via
        // the share sheet where file sharing exists (the phone
        // app), else as a plain download (the web).
        const payload = {
          app: "Ruefly",
          exportedAt: new Date().toISOString(),
          profile: { name: (userProfile && userProfile.name) || "", background: (userProfile && userProfile.background && userProfile.background.choice) || "" },
          brands: (DATA && DATA.brands) || [],
          plannedPosts: (DATA && DATA.plannedPosts) || [],
          captionLibrary: (DATA && DATA.captionLibrary) || [],
          connections: (DATA && DATA.connections) || [],
          aiDrafts: (DATA && DATA.aiDrafts) || [],
        };
        const text = JSON.stringify(payload, null, 2);
        const note = $("#acctExportNote");
        const file = new File([text], "ruefly-export.json", { type: "application/json" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).then(() => { if (note) note.textContent = t("account.exportDone"); }).catch(() => {});
          return;
        }
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = "ruefly-export.json";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        if (note) note.textContent = t("account.exportDone");
      });
      wireAiChat();
      const ns = $("#acctNameSave");
      if (ns) ns.addEventListener("click", async () => {
        const nm = ($("#acctName").value || "").trim();
        userProfile.name = nm;
        const note = $("#acctNameNote");
        try {
          const store = await userStore(); await store.saveUserProfile(fbUser, userProfile);
          if (note) note.textContent = nm ? t("account.saved") : t("account.cleared");
        } catch { if (note) note.textContent = t("account.saveFailed"); }
      });
      const gr = $("#guideReopen");
      if (gr) gr.addEventListener("click", async () => {
        // Re-run the v4 tour (the prep: a skipped or closed
        // tour re-runs from Account's setup guide, as the guide
        // card did before it). The restart resets the walk on
        // the guide record; the spent re-offer stays spent.
        await guideEvent("restart");
        if (location.hash === "#/account") {
          location.hash = "#/";
          setTimeout(() => startTour(), 140);
        } else {
          if (document.querySelector("#shell")) renderContent(route());
          startTour();
        }
      });
      const oroom = $("#ownerRoomBtn");
      if (oroom) oroom.addEventListener("click", async () => { try { await signOutUser(); } catch (e) { fbMsg = fbFriendly(e); renderContent(route()); } });
      $("#fbOut").addEventListener("click", async () => { try { await signOutUser(); fbMsg = t("auth.signedOut"); } catch (e) { fbMsg = fbFriendly(e); renderContent(route()); } });
      const del = $("#acctDelete");
      if (del) del.addEventListener("click", openDeleteSheet);
      return;
    }
    host.innerHTML = `<section class="panel"><h3>${esc(t("nav.account"))}</h3>
      <p>${t("account.signedInAs", { name: esc(fbUser.email || "") })}</p>
      <p>${esc(t("account.thingsFollow"))}</p>
      ${fbMsg ? `<p>${esc(fbMsg)}</p>` : ""}
      <button class="btn soft" id="fbOut">${esc(t("nav.signOut"))}</button></section>`;
    $("#fbOut").addEventListener("click", async () => { try { await signOutUser(); fbMsg = t("auth.signedOut"); } catch (e) { fbMsg = fbFriendly(e); renderContent(route()); } });
    return;
  }
  host.innerHTML = `<section class="panel"><h3>${esc(t("nav.account"))}</h3>
    <p>${esc(t("account.signInOnce"))}</p>
    ${fbMsg ? `<p>${esc(fbMsg)}</p>` : ""}
    <label for="fbEmail">${esc(t("account.email"))}</label>
    <input id="fbEmail" type="email" placeholder="${esc(t("door.emailPh"))}" autocomplete="email" />
    <label for="fbPassword">${esc(t("common.password"))}</label>
    <input id="fbPassword" type="password" placeholder="${esc(t("common.password"))}" autocomplete="current-password" />
    <button class="btn primary full" id="fbPwContinueBtn">${esc(t("door.continueEmail"))}</button>
    <button class="btn soft full" id="fbPwResetBtn">${esc(t("door.forgot"))}</button>
    <p>${esc(t("account.or"))}</p>
    <button class="btn soft full" id="fbGoogle">${esc(t("door.google"))}</button>
    <button class="btn soft full" id="fbApple">${esc(t("door.apple"))}</button>
  </section>`;
  const pwFields = () => ({ email: ($("#fbEmail").value || "").trim(), pw: $("#fbPassword").value || "" });
  $("#fbPwContinueBtn").addEventListener("click", async () => {
    const { email, pw } = pwFields();
    if (!email) { fbMsg = t("auth.typeEmail"); renderContent(route()); return; }
    if (!pw) { fbMsg = t("auth.typePassword"); renderContent(route()); return; }
    // One-button email road, same walk as the door
    // (continueWithEmail): sign in first, create on a credential
    // miss. No name here either — a fresh create from this form
    // lands on the same name step (enterUserMode) as the door.
    try { await continueWithEmail(email, pw); }
    catch (e) { fbMsg = fbFriendly(e); renderContent(route()); }
  });
  $("#fbPwResetBtn").addEventListener("click", async () => {
    const { email } = pwFields();
    if (!email) { fbMsg = t("auth.typeEmail"); renderContent(route()); return; }
    try { await sendPasswordReset(email); fbMsg = t("auth.resetSent"); }
    catch (e) { fbMsg = fbFriendly(e); }
    renderContent(route());
  });
  $("#fbGoogle").addEventListener("click", async () => { try { await signInGoogle(); } catch (e) { fbMsg = fbFriendly(e); renderContent(route()); } });
  $("#fbApple").addEventListener("click", async () => { try { await signInApple(); } catch (e) { fbMsg = fbFriendly(e); renderContent(route()); } });
}

// ------------------------------------------------------- notifications
// Real Web Push (her order, 11 Oct 2026 — notifications for this app
// too, mirroring the Needs Me build: separate database, separate VAPID
// keys, nothing shared). A service worker (public/sw.js) holds the push
// subscription; the admin-api function holds the VAPID private key and
// sends. This page is the one control: Enable → the browser asks → the
// subscription is saved. Worker news and update cards filed for this
// room then push to every subscribed device.
let swReg = null;
function urlB64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}
function sendPushConfig() {
  if (!LIVE) return;
  const msg = { type: "push-config", functionsUrl: FUNCTIONS_URL, anonKey: SUPABASE_ANON_KEY };
  const targets = [navigator.serviceWorker?.controller, swReg?.active, swReg?.waiting, swReg?.installing];
  for (const t of targets) { try { t?.postMessage(msg); } catch {} }
}
async function registerPushSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    swReg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    sendPushConfig();
    setTimeout(sendPushConfig, 1500);
    return swReg;
  } catch { return null; }
}
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// Coming up (planner slice B): the user's own planned posts
// whose time is still ahead — brand · platform · when · the
// caption's first words — computed from plannedPosts on every
// render, so the list follows edits, postings and deletions on
// its own. Under it, one honest line about the device reminders
// themselves (on / off / this device cannot) with the button to
// turn them on when they are off. The device-push panel below
// it stays exactly as it was.
function comingUpHtml() {
  if (accountMode !== "user" || !DATA) return "";
  const nowMs = Date.now();
  const brandOf = (id) => {
    const b = ((DATA && DATA.brands) || []).find((x) => x.key === id || x.id === id);
    return b ? String(b.name || "") : "";
  };
  const firstWords = (s) => {
    const w = String(s || "").trim().split(/\s+/).filter(Boolean);
    return w.slice(0, 9).join(" ") + (w.length > 9 ? "…" : "");
  };
  const whenOf = (iso) => new Intl.DateTimeFormat(lang() === "es" ? "es" : "en-AU", {
    weekday: "short", day: "numeric", month: "short",
    hour: "numeric", minute: "2-digit", timeZone: "Australia/Brisbane",
  }).format(new Date(iso));
  const ups = [...((DATA && DATA.plannedPosts) || [])]
    .filter((p) => p.state === "planned" && p.scheduledFor && Date.parse(p.scheduledFor) > nowMs)
    .sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
  return `
    <section class="panel" id="comingUpPanel">
      <div class="panel-head"><h3>${esc(t("reminders.comingUp"))}</h3></div>
      ${ups.length ? ups.map((p) => `
      <div class="pp-row" style="cursor:default">
        <span class="pp-main">
          <span class="pp-top">${esc(brandOf(p.brandId))} · ${esc(p.platform || "")}</span>
          <span class="pp-when">${esc(whenOf(p.scheduledFor))}</span>
          ${firstWords(p.caption) ? `<span class="pp-cap">${esc(firstWords(p.caption))}</span>` : ""}
        </span>
      </div>`).join("") : `<p class="empty">${esc(t("reminders.comingUpEmpty"))}</p>`}
      <p class="form-note" id="remindState"></p>
      <div class="notif-actions">
        <button class="btn soft" id="remindEnable" hidden>${esc(t("reminders.turnOn"))}</button>
      </div>
    </section>`;
}

async function initRemindersLine() {
  const line = $("#remindState"), btn = $("#remindEnable");
  if (!line) return;
  const state = await reminderPermission();
  if (state === "granted") {
    line.textContent = t("reminders.deviceOn");
    if (btn) btn.hidden = true;
  } else if (state === "unsupported") {
    line.textContent = t("reminders.notSupported");
    if (btn) btn.hidden = true;
  } else {
    line.textContent = t("reminders.deviceOff");
    if (btn) {
      btn.hidden = false;
      btn.addEventListener("click", async () => {
        // Dogfood fix (ISSUE-005): the tap always answers. Whatever
        // the device says, the line says it back — never silence.
        const after = await requestReminderPermission();
        if (after === "granted") {
          if (DATA) reconcileReminders(DATA.plannedPosts || []);
          renderNotifications();
          return;
        }
        const now = $("#remindState");
        if (now) now.textContent = after === "denied" ? t("reminders.deniedLine")
          : after === "unsupported" ? t("reminders.notSupported")
          : t("reminders.stillOff");
      });
    }
  }
}

function renderNotifications() {
  // Dogfood fix (ISSUE-005): the "This device" web-push panel is the
  // legacy owner room's machinery. Product accounts (incl. the demo)
  // never see it — their reminders live in the Coming up panel above,
  // on the device engine. Browser-shaped guidance (Home Screen steps)
  // has no place inside the packaged app or another platform's browser.
  const legacyPanel = accountMode === "legacy";
  $("#content").innerHTML = `
    <section class="hero">
      <h2>${esc(t("nav.notifications"))}</h2>
    </section>
    ${comingUpHtml()}
    ${legacyPanel ? `
    <section class="panel notif-panel">
      <div class="panel-head"><h3>${esc(t("device.title"))}</h3></div>
      ${/iPhone|iPad/.test(navigator.userAgent || "") ? `<p class="notif-ios">${esc(t("device.iosLine"))}</p>` : ""}
      <p class="notif-status" id="notifStatus">${esc(t("device.checking"))}</p>
      <div class="notif-actions">
        <button class="btn primary" id="notifEnable" hidden>${esc(t("device.enable"))}</button>
        <button class="btn soft" id="notifTest" hidden>${esc(t("device.test"))}</button>
      </div>
      <p class="form-note" id="notifNote"></p>
    </section>` : ""}`;
  initRemindersLine();
  if (legacyPanel) initNotifications();
}

async function initNotifications() {
  const status = $("#notifStatus"), note = $("#notifNote");
  const enableBtn = $("#notifEnable"), testBtn = $("#notifTest");
  if (!status) return;
  if (accountMode === "user") {
    // A user's device subscription never rides the owner room's
    // legacy push table — per-user notifications arrive with the
    // connections slice. Say so plainly; call nothing.
    status.textContent = t("device.userLine");
    return;
  }
  if (previewMode) {
    status.textContent = t("device.preview");
    return;
  }
  if (!pushSupported()) {
    status.textContent = t("device.unsupported");
    return;
  }
  const reg = swReg || (await registerPushSW());
  if (!reg) { status.textContent = t("device.noStart"); return; }
  const paint = async () => {
    const sub = await reg.pushManager.getSubscription().catch(() => null);
    if (Notification.permission === "denied") {
      status.textContent = t("device.blocked");
      enableBtn.hidden = true; testBtn.hidden = true;
    } else if (sub) {
      status.textContent = t("device.on");
      enableBtn.hidden = true; testBtn.hidden = false;
    } else {
      status.textContent = t("device.off");
      enableBtn.hidden = false; testBtn.hidden = true;
    }
  };
  enableBtn.addEventListener("click", async () => {
    note.textContent = "";
    try {
      const { public_key } = await callPublic({ action: "push_vapid_public" });
      if (!public_key) throw new Error(t("device.serverOff"));
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { note.textContent = t("device.notEnabled"); await paint(); return; }
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(public_key) });
      await callAdmin({ action: "push_subscribe", subscription: sub.toJSON(), user_agent: navigator.userAgent });
      note.textContent = t("device.subscribed");
    } catch (err) { note.textContent = err.message; }
    await paint();
  });
  testBtn.addEventListener("click", async () => {
    note.textContent = t("device.sending");
    try {
      const res = await callAdmin({ action: "push_test" });
      const okCount = (res.results || []).filter((x) => x.status >= 200 && x.status < 300).length;
      note.textContent = res.sent
        ? (res.sent === 1 ? t("device.testSentOne", { ok: okCount }) : t("device.testSentMany", { sent: res.sent, ok: okCount }))
        : t("device.noDevices");
    } catch (err) { note.textContent = err.message; }
  });
  await paint();
}

// ---------------------------------------------------------------- boot
// Language layer: the document carries the active language, and
// a language switch re-renders through the shell's own paths
// (the door if signed out, the full shell if inside).
function applyDocLang() {
  try { document.documentElement.lang = lang() === "es" ? "es" : "en-AU"; } catch {}
}
onLangChange(() => {
  applyDocLang();
  const wasTour = tourActive;
  closeTourOverlayEl();
  if (document.querySelector("#shell")) renderShell();
  else renderLogin();
  if (wasTour) paintTour();
});
try { window.__rueflySetLang = setLang; } catch {}

// Dogfood fix (R-003): while the Firebase auth state is still
// unknown, paint a quiet loading door (mark + name, no form) —
// never the signed-out door. A returning user whose session is
// still restoring used to see the full sign-in door for seconds
// and believe they were signed out.
function renderBootSplash() {
  applyDocLang();
  $("#app").innerHTML = `
  <main class="door-wrap">
    <section class="door-page">
      <div class="door-mark"><img src="/icons/mark.svg" alt="" /></div>
      <h1 class="door-name">Ruefly</h1>
      <p class="door-sub">${esc(t("account.oneMoment"))}</p>
    </section>
  </main>`;
}

async function boot() {
  // P3 slice 2: a signed-in Firebase user lives on the per-user base —
  // their data, under their uid, and nothing of the owner room's.
  if (accountMode === "user" && fbUser) { await enterUserMode(); return; }
  if (FIREBASE_ON && fbUser === undefined) { renderBootSplash(); return; }
  if (LIVE && supabase && !session) {
    const saved = await supabase.auth.getSession();
    session = saved.data.session;
  }
  if (!hasAccess()) return renderLogin();
  try {
    await loadData();
    renderShell();
  } catch (err) {
    renderLogin(err.message);
  }
}
// Tab and page switches happen in place: the sidebar and its scroll stay
// put, only the nav highlight, the top title and the content change.
function navigate() {
  socialsNote = "";
  // Dogfood fix (ISSUE-001): a view switch closes every transient
  // overlay (post editor, connect sheet, popups). An editor left open
  // in the Planner must never ride on top of Brands or Account.
  document.querySelectorAll(".upgrade-overlay").forEach((el) => el.remove());
  // Dogfood fix (ISSUE-007): on a phone, picking a destination closes
  // the menu — the tap means "go there", and the page must be what
  // the user sees next. The open-menu shape itself is unchanged.
  if (window.matchMedia("(max-width: 720px)").matches) {
    const shell = document.querySelector("#shell");
    if (shell && !shell.classList.contains("nav-closed")) {
      shell.classList.add("nav-closed");
      navClosedSession = true;
      const mb = document.querySelector("#menuBtn");
      if (mb) mb.setAttribute("aria-expanded", "false");
    }
  }
  const r = route();
  const wantSlug = r.page === "worker" ? r.slug : null;
  if (wantSlug !== shellWorkerSlug) {
    shellWorkerSlug = wantSlug;
    refreshWorkerGroups(r);
  }
  if ((r.page === "notifications" || r.page === "account") && !navMoreOpen) {
    navMoreOpen = true;
    const mg = document.querySelector("#moreGroup");
    if (mg) mg.classList.add("open");
    const mt = document.querySelector("#moreToggle");
    if (mt) { mt.setAttribute("aria-expanded", "true"); const cv = mt.querySelector(".more-chev"); if (cv) cv.textContent = "▾"; }
  }
  document.querySelectorAll(".side-link[data-slug]").forEach((a) => {
    a.classList.toggle("on", a.dataset.slug === (r.slug || ""));
  });
  document.querySelectorAll(".side-link[data-nav]").forEach((a) => {
    a.classList.toggle("on", r.page === a.dataset.nav);
  });
  if (ROOM_FEATURES) {
    document.querySelectorAll(".side-sub[data-slug]").forEach((a) => {
      a.classList.toggle("on", r.page === "worker" && a.dataset.slug === r.slug && a.dataset.sub === r.sub);
    });
  }
  const title = document.querySelector(".top-title b");
  if (title) title.textContent = pageName(r);
  renderContent(r);
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", () => {
  if ((!hasAccess() && accountMode !== "user") || !DATA) return;
  if (document.querySelector("#shell")) navigate();
  else renderShell();
});
if (supabase) supabase.auth.onAuthStateChange((_e, s) => { session = s; if (s) boot(); });
// Accounts phase P1: dormant Firebase shell — no-op until Ilse's Firebase
// project exists (see src/firebase.js). Changes nothing while dormant.
let fbUser = undefined; // undefined = not known yet, null = signed out
let fbMsg = "";
if (FIREBASE_ON) {
  let fbKnown = false;
  watchFirebaseUser((u) => {
    const firstKnown = !fbKnown;
    fbKnown = true;
    fbUser = u;
    // A sign-out tears any tour surface down with the session.
    if (!u) { tourActive = false; tourPending = false; reofferPending = false; closeTourOverlayEl(); }
    if (u) { enterUserMode(); return; }
    // First answer "signed out": replace the boot splash with the
    // real door (R-003) — later sign-outs take the paths below.
    if (firstKnown && accountMode !== "user") { renderLogin(); return; }
    if (accountMode === "user") { exitUserMode(t("auth.signedOut")); return; }
    if (route().page === "account" && document.querySelector("#content")) renderContent(route());
  });
  completeEmailLink().then((u) => { if (u) fbMsg = t("auth.signedIn"); }).catch(() => {});
}
boot();
registerPushSW();
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", sendPushConfig);
}
