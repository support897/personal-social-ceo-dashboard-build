// Accounts phase P3, slice 2 — the per-user data layer (Ruefly).
// Mirrors slice 1 (Needs Me) exactly in shape; only the collection
// set and the demo fixture differ.
//
// Every record a signed-in user owns lives under users/{uid}/ in
// Firestore (DATA-MODEL.md: one Supabase table -> one collection, same
// record shapes the app already renders). The uid IS the address; the
// Security Rules (accounts/firestore.rules v2.2) are the wall — this
// module only ever builds paths inside the caller's own folder.
//
// DETACHMENT LAW (standing): nothing here references the founder's
// own accounts in any form. A user's space holds only their own
// workers, their own connected-account rows, and their own content;
// the demo fixture is invented-only (Marina's Bakery / Coastline
// Yoga — nobody real).
//
// Modes this serves:
//  - a real account (email link / Google / Apple): first sign-in
//    creates the profile doc EMPTY (Empty Start law) and nothing else;
//  - a demo session (SPARK): an ANONYMOUS session. Before it may read
//    or write anything under users/, it must hold an unlock record at
//    _unlocks/{uid} whose codeHash equals the desk-held hash at
//    _demo/config — the RULES check that on every request, so this
//    module writes the unlock first, then seeds the invented fixture
//    into the session's own space. Demo data can never reach a real
//    account: no link, no merge, no upgrade path exists here.
//
// Law E hook: the profile doc carries the background choice
// (white / black / brand / uploaded + image ref). The full picker UI
// is a later slice; the field and its read/write path live here.
import { firebaseDb, firebaseFirestore } from "app-firebase";
import DEMO_SEED from "./demo-seed.json";

// PRODUCTION demo code — set 15 Oct 2026, desk-set. This replaces
// the pre-production placeholder. The code's SHA-256 hash is
// held in the production project's _demo/config; the app hashes
// whatever code it is given at runtime (below) for the _unlocks
// record, so the plaintext constant here is the single source.
export const DEMO_CODE_PLACEHOLDER = "RUEFLY-DEMO-7391";

let fsPromise = null;
function fs() {
  // The Firestore module arrives ONLY through the app-firebase alias
  // (firebaseFirestore in src/firebase.js) — never a direct package
  // import — so the FIREBASE_OFF stub swap removes every Firestore
  // byte from the bundle (SR-F3; slice 1 QA F1, not repeated here).
  if (!fsPromise) fsPromise = firebaseFirestore();
  return fsPromise;
}

// Firestore stores no `undefined`; records in this app are plain JSON,
// so a round-trip is the honest sanitiser (drops undefined, keeps the
// rest byte-shaped).
const clean = (o) => JSON.parse(JSON.stringify(o ?? null));
const nowIso = () => new Date().toISOString();

// ------------------------------------------------------------- profile
// The profile doc (users/{uid} itself). Created EMPTY at first
// sign-in — no workers, no content, guide state fresh (not finished).
// NEVER carries a plan-shaped key: the rules refuse plan/planSource/
// comp/role/owner on every write under users/, and entitlement
// resolves from the desk-held _comp record, not from here.
export function emptyProfile() {
  return {
    // ONE canonical name key: "name" (dogfood B-002). The doc used
    // to also carry an empty "displayName" twin that nothing read —
    // a future surface reading the other key could silently
    // disagree with the greeting. The demo seed profile below sets
    // displayName deliberately as its persona mirror (the demo
    // Account line reads it); real profiles never carry it.
    name: "",
    // Guide state: the standing card fields (step / finished /
    // hidden) plus the v4 tour's fields (tourStep / tourDone /
    // nameSkipUnanswered / nameReoffered — see src/tour.js).
    // Older profiles carry only the first three; the tour reads
    // the rest as defaults.
    guide: { step: 0, finished: false, hidden: false, tourStep: 0, tourDone: false, tourPresented: false, nameSkipUnanswered: false, nameReoffered: false },
    background: { choice: "brand", imageRef: null, previous: null },
    // Build 3 (connection layer): the BYO-key AI chat's consent
    // record, per provider — { openai: { at }, ... }. Consent is
    // taken on the surface BEFORE any key or call (SR 5.1.2(i));
    // only the fact + time of consent live here, never a key.
    aiConsent: {},
    connections: {},
    createdAt: nowIso(),
  };
}

// ------------------------------------------------------------- paths
// The ONLY path builders in the layer — every one is rooted at the
// caller's own users/{uid}. (Grep target for the scoping proof.)
async function userDoc(db, uid) {
  const { doc } = await fs();
  return doc(db, "users", uid);
}
async function userColl(db, uid, name) {
  const { collection } = await fs();
  return collection(db, "users", uid, name);
}
async function userItem(db, uid, name, id) {
  const { doc } = await fs();
  return doc(db, "users", uid, name, id);
}
async function userMeta(db, uid, name) {
  const { doc } = await fs();
  return doc(db, "users", uid, "meta", name);
}

// ------------------------------------------------------------- peek
// Read-only profile peek: does a profile doc exist yet, and does
// it already carry a name? Creates nothing, writes nothing.
// (It served the retired door-first name step; the v4 tour asks
// the name inside the app instead. The peek stays as a store
// primitive — loadUserSpace's isNew flag drives the tour now.)
export async function peekProfile(user) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { getDoc } = await fs();
  const snap = await getDoc(await userDoc(db, user.uid));
  if (!snap.exists()) return { exists: false, name: "" };
  return { exists: true, name: String((snap.data() || {}).name || "").trim() };
}

// ------------------------------------------------------------- load
// Reads the whole space for `user` and assembles the DATA shape the
// app already renders ({ supervisor, socials, rename, workers }) —
// the worker assembly mirrors the admin-api door field for field:
// status joined on slug, research / experiments / deliverables
// grouped per worker, the newest roll-up, and the per-worker meta
// (experiments note / cases / socials) with the API's own defaults.
// First sign-in (no profile doc yet):
//   - real account -> the empty profile is created (Empty Start) and
//     every collection simply reads back empty;
//   - anonymous     -> the caller must unlockDemo() + seedDemoSpace()
//     first (the rules deny anon reads/writes before the unlock), so
//     a missing profile here is an error the caller surfaces.
// Returns { data, profile, isNew }.
export async function loadUserSpace(user, opts = {}) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { getDoc, getDocs, setDoc } = await fs();
  const uid = user.uid;
  const isAnon = Boolean(user.isAnonymous);

  const profSnap = await getDoc(await userDoc(db, uid));
  let profile;
  let isNew = false;
  if (profSnap.exists()) {
    profile = { ...emptyProfile(), ...profSnap.data() };
    // B-002 tidy: a real profile that still carries the retired
    // displayName twin drops it here; the next whole-doc save
    // cleans the stored doc. Demo seed profiles (personaName set)
    // keep their deliberate persona mirror.
    if (!profile.personaName && "displayName" in profile) delete profile.displayName;
  } else if (isAnon) {
    throw new Error("demo-not-unlocked");
  } else {
    profile = emptyProfile();
    // Name-ask (her ruling, 15 Oct): the name typed at sign-up rides
    // THIS first write — the same doc, never a second one. Provider
    // sign-ups (Google/Apple) carry the provider profile's display
    // name the same way, no extra prompt. An existing profile is
    // never renamed here: this branch runs only at creation.
    const signupName = String((opts && opts.signupName) || user.displayName || "").trim();
    if (signupName) profile.name = signupName;
    // CEO counters (aggregates writer): the signup IS this create,
    // so the people counter rides in the SAME batch — the drafted
    // rules delta pairs the two and refuses one without the other.
    // (Anonymous sessions never reach this branch: they throw
    // above, so a demo session can never count as a signup.) Until
    // the delta publishes, v2.2 denies the counter write; the
    // batch then fails whole and the profile create retries alone,
    // so a counter can never break a sign-in.
    try {
      const { doc, writeBatch, increment } = await fs();
      const batch = writeBatch(db);
      batch.set(await userDoc(db, uid), clean(profile));
      batch.set(doc(db, "_owner", "aggregates", "people", "main"),
        { total: increment(1), weekly: { [weekKey()]: increment(1) } }, { merge: true });
      await batch.commit();
    } catch {
      await setDoc(await userDoc(db, uid), clean(profile));
    }
    isNew = true;
  }

  const readColl = async (name) => {
    const snap = await getDocs(await userColl(db, uid, name));
    return snap.docs.map((d) => ({ ...d.data(), key: d.id }));
  };
  const [workersRaw, statusRaw, researchRaw, experimentsRaw,
    deliverablesRaw, rollupsRaw, plannedPostsRaw, captionLibraryRaw,
    brandsRaw, connectionsRaw, aiDraftsRaw, appMetaSnap, workerMetaSnap] = await Promise.all([
    readColl("workers"), readColl("workerStatus"), readColl("workerResearch"),
    readColl("workerExperiments"), readColl("workerDeliverables"), readColl("workerRollups"),
    readColl("plannedPosts"), readColl("captionLibrary"), readColl("brands"),
    // Build 3 (connection layer): the user's OWN connected-account
    // records (display + state only — a platform token never lives
    // in Firestore for the product) and their BYO-key AI drafts.
    readColl("connections"), readColl("aiDrafts"),
    getDoc(await userMeta(db, uid, "app")),
    getDoc(await userMeta(db, uid, "worker")),
  ]);
  const appMeta = appMetaSnap.exists() ? appMetaSnap.data() : {};
  const workerMetaBy = (workerMetaSnap.exists() ? workerMetaSnap.data().byWorker : null) || {};

  // Workers assemble exactly like the Supabase door did: the base
  // record plus its status / research / experiments / deliverables /
  // roll-up, joined on the worker slug, in the API's own orders
  // (research newest first, experiments by check date, deliverables
  // newest first, the newest roll-up only).
  const bySlug = (rows) => { const m = {}; for (const r of rows) m[r.worker_slug || r.key] = r; return m; };
  const statusBy = bySlug(statusRaw);
  const rollupBy = {};
  for (const r of rollupsRaw) {
    const s = r.worker_slug || r.key;
    if (!rollupBy[s] || String(r.week_of || "") > String(rollupBy[s].week_of || "")) rollupBy[s] = r;
  }
  const groupBy = (rows) => {
    const m = {};
    for (const r of rows) { const s = r.worker_slug || r.key; (m[s] = m[s] || []).push(r); }
    return m;
  };
  const byDateDesc = (field) => (a, b) => String(b[field] || "").localeCompare(String(a[field] || ""));
  const researchBy = groupBy(researchRaw);
  for (const s in researchBy) researchBy[s].sort(byDateDesc("entry_date"));
  const experimentsBy = groupBy(experimentsRaw);
  for (const s in experimentsBy) experimentsBy[s].sort((a, b) => String(a.check_date || "").localeCompare(String(b.check_date || "")));
  const deliverablesBy = groupBy(deliverablesRaw);
  for (const s in deliverablesBy) deliverablesBy[s].sort(byDateDesc("delivered_on"));

  const workers = workersRaw.map((w) => {
    const slug = w.slug || w.key;
    const { key, ...base } = w;
    const meta = workerMetaBy[slug] || {};
    return {
      ...base, slug,
      status: statusBy[slug] || w.status || null,
      research: researchBy[slug] || [],
      experiments: experimentsBy[slug] || [],
      deliverables: deliverablesBy[slug] || [],
      rollup: rollupBy[slug] || null,
      experiments_note: meta.experiments_note ?? "",
      cases: meta.cases ?? null,
      socials: meta.socials ?? null,
    };
  });

  const data = {
    supervisor: appMeta.supervisor ?? null,
    socials: appMeta.socials ?? [],
    rename: appMeta.rename ?? null,
    alerts: appMeta.alerts ?? [],
    workers,
    // The planner (Build 1): the user's own planned posts, their
    // saved caption + hashtag groups, and their brand records
    // (users/{uid}/brands — the key planned posts point at).
    plannedPosts: plannedPostsRaw,
    captionLibrary: captionLibraryRaw,
    // Brands (Build 2, the brands workspace): the user's own brand
    // records. The doc id rides as `id` (the brands workspace's key)
    // AND stays as `key` (the planner's key) — both gated consumers
    // read their proven shape; oldest first, the order the user
    // made them in.
    brands: brandsRaw
      .map((b) => ({ ...b, id: b.key }))
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || ""))),
    // Build 3: connections keyed by their doc id (the platform),
    // in the platform order the panel renders; AI drafts newest
    // first. Both are the signed-in user's own records only.
    connections: connectionsRaw,
    aiDrafts: aiDraftsRaw.slice().sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
  };
  return { data, profile, isNew };
}

// ------------------------------------------------------------- writes
// One record, written whole (repair-never-drops: the app always holds
// the full record in memory, so a whole-record write loses nothing).
export async function saveUserRecord(user, collectionName, id, record) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { setDoc } = await fs();
  await setDoc(await userItem(db, user.uid, collectionName, id), clean(record));
  // CEO activation (pattern R1): this app's core action is the
  // FIRST POST SCHEDULED. A deliverable written with a scheduled
  // state is that event in the per-user layer — the stamp and
  // counter ride the same write (see noteCoreAction below).
  if (collectionName === "workerDeliverables" && record
    && (record.scheduled_for || record.status === "scheduled" || record.state === "scheduled")) {
    await noteCoreAction(user);
  }
}

// One record, removed — the user's own hand on their own record
// (the planner's "Delete this post" rides this). Same path
// discipline as every write here: inside the caller's own folder.
export async function deleteUserRecord(user, collectionName, id) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { deleteDoc } = await fs();
  await deleteDoc(await userItem(db, user.uid, collectionName, id));
}

// One record removed, by its owner, from their own space (the
// connection layer's Disconnect and the AI drafts' delete ride
// this). The path is built by the same userItem builder as every
// other path in the layer, so it can only ever aim inside the
// caller's own users/{uid}.
export async function removeUserRecord(user, collectionName, id) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { deleteDoc } = await fs();
  await deleteDoc(await userItem(db, user.uid, collectionName, id));
}

// The profile doc, written whole (guide state, Law E background,
// display name). Same never-a-plan-key rule as at creation.
// The entitlement record (Payments Chapter §3): _entitlements/{uid},
// written ONLY by the system side (the webhook receivers; the
// rules deny every client write). The client reads its own record
// at entry; gates consult it through plans.js, and free features
// never read it at all. A missing record — or a read the rules or
// the network refuse — reads as null: paid fails closed, and the
// free rules decide (plans.js resolvePlan).
export async function loadEntitlement(user) {
  const db = await firebaseDb();
  if (!db || !user) return null;
  try {
    const { doc, getDoc } = await fs();
    const snap = await getDoc(doc(db, "_entitlements", user.uid));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

export async function saveUserProfile(user, profile) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { setDoc } = await fs();
  // Written whole, exactly as held — unknown fields survive the trip
  // (repair-never-drops), and the shape never grows a plan-shaped key.
  await setDoc(await userDoc(db, user.uid), clean(profile));
}

// ------------------------------------------------------------- delete
// Account deletion (Apple closure F1): the user's own hand on
// their own space — the ONE lawful deletion in the app (Law B:
// the system never deletes; the user may delete their own).
// Every path aimed at sits under users/{uid}: the collections
// loadUserSpace reads (workers et al, the brands + their posts
// subcollection, the planner's plannedPosts + captionLibrary, and
// the connection layer's connections + aiDrafts), the two meta
// docs, and the profile doc itself, deleted last. Desk records are never aimed at:
// _comp/{uid} and _owner/* are rules-sealed against clients
// (allow read, write: if false — they hold desk state, not the
// user's saved content), and a demo session's _unlocks/{uid} is
// create-once by the same rules (it holds the demo code's hash,
// not user content). Resolves with the removal manifest (what
// was actually found and deleted, per collection). A failure
// throws; once any batch has committed, the error carries
// `progressed`, so the caller can speak about the partial
// state honestly instead of guessing.
export async function deleteUserSpace(user) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { collection, getDoc, getDocs, writeBatch } = await fs();
  const uid = user.uid;
  const manifest = {};
  let progressed = false;
  const commitRefs = async (refs) => {
    for (let i = 0; i < refs.length; i += 400) {
      const batch = writeBatch(db);
      for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
      await batch.commit();
      progressed = true;
    }
  };
  try {
    const profSnap = await getDoc(await userDoc(db, uid));
    // Planner delta (Build 1): plannedPosts + captionLibrary join
    // the enumeration — a deleted account leaves neither behind.
    // Build 3 delta (named): the connection layer's own records
    // and the BYO-key AI drafts are the user's saved things too,
    // so the deletion walk sweeps them with everything else.
    const collections = ["workers", "workerStatus", "workerResearch",
      "workerExperiments", "workerDeliverables", "workerRollups", "brands",
      "plannedPosts", "captionLibrary", "connections", "aiDrafts"];
    for (const name of collections) {
      const snap = await getDocs(await userColl(db, uid, name));
      const refs = [];
      let sub = 0;
      for (const d of snap.docs) {
        if (name === "brands") {
          const posts = await getDocs(collection(db, "users", uid, "brands", d.id, "posts"));
          sub += posts.docs.length;
          for (const p of posts.docs) refs.push(p.ref);
        }
        refs.push(d.ref);
      }
      if (refs.length) await commitRefs(refs);
      manifest[name] = snap.docs.length;
      if (name === "brands") manifest["brands.posts"] = sub;
    }
    let meta = 0;
    const metaRefs = [];
    for (const m of ["app", "worker"]) {
      const ref = await userMeta(db, uid, m);
      const s = await getDoc(ref);
      if (s.exists()) { metaRefs.push(ref); meta += 1; }
    }
    if (metaRefs.length) await commitRefs(metaRefs);
    manifest.meta = meta;
    if (profSnap.exists()) {
      await commitRefs([await userDoc(db, uid)]);
      manifest.profile = 1;
    } else {
      manifest.profile = 0;
    }
  } catch (e) {
    if (progressed) e.progressed = true;
    throw e;
  }
  return manifest;
}

// ------------------------------------------------------------- CEO counters
// The aggregates writer half of the CEO dashboard (pattern v2,
// contracts section 2). Source events in THIS app write their own
// counters into the owner aggregates space as narrow +1
// increments on allowlisted fields, batched with the event they
// count; the rules side is the drafted delta at
// accounts/firestore.rules.ceo-delta-ruefly.txt (Security reviews
// it; the desk publishes it at the deploy step — until then v2.2
// denies these writes and they land nowhere). Every function here
// swallows its own failures: a counter must never break the app.
// Money counters are NEVER written from a client — the payment
// path (RevenueCat / Stripe / store billing) is the only writer,
// so a dashboard money figure can never be client-shaped.
export function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const wk = 1 + Math.round((date - firstThu) / (7 * 864e5));
  return `${date.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

async function peopleCounterRef(db) {
  const { doc } = await fs();
  return doc(db, "_owner", "aggregates", "people", "main");
}

// Activation (pattern R1): this app's core action is the FIRST
// POST SCHEDULED. The first schedule stamps activatedAt on the
// profile (once, never overwritten) and — when it lands within 7
// days of signup — raises the activated-within-7-days counter in
// the same batch, so stamp and counter can never disagree.
export async function noteCoreAction(user) {
  try {
    if (!user || user.isAnonymous) return;
    const db = await firebaseDb();
    if (!db) return;
    const { getDoc, writeBatch, increment } = await fs();
    const ref = await userDoc(db, user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const p = snap.data();
    if (p.activatedAt) return;
    const at = nowIso();
    const batch = writeBatch(db);
    batch.set(ref, { activatedAt: at }, { merge: true });
    const created = Date.parse(p.createdAt || at);
    if (isFinite(created) && Date.parse(at) - created <= 7 * 864e5) {
      batch.set(await peopleCounterRef(db), { activatedWithin7d: increment(1) }, { merge: true });
    }
    await batch.commit();
  } catch { /* a counter never breaks the app */ }
}

// Session touch (contracts section 1): lastActiveAt stamps on app
// open, throttled to once a day. It also carries the returning-in-
// 7-days count (pattern R3): an activated account that comes back
// on days 2-7 raises the counter exactly once (the profile flag
// is the receipt). The passed profile is patched in place.
export async function touchSession(user, profile) {
  try {
    if (!user || user.isAnonymous || !profile) return;
    const db = await firebaseDb();
    if (!db) return;
    const today = nowIso().slice(0, 10);
    const patch = {};
    if (String(profile.lastActiveAt || "").slice(0, 10) !== today) patch.lastActiveAt = nowIso();
    let returning = false;
    if (profile.activatedAt && !profile.return7dCounted) {
      const days = Math.floor((Date.now() - Date.parse(profile.activatedAt)) / 864e5);
      if (days >= 2 && days <= 7) { returning = true; patch.return7dCounted = true; }
    }
    if (!Object.keys(patch).length) return;
    const { writeBatch, increment } = await fs();
    const batch = writeBatch(db);
    batch.set(await userDoc(db, user.uid), patch, { merge: true });
    if (returning) {
      batch.set(await peopleCounterRef(db), { returning7d: increment(1) }, { merge: true });
    }
    await batch.commit();
    Object.assign(profile, patch);
  } catch { /* a counter never breaks the app */ }
}

// ------------------------------------------------------------- demo
// SHA-256 of the access code, computed at runtime — the code itself
// is the only secret-shaped thing, and only its hash ever touches
// the database (in the _unlocks/{uid} record the rules check).
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Writes the unlock record for an anonymous session. The RULES
// refuse the write unless the hash matches _demo/config's current
// hash — a wrong code fails here, at the server, not in the UI.
export async function unlockDemo(user, code) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { doc, getDoc, setDoc } = await fs();
  const ref = doc(db, "_unlocks", user.uid);
  // A returning session already holds its record — and the rules
  // make unlock records create-once (update is denied), so a second
  // write would fail. Read first; write only when absent. Whether
  // the stored hash still matches _demo/config is judged by the
  // rules on every data request (demoUnlocked), never by this code.
  const existing = await getDoc(ref);
  if (existing.exists()) return existing.data().codeHash;
  const codeHash = await sha256Hex(code);
  await setDoc(ref, { codeHash, at: nowIso() });
  return codeHash;
}

// Seeds the invented fixture into the demo session's OWN space.
// Idempotent by construction: the caller seeds only when the profile
// doc does not exist yet, and every write is keyed by the fixture's
// own ids — a re-seed overwrites demo records with the same demo
// records and can never touch a real account (different uid space).
export async function seedDemoSpace(user) {
  const db = await firebaseDb();
  if (!db || !user) throw new Error("accounts-off");
  const { setDoc } = await fs();
  const uid = user.uid;
  const seed = DEMO_SEED;

  const profile = {
    ...emptyProfile(),
    // Demo only: displayName mirrors the persona on purpose — the
    // demo Account line reads it (B-002's named reason both exist,
    // here and nowhere else).
    displayName: seed.persona?.name || "",
    personaName: seed.persona?.name || "",
  };
  await setDoc(await userDoc(db, uid), clean(profile));

  const put = async (name, id, record) =>
    setDoc(await userItem(db, uid, name, id), clean(record));

  const statusRowBy = {};
  for (const s of seed.workerStatus || []) {
    if (s.worker) statusRowBy[s.worker] = s;
  }
  for (const w of seed.workers || []) {
    const slug = w.slug || w.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const { status, ...base } = w;
    await put("workers", slug, {
      ...base, slug,
      short: base.short || "A made-up worker for the demo.",
      accent: base.accent || "rose",
      blurb: base.blurb || "",
    });
    // The fixture carries a status twice over: the workerStatus row
    // reads as the headline line (latest), the worker's own inline
    // status as the detail — the same two fields the live door joins.
    const row = statusRowBy[slug];
    const latest = (row && row.detail) || status?.detail || "";
    const detail = row ? (status?.detail || "") : "";
    const state = (row && row.state) || status?.state || "active";
    if (latest || detail) {
      await put("workerStatus", slug, {
        worker_slug: slug,
        state,
        latest,
        detail,
        finding: "",
      });
    }
  }
  const research = seed.workerResearch || [];
  for (let i = 0; i < research.length; i++) {
    const r = research[i];
    await put("workerResearch", `demo-research-${i + 1}`, {
      worker_slug: r.worker || "",
      title: r.title || "",
      finding: r.body || "",
      entry_date: "2026-10-15",
      sources: "",
    });
  }
  const experiments = seed.workerExperiments || [];
  for (let i = 0; i < experiments.length; i++) {
    const e = experiments[i];
    await put("workerExperiments", `demo-experiment-${i + 1}`, {
      worker_slug: e.worker || "",
      title: e.title || "",
      hypothesis: e.body || "",
      metric: "",
      check_date: null,
      verdict: "",
    });
  }
  // The planner's demo (Build 1, slice B): the two made-up brands
  // also exist as brand records (the key planned posts point at),
  // and the fixture's planned posts seed under them — Marina's
  // lined up Monday / Wednesday / Friday (her status line's own
  // promise), Coastline's on Tuesday / Thursday. Dates are THIS
  // week's, on the app's Brisbane clock (a weekend visit seeds
  // next week's), so the demo's planner always shows a real week
  // of plans. Captions carry "(made up)" like every demo line.
  for (const b of seed.brands || []) {
    await put("brands", b.slug, {
      name: b.name, channels: [], createdAt: nowIso(), updatedAt: nowIso(),
    });
  }
  const monday = brisbaneWeekMonday();
  for (const p of seed.plannedPosts || []) {
    const { id, weekDay, time, ...rest } = p;
    const [y, mo, da] = monday;
    const day = new Date(Date.UTC(y, mo - 1, da) + (Number(weekDay) || 0) * 864e5);
    const [hh, mm] = String(time || "09:00").split(":").map(Number);
    await put("plannedPosts", id, {
      ...rest,
      scheduledFor: brisbaneToIso(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hh || 0, mm || 0),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
  // The fixture's alerts ride in the app meta doc (app_meta's home in
  // the model). No supervisor, no socials, no rename: the demo room
  // holds the two made-up businesses and nothing of anyone else's.
  await setDoc(await userMeta(db, uid, "app"), clean({
    supervisor: null,
    socials: [],
    rename: null,
    alerts: seed.notifications || [],
  }));
  return profile;
}

// Brisbane calendar helpers for the demo seed (the app's home
// clock, Australia/Brisbane): this week's Monday as [y, m, d] —
// a Saturday / Sunday visit seeds NEXT week's Monday, so the
// fixture week is never half over before it is seen.
function brisbaneWeekMonday() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit",
    day: "2-digit", weekday: "short",
  }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  const dow = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday] ?? 0;
  const today = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  const monday = new Date(today - dow * 864e5 + (dow >= 5 ? 7 * 864e5 : 0));
  return [monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()];
}

// A Brisbane wall time -> the UTC instant it names (the same
// two-pass offset solve the planner's composer uses).
function brisbaneToIso(y, mo, da, hh, mm) {
  const guess = Date.UTC(y, mo - 1, da, hh, mm);
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Australia/Brisbane", hour12: false, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, Number(p.hour) % 24, +p.minute, +p.second);
  return new Date(guess - (asUtc - guess)).toISOString();
}
