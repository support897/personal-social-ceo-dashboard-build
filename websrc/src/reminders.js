// ------------------------------------------------------------ reminders
// PLANNER SLICE B — posting reminders, honestly.
//
// When a post is planned with a date + time, Ruefly schedules an
// ON-DEVICE local notification for that time ("Time to post" +
// the post's first words) through @capacitor/local-notifications
// (installed as a dependency this slice; the plugin registers in
// the native shell by its package name). The notification is set
// on the user's own device and fires there — no server sends
// anything, and no copy anywhere claims otherwise. On the web the
// plugin's own web implementation keeps the pending list and
// fires through the browser's Notification API, permission first.
//
// Permission discipline: the app asks ONCE, in its own voice, the
// first time a plan-with-a-time is saved (see planner.js), with a
// "Not now" that is respected — the ask never repeats on its own.
// Without permission nothing is scheduled; the in-app Coming up
// list (Notifications page) works either way.
//
// Sign-out / account deletion cancel the account's pending
// reminders (cancelAllPostReminders): a device keeps no nudges
// for an account that has left it.
import { t } from "./i18n.js";

const ASK_KEY = "ruefly.remindersAsked";
let pluginObj = null;
let pluginLoad = null;
// The plugin (and @capacitor/core with it) loads lazily, only
// when a reminder is actually touched — door and room builds
// never pay for it, and a build without the plugin installed
// fails soft to "unsupported" instead of breaking the planner.
// The plugin OBJECT is never returned through a promise: the
// Capacitor plugin proxy answers any property read with a method
// wrapper, so a promise resolving to the plugin would probe its
// ".then" and throw ("LocalNotifications.then() is not
// implemented"). loadPlugin() resolves a plain boolean; callers
// then read the object synchronously via plug().
function loadPlugin() {
  if (pluginObj) return Promise.resolve(true);
  if (!pluginLoad) {
    pluginLoad = import("@capacitor/local-notifications")
      .then((m) => { pluginObj = (m && m.LocalNotifications) || null; return Boolean(pluginObj); })
      .catch(() => false);
  }
  return pluginLoad;
}
const plug = () => pluginObj;

const webSupported = () => typeof window !== "undefined" && "Notification" in window;

// ------------------------------------------------------------ ids
// A stable per-post notification id (the post's own key, hashed
// to a positive 31-bit int): re-saving a post REPLACES its
// reminder instead of stacking a second one.
export function notifIdFor(postKey) {
  const s = String(postKey || "");
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 2000000000) + 1;
}

// ------------------------------------------------------------ permission
// One read of the device's answer: "granted" | "denied" |
// "prompt" | "unsupported". Never throws.
export async function reminderPermission() {
  try {
    if (!(await loadPlugin())) return "unsupported";
    const LN = plug();
    if (!LN) return "unsupported";
    const native = typeof window !== "undefined" && window.Capacitor
      && typeof window.Capacitor.isNativePlatform === "function"
      && window.Capacitor.isNativePlatform();
    if (!native && !webSupported()) return "unsupported";
    const res = await LN.checkPermissions();
    return (res && res.display) || "prompt";
  } catch { return "unsupported"; }
}

// Ask the device (the OS / browser prompt itself). Returns the
// state after the ask. Never throws.
export async function requestReminderPermission() {
  try {
    if (!(await loadPlugin())) return "unsupported";
    const LN = plug();
    if (!LN) return "unsupported";
    const res = await LN.requestPermissions();
    return (res && res.display) || "prompt";
  } catch { return "unsupported"; }
}

// The app's own one-time ask: has Ruefly already put its sheet
// up on this device? (The sheet's answer is remembered so the
// ask can never nag; the device permission can still be changed
// later from the Notifications page's own button.)
export function remindersAsked() {
  try { return localStorage.getItem(ASK_KEY) === "1"; } catch { return true; }
}
export function markRemindersAsked() {
  try { localStorage.setItem(ASK_KEY, "1"); } catch {}
}

// ------------------------------------------------------------ bodies
function bodyOf(post) {
  const words = String((post && post.caption) || "").trim().split(/\s+/).filter(Boolean);
  if (words.length) return words.slice(0, 9).join(" ") + (words.length > 9 ? "…" : "");
  const bits = [post && post.platform, t("reminders.noCaption")].filter(Boolean);
  return bits.join(" · ");
}

const qualifies = (post) => Boolean(post && post.state === "planned"
  && post.scheduledFor && Date.parse(post.scheduledFor) > Date.now());

// ------------------------------------------------------------ schedule
// Bring one post's device reminder in line with the post: a
// planned post with a future time gets a notification at that
// time (replacing any earlier one for the same post); anything
// else (draft, posted, past, no permission) gets none. Returns
// { scheduled, permission } so the caller can run the one-time
// ask when the device has not answered yet. Never throws.
export async function syncPostReminder(post) {
  const out = { scheduled: false, permission: "unsupported" };
  try {
    if (!post || !post.key) return out;
    if (!(await loadPlugin())) return out;
    const LN = plug();
    if (!LN) return out;
    out.permission = await reminderPermission();
    const id = notifIdFor(post.key);
    if (!qualifies(post)) {
      try { await LN.cancel({ notifications: [{ id }] }); } catch {}
      return out;
    }
    if (out.permission !== "granted") return out;
    await LN.schedule({
      notifications: [{
        id,
        title: t("reminders.title"),
        body: bodyOf(post),
        schedule: { at: new Date(post.scheduledFor), allowWhileIdle: true },
      }],
    });
    out.scheduled = true;
    return out;
  } catch { return out; }
}

export async function cancelPostReminder(postKey) {
  try {
    if (!(await loadPlugin())) return;
    const LN = plug();
    if (!LN) return;
    await LN.cancel({ notifications: [{ id: notifIdFor(postKey) }] });
  } catch {}
}

// Cancel every reminder a list of posts could own (sign-out and
// account deletion ride this): the device keeps nothing for an
// account that has left it.
export async function cancelAllPostReminders(posts) {
  try {
    const ids = (posts || []).map((p) => ({ id: notifIdFor(p && p.key) }));
    if (!ids.length) return;
    if (!(await loadPlugin())) return;
    const LN = plug();
    if (!LN) return;
    await LN.cancel({ notifications: ids });
  } catch {}
}

// Reconcile the device's pending list with the account's planned
// posts (the planner calls this on render, fire-and-forget): a
// reminder made while permission was off, or lost with a web
// session, comes back; a stale one goes. Acts only when the
// device has already granted — a render never prompts.
export async function reconcileReminders(posts) {
  try {
    if ((await reminderPermission()) !== "granted") return;
    if (!(await loadPlugin())) return;
    const LN = plug();
    if (!LN) return;
    const pending = ((await LN.getPending()) || {}).notifications || [];
    const want = new Map();
    for (const p of posts || []) if (qualifies(p)) want.set(notifIdFor(p.key), p);
    const stale = [];
    const have = new Set();
    for (const n of pending) {
      const p = want.get(n.id);
      const at = n && n.schedule && n.schedule.at ? Date.parse(n.schedule.at) : NaN;
      if (!p || at !== Date.parse(p.scheduledFor)) stale.push({ id: n.id });
      else have.add(n.id);
    }
    if (stale.length) { try { await LN.cancel({ notifications: stale }); } catch {} }
    for (const [id, p] of want) {
      if (have.has(id)) continue;
      try {
        await LN.schedule({
          notifications: [{
            id, title: t("reminders.title"), body: bodyOf(p),
            schedule: { at: new Date(p.scheduledFor), allowWhileIdle: true },
          }],
        });
      } catch {}
    }
  } catch {}
}

// ------------------------------------------------------------ the ask
// Ruefly's one permission sheet, in the app's voice: what the
// reminder is, where it lives (this device), and two honest
// buttons. Shown once — the caller checks remindersAsked() — and
// either answer marks it asked, so "Not now" is respected for
// good. onDone(state) fires with the device's answer afterwards
// ("granted" lets the caller schedule the post that earned it).
(function plantStyles() {
  if (typeof document === "undefined" || document.getElementById("remindersStyles")) return;
  const el = document.createElement("style");
  el.id = "remindersStyles";
  el.textContent = `.rm-card{text-align:left;width:min(480px,100%)}.rm-actions{display:flex;gap:10px;margin-top:16px}.rm-actions .btn{flex:1;padding:12px 10px;font-size:15px}`;
  document.head.appendChild(el);
})();

export function showReminderAsk(onDone) {
  markRemindersAsked();
  const done = (state) => { const ov = document.getElementById("reminderAskOverlay"); if (ov) ov.remove(); if (onDone) onDone(state); };
  const overlay = document.createElement("div");
  overlay.className = "upgrade-overlay";
  overlay.id = "reminderAskOverlay";
  overlay.innerHTML = `
  <section class="upgrade-card rm-card" role="dialog" aria-modal="true" aria-label="${t("reminders.askTitle")}">
    <h3 class="upgrade-title">${t("reminders.askTitle")}</h3>
    <p>${t("reminders.askBody")}</p>
    <div class="rm-actions">
      <button class="btn soft" id="rmAskNo" type="button">${t("common.notNow")}</button>
      <button class="btn primary" id="rmAskYes" type="button">${t("reminders.turnOn")}</button>
    </div>
  </section>`;
  document.body.appendChild(overlay);
  const no = overlay.querySelector("#rmAskNo");
  if (no) no.addEventListener("click", () => done("prompt"));
  const yes = overlay.querySelector("#rmAskYes");
  if (yes) yes.addEventListener("click", async () => { done(await requestReminderPermission()); });
}
