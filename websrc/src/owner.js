// Ruefly — CEO dashboard instance (route /owner).
// Pattern: CEO-DASHBOARD-PATTERN.md v2 + CEO-DATA-CONTRACTS.md.
//
// ACCESS: the door is the owner record. This page never checks a
// name or a list itself — it asks Firestore for one aggregates
// document, and the Security Rules (v2.2) answer only when the
// signed-in identity is on the desk-held owner record. Any other
// answer (denied, signed out, no owner record yet) and the page
// shows its plain sign-in state and nothing else. Fail closed.
//
// DETACHMENT LAW binds this surface exactly as it binds the
// product: this dashboard is the founder's own CEO surface, it is
// never linked from any product surface, and nothing here reaches
// a product account — the two never meet.
//
// READS: aggregates ONLY. Every number below comes from a
// precomputed document under the owner aggregates space — this
// file builds no path into any per-user folder and reads no
// individual record (TW-4 / NS-1: numbers, never people). Until
// real events exist, every figure reads an honest zero.
import {
  FIREBASE_ON, firebaseDb, firebaseFirestore, watchFirebaseUser,
  completeEmailLink, signInWithPassword, sendPasswordReset, signInGoogle, signInApple, signOutUser,
} from "app-firebase";

const APP = {
  name: "Ruefly",
  activationText: "first post scheduled",
  cast: [
    { id: "camila", name: "Camila" },
    { id: "helen", name: "Helen" },
  ],
};

const root = document.getElementById("ownerRoot");
const whoLine = document.getElementById("whoLine");
const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CUR = { AUD: "A$", USD: "$", EUR: "€", GBP: "£" };
const money = (cents, cur) => (CUR[cur] || (cur ? cur + " " : "A$")) + (num(cents) / 100).toFixed(2);

function weekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const wk = 1 + Math.round((date - firstThu) / (7 * 864e5));
  return `${date.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}
const thisWeek = () => weekKey(new Date());
function inThisWeek(iso) {
  if (!iso) return false;
  const d = new Date(iso);
  return !isNaN(d) && weekKey(d) === thisWeek();
}

// ------------------------------------------------------------- door
function renderDoor(note) {
  whoLine.textContent = "";
  root.innerHTML = `
  <section class="card" id="doorBox">
    <h2 style="margin-top:0">Sign in</h2>
    <p class="hint">This page is for the owner only. Everyone else gets a plain no.</p>
    ${note ? `<p class="hint">${esc(note)}</p>` : ""}
    <label>Email<input id="doorEmail" type="email" autocomplete="email" placeholder="you@example.com"></label>
    <label>Password<input id="doorPassword" type="password" autocomplete="current-password" placeholder="Your password"></label>
    <p><button class="act" id="doorPwSignIn">Sign in</button>
       <button class="ghost" id="doorReset">Forgot password? Email me a reset link</button></p>
    <p><button class="ghost" id="doorGoogle">Continue with Google</button>
       <button class="ghost" id="doorApple">Continue with Apple</button></p>
    <p class="msg" id="doorMsg" role="alert"></p>
  </section>`;
  const msg = (t) => { document.getElementById("doorMsg").textContent = t || ""; };
  // The door set is EXCLUSIVE (her ruling, 15 Oct): Google · Apple ·
  // email + her own password — sign-in only, no creation here. The
  // email-LINK send is retired from this surface too; the completion
  // call at the foot of this file stays, invisible, for links
  // already in flight.
  const doorCreds = () => ({
    email: document.getElementById("doorEmail").value.trim(),
    pw: document.getElementById("doorPassword").value || "",
  });
  document.getElementById("doorPwSignIn").addEventListener("click", async () => {
    const { email, pw } = doorCreds();
    if (!email) { msg("Type your email first."); return; }
    if (!pw) { msg("Type your password first."); return; }
    try { await signInWithPassword(email, pw); }
    catch (err) {
      const code = (err && err.code) || "";
      if (code.includes("wrong-password") || code.includes("user-not-found") || code.includes("invalid-credential")) msg("Email or password did not match.");
      else if (code.includes("too-many-requests")) msg("Too many tries. Wait a little and try again.");
      else msg("Sign in did not finish.");
    }
  });
  document.getElementById("doorReset").addEventListener("click", async () => {
    const { email } = doorCreds();
    if (!email) { msg("Type your email first."); return; }
    try { await sendPasswordReset(email); msg("Reset link sent. Check your email to pick a new password."); }
    catch { msg("That did not send. Check the email and try again."); }
  });
  document.getElementById("doorGoogle").addEventListener("click", async () => {
    try { await signInGoogle(); } catch { msg("Google sign in did not finish."); }
  });
  document.getElementById("doorApple").addEventListener("click", async () => {
    try { await signInApple(); } catch { msg("Apple sign in did not finish."); }
  });
}

function renderDenied(email) {
  whoLine.textContent = email || "";
  root.innerHTML = `
  <section class="card" id="deniedBox">
    <h2 style="margin-top:0">Not available</h2>
    <p class="hint">This page is not available for this account.</p>
    <p><button class="ghost" id="deniedOut">Sign out</button></p>
  </section>`;
  document.getElementById("deniedOut").addEventListener("click", () => { signOutUser().catch(() => {}); });
}

// ==== DATA SOURCE ====
// The gate + every read live between these markers and nowhere
// else in the file: one probe document decides the door, then the
// section documents load tolerantly (a missing document reads as
// an honest empty, never an error).
async function probeOwner() {
  const db = await firebaseDb();
  if (!db) return false;
  const { doc, getDoc } = await firebaseFirestore();
  try {
    await getDoc(doc(db, "_owner", "aggregates", "people", "main"));
    return true;
  } catch {
    return false;
  }
}

async function loadAggregates() {
  const db = await firebaseDb();
  const { doc, getDoc } = await firebaseFirestore();
  const read = async (...path) => {
    try {
      const snap = await getDoc(doc(db, ...path));
      return snap.exists() ? (snap.data() || {}) : {};
    } catch { return {}; }
  };
  const [people, moneyDoc, feed, reviews, outreach, community, avatars, appDoc, overview] =
    await Promise.all([
      read("_owner", "aggregates", "people", "main"),
      read("_owner", "aggregates", "money", "main"),
      read("_owner", "aggregates", "money", "feed"),
      read("_owner", "aggregates", "reviews", "main"),
      read("_owner", "aggregates", "outreach", "main"),
      read("_owner", "aggregates", "community", "main"),
      read("_owner", "aggregates", "avatars", "main"),
      read("_owner", "aggregates", "app", "main"),
      read("_owner", "aggregates", "overview", "main"),
    ]);
  return { people, moneyDoc, feed, reviews, outreach, community, avatars, appDoc, overview };
}
// ==== END DATA SOURCE ====

// ------------------------------------------------------------- avatars
// Per-piece rows (contracts section 4) roll up per presenter. A
// sale counts ONLY when the payment record names the piece — a
// row whose sales are not numeric-verified is carried as "could
// not verify" and never enters the totals. A piece missing any
// trust rail (disclosure, AI label, metadata-zero) is held back
// from every count and named in a quiet note — no alarm styling.
function rollupAvatars(pieces) {
  const byId = {};
  const held = [];
  for (const p of pieces || []) {
    const railsOk = p.disclosure === "y" && p.aiLabel === "y" && p.metadataZero === "y";
    if (!railsOk) { held.push(p); continue; }
    const k = String(p.presenterId || "");
    if (!k) continue;
    const cur = byId[k] || { id: k, name: p.presenterName || k, views: 0, viewsWeek: 0, sales: 0, amountCents: 0, currency: p.currency || "AUD", unverified: 0 };
    cur.views += num(p.views);
    if (inThisWeek(p.date)) cur.viewsWeek += num(p.views);
    if (typeof p.salesCount === "number") {
      cur.sales += p.salesCount;
      cur.amountCents += num(p.salesAmountCents);
    } else {
      cur.unverified += 1;
    }
    byId[k] = cur;
  }
  return { byId, held };
}

// ------------------------------------------------------------- dashboard
function renderDashboard(agg, email) {
  whoLine.textContent = email || "";
  const people = agg.people || {};
  const weekly = people.weekly && typeof people.weekly === "object" ? people.weekly : {};
  const weekRows = Object.keys(weekly).sort().map((wk) => ({ week: wk, count: num(weekly[wk]) }));
  const total = num(people.total) || num((agg.overview || {}).signups);
  const joinedWeek = num(weekly[thisWeek()]);
  const activated = num(people.activatedWithin7d);
  const share = total > 0 ? Math.round((activated / total) * 100) : 0;
  const m = agg.moneyDoc || {};
  const leaving = num(m.cancelsPending) + num(m.cancelsEnded);
  const feedEvents = Array.isArray((agg.feed || {}).events) ? agg.feed.events : [];
  const reasons = Array.isArray(m.cancelReasons) ? m.cancelReasons : [];
  const rv = agg.reviews || {};
  const inbox = Array.isArray(rv.inbox) ? rv.inbox : [];
  const out = agg.outreach || {};
  const campaigns = Array.isArray(out.campaigns) ? out.campaigns : [];
  const groups = Array.isArray((agg.community || {}).groups) ? agg.community.groups : [];
  const { byId, held } = rollupAvatars((agg.avatars || {}).pieces);
  const app = agg.appDoc || {};
  const byBrand = Array.isArray(app.postsByBrand) ? app.postsByBrand : [];

  const avatarRows = APP.cast.map((c) => {
    const a = byId[c.id] || { views: 0, viewsWeek: 0, sales: 0, amountCents: 0, currency: "AUD", unverified: 0 };
    return `<tr><td>${esc(c.name)}</td><td>${a.views}</td><td>${a.viewsWeek}</td><td>${a.sales}</td><td>${money(a.amountCents, a.currency)}</td></tr>`;
  }).join("");
  const heldNote = held.length
    ? `<p class="hint">${held.length} piece${held.length === 1 ? "" : "s"} held back: missing a trust rail (disclosure, AI label or metadata-zero), so ${held.length === 1 ? "it is" : "they are"} not in the counts above.</p>`
    : "";
  const unverifiedNote = APP.cast.some((c) => (byId[c.id] || {}).unverified)
    ? `<p class="hint">Some pieces carry sales marked "could not verify" (the payment record does not name the piece). Those are never counted as sales.</p>`
    : "";

  root.innerHTML = `
  <section id="dashBox">
    <div class="layout">
      <nav class="side" id="dashNav">
        <button data-sec="overview" class="on">Overview</button>
        <button data-sec="people">People</button>
        <button data-sec="money">Money</button>
        <button data-sec="reviews">Reviews</button>
        <button data-sec="outreach">Outreach</button>
        <button data-sec="community">Community</button>
        <button data-sec="avatars">Avatars</button>
        <button data-sec="app">Posts &amp; brands</button>
      </nav>
      <div>
        <div class="card" data-panel="overview">
          <h2 style="margin-top:0">This week, at a glance</h2>
          <div class="grid">
            <div><div class="num" id="ovJoined">${joinedWeek}</div><div class="lbl">joined this week (${total} all time)</div></div>
            <div><div class="num" id="ovMoney">${num(m.paying)}</div><div class="lbl">paying</div></div>
            <div><div class="num" id="ovLeaving">${leaving}</div><div class="lbl">leaving (pending + ended)</div></div>
          </div>
          <h3>Weeks so far</h3>
          <table id="ovWeeks"><thead><tr><th>Week</th><th>Joined</th></tr></thead><tbody>
            ${weekRows.map((w) => `<tr><td>${esc(w.week)}</td><td>${w.count}</td></tr>`).join("")}
          </tbody></table>
          ${weekRows.length ? "" : `<p class="hint">No weeks yet. The numbers read zero until real people arrive.</p>`}
        </div>

        <div class="card" data-panel="people" hidden>
          <h2 style="margin-top:0">People</h2>
          <div class="grid">
            <div><div class="num" id="pplTotal">${total}</div><div class="lbl">signups, all time</div></div>
            <div><div class="num" id="pplWeek">${joinedWeek}</div><div class="lbl">new this week</div></div>
            <div><div class="num" id="pplAct">${activated} <span class="unit">of ${total} (${share}%)</span></div><div class="lbl">did the core action within 7 days</div></div>
            <div><div class="num" id="pplBack">${num(people.returning7d)}</div><div class="lbl">came back in days 2 to 7</div></div>
          </div>
          <p class="hint">Ruefly's core action: ${esc(APP.activationText)}. Activation counts signups who did it within 7 days of joining.</p>
        </div>

        <div class="card" data-panel="money" hidden>
          <h2 style="margin-top:0">Money</h2>
          <div class="grid">
            <div><div class="num" id="monPaying">${num(m.paying)}</div><div class="lbl">paying</div></div>
            <div><div class="num" id="monPending">${num(m.cancelsPending)}</div><div class="lbl">cancels pending (still in their paid time)</div></div>
            <div><div class="num" id="monEnded">${num(m.cancelsEnded)}</div><div class="lbl">cancels ended</div></div>
            <div><div class="num" id="monFailed">${num(m.failedPayments)}</div><div class="lbl">failed payments</div></div>
          </div>
          <h3>Monthly estimate</h3>
          <p><span class="num" id="monMrr">${money(m.mrrEstimateCents, m.mrrCurrency || "AUD")}</span> <span class="tag">ESTIMATE</span></p>
          <p class="hint">An estimate for steering only. The payment provider is the accounting truth.</p>
          <h3>Why people left (one line each)</h3>
          <table id="monReasons"><thead><tr><th>Week</th><th>Reason</th></tr></thead><tbody>
            ${reasons.map((r) => `<tr><td>${esc(r.week || "")}</td><td>${esc(r.text || "")}</td></tr>`).join("")}
          </tbody></table>
          ${reasons.length ? "" : `<p class="hint">No cancels recorded yet.</p>`}
          <h3>Subscription feed</h3>
          <p class="hint">Every subscription and payment event for Ruefly lands here, in this dashboard only (pattern R7). The feed's source is the payment setup: Apple and Google billing in the apps, Stripe on the web, one subscription brain over both.</p>
          <div id="subFeed">
            ${feedEvents.length ? feedEvents.map((e) => `
              <div class="feed-item">
                <span class="when">${esc(String(e.at || "").slice(0, 10))}</span>
                ${esc(e.kind || "event")} · ${esc(e.plan || "")} · ${esc(e.status || "")}
                ${typeof e.amountCents === "number" ? ` · ${money(e.amountCents, e.currency || "AUD")}` : ""}
                ${e.provider ? ` · via ${esc(e.provider)}` : ""}
                ${e.cancelReason ? `<div class="hint">Cancel reason: ${esc(e.cancelReason)}</div>` : ""}
              </div>`).join("") : `<p class="hint">No subscription events yet. Payments are not live in this app yet. The feed reads empty until the first real event.</p>`}
          </div>
        </div>

        <div class="card" data-panel="reviews" hidden>
          <h2 style="margin-top:0">Reviews</h2>
          <div class="grid">
            <div><div class="num" id="revCount">${num(rv.count)}</div><div class="lbl">reviews, all stores</div></div>
            <div><div class="num" id="revUnreplied">${num(rv.unreplied)}</div><div class="lbl">waiting for a reply</div></div>
            <div><div class="num" id="revStrangers">${num(rv.strangerReplies)}</div><div class="lbl">notes from people you do not know</div></div>
          </div>
          <h3>Inbox</h3>
          ${inbox.length ? inbox.map((r) => `
            <div class="feed-item">
              <span class="when">${esc(r.date || "")}</span>
              <strong>${esc(r.rating != null ? `${r.rating} stars` : "")}</strong> ${esc(r.title || "")}
              <div>${esc(r.body || "")}</div>
              <div class="hint">${esc(r.author || "")} · ${esc(r.platform || "")}${r.replied ? " · replied" : ""}</div>
            </div>`).join("") : `<p class="hint">No reviews yet. Store feeds land here when connected; until then the inbox reads empty. Never filled in by hand-waving.</p>`}
        </div>

        <div class="card" data-panel="outreach" hidden>
          <h2 style="margin-top:0">Cold email</h2>
          ${campaigns.length ? `
          <div class="grid">
            <div><div class="num">${campaigns.length}</div><div class="lbl">campaigns</div></div>
            <div><div class="num">${campaigns.reduce((s, c) => s + num(c.sent), 0)}</div><div class="lbl">sent</div></div>
            <div><div class="num">${campaigns.reduce((s, c) => s + num(c.replies), 0)}</div><div class="lbl">replies</div></div>
          </div>
          <table><thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Replies</th></tr></thead><tbody>
            ${campaigns.map((c) => `<tr><td>${esc(c.name || "")}</td><td>${esc(c.status || "")}</td><td>${num(c.sent)}</td><td>${num(c.replies)}</td></tr>`).join("")}
          </tbody></table>` : `<p class="hint">Not running yet. This area opens when outreach starts for Ruefly.</p>`}
        </div>

        <div class="card" data-panel="community" hidden>
          <h2 style="margin-top:0">Facebook groups</h2>
          <table id="grpTable"><thead><tr><th>Group</th><th>Members</th><th>Growth this week</th><th>Posts</th><th>Source</th></tr></thead><tbody>
            ${groups.map((g) => `<tr><td>${esc(g.name || "")}</td><td>${num(g.members)}</td><td>${num(g.members) - num(g.membersLastWeek)}</td><td>${num(g.postsThisWeek)}</td><td>${esc(g.source || "manual")}</td></tr>`).join("")}
          </tbody></table>
          ${groups.length ? "" : `<p class="hint">No groups tracked yet.</p>`}
        </div>

        <div class="card" data-panel="avatars" hidden>
          <h2 style="margin-top:0">Avatars</h2>
          <p class="hint">Ruefly's own presenters only. Views and sales roll up from the per-piece feed; a sale counts only when the payment record names the piece.</p>
          <table id="avTable"><thead><tr><th>Avatar</th><th>Views</th><th>Views this week</th><th>Sales</th><th>Sales amount</th></tr></thead><tbody>
            ${avatarRows}
          </tbody></table>
          ${heldNote}
          ${unverifiedNote}
        </div>

        <div class="card" data-panel="app" hidden>
          <h2 style="margin-top:0">Posts &amp; brands</h2>
          <div class="grid">
            <div><div class="num">${num(app.brands)}</div><div class="lbl">client brands</div></div>
            <div><div class="num">${num(app.postsScheduled)}</div><div class="lbl">posts scheduled</div></div>
            <div><div class="num">${num(app.postsSent)}</div><div class="lbl">posts sent</div></div>
          </div>
          <h3>Per client brand</h3>
          ${byBrand.length ? `
          <table><thead><tr><th>Brand</th><th>Scheduled</th><th>Sent</th></tr></thead><tbody>
            ${byBrand.map((b) => `<tr><td>${esc(b.brand || "")}</td><td>${num(b.scheduled)}</td><td>${num(b.sent)}</td></tr>`).join("")}
          </tbody></table>` : `<p class="hint">No brand counts yet. This panel reads aggregate counts only.</p>`}
        </div>
      </div>
    </div>
    <p><button class="ghost" id="dashOut">Sign out</button></p>
  </section>`;

  document.getElementById("dashNav").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sec]");
    if (!b) return;
    document.querySelectorAll("#dashNav button").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.getAttribute("data-panel") !== b.getAttribute("data-sec"); });
  });
  document.getElementById("dashOut").addEventListener("click", () => { signOutUser().catch(() => {}); });
}

// ------------------------------------------------------------- boot
renderDoor(FIREBASE_ON ? "" : "Accounts are off in this build, so the door cannot open here.");
completeEmailLink().catch(() => {});
watchFirebaseUser(async (person) => {
  if (!person) { renderDoor(); return; }
  if (person.isAnonymous) { renderDenied(person.email || ""); return; }
  const ok = await probeOwner();
  if (!ok) { renderDenied(person.email || ""); return; }
  const agg = await loadAggregates();
  renderDashboard(agg, person.email || "");
}).catch(() => {});
