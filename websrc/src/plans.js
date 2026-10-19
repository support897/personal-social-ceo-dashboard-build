// The Ruefly shelf — the plan data of record, in src.
//
// Source of record (do not edit prices here alone): the locked
// pricing file ~/workspace/app-growth/ilse-socials/PRICING.md +
// FEATURE-SPLIT.md, stamped "PRICES APPROVED AND LOCKED — Ilse,
// 15 Oct 2026". The words below are that file's Ruefly table,
// stated in the app's planner verbs (plan / schedule in the app /
// remind / track — the product never claims to post for anyone).
//
// Entitlement (HQ ruling 15 Oct 2026, 21:59): the app reads the
// signed-in user's plan from their OWN record only — the profile
// doc (users/{uid} itself) may carry a desk-stamped `plan` field
// (a console/server write; the rules refuse plan-shaped keys on
// every client write, and no client code ever writes one — the
// resolver below is the only place a plan key is read). The
// desk-held _comp/{uid} record is NOT read here (the rules deny
// it to clients); a comp is honoured because the desk stamps the
// same value onto the profile.
//
// SUPERSEDED as the authority (Payments Chapter, 19 Oct 2026):
// the stamp model above was the pre-payments comp mechanism.
// The authority now is the ENTITLEMENT RECORD at
// _entitlements/{uid} — Finance's chapter plan §3's shape
// (app_user_id · entitlement · status · product · lane ·
// trial_ends_at · period_ends_at · expires_at · updated_at ·
// source_event_id), SYSTEM-WRITTEN ONLY (the RevenueCat and
// Stripe webhook receivers; the rules deny every client write).
// The client reads its own record and can never write it; no
// client-side "set my plan" path exists. (_unlocks/{uid} is NOT
// this record — it is the demo unlock, client-written by
// design; the two never share a document.) Resolution:
//   entitlement "plus", status trialing or active — or
//     cancelled inside its period — with the period still open
//                              -> Plus: paid, and the account cap
//                                 now BITES at PLUS_PLAN's 5
//                                 (before the chapter, a stamped
//                                 Plus sailed uncapped; the "up
//                                 to 5" was copy only — the wiring
//                                 makes it real, per the chapter's
//                                 own note on this desk's read).
//   any other record (past_due · expired · period ended · an
//     entitlement word this app does not sell) grants nothing
//                              -> the free rules below decide.
//   account under 30 days old -> the free month (the locked
//                                 file's shape: the full app free
//                                 to start): sails, no cap.
//   older, no live entitlement -> Free Forever: the cap applies
//                                 at FREE_PLAN's 2.
//   age cannot be told (no readable createdAt on the profile)
//                              -> the cap must NOT bite: sails,
//                                 state "unknown" (a named gap:
//                                 such a record is never capped
//                                 until its age can be proven).
// The stamp read is DELETED with this wiring — one authority,
// no halves. Profiles still carrying a stamp (the owner's own
// free-forever pin above all) get their entitlement record
// written system-side BEFORE any build carrying this resolver
// dispatches; that migration is a named gate of the round.
// Free features never read the record at all.
// The profile's createdAt lives at the TOP LEVEL of the profile
// doc — emptyProfile() in user-store.js stamps it there on the
// profile's first write, and loadUserSpace merges the stored doc
// over that shape. That top-level field is what resolvePlan
// reads. The Plans page sells nothing either way: paying is not
// switched on in the app yet.
//
// Studio (A$19.99/mo or A$159.99/yr in the locked file) is a
// LATER tier: the file's own rule is sell it only when its extras
// are built, so it is named on the Plans page as coming later and
// carries no price in the app.

export const FREE_PLAN = {
  id: "free",
  name: "Free Forever",
  priceLine: "A$0",
  accountsCap: 2,
  points: [
    "Visual calendar for your own accounts",
    "Drafts and planned posts: unlimited",
    "Up to 2 connected accounts",
    "Posting reminders, so you can post by hand on time",
    "Captions and hashtag groups, saved and reused",
    "Data export: your drafts and plans are yours",
  ],
};

export const PLUS_PLAN = {
  id: "plus",
  name: "Plus",
  priceMonthly: "A$9.99/mo",
  priceYearly: "A$79.99/yr",
  priceLine: "A$9.99/mo or A$79.99/yr",
  accountsCap: 5,
  points: [
    "Everything in Free Forever",
    "Up to 5 connected accounts",
    "Plan and schedule for all of them in one calm calendar",
    "Captions and hashtag library without limits",
  ],
};

// The free plan's account edge: the moment the upgrade popup
// exists for. A signed-in (never demo) user at this count who
// taps "Add an account" has hit the free plan's own limit — the
// locked split puts accounts 3–5 in Plus.
export const FREE_ACCOUNT_CAP = FREE_PLAN.accountsCap;

export const FREE_MONTH_DAYS = 30;

// The chapter's unlock rule (§3), the ONLY paid rule: the record
// opens Plus when it names the "plus" entitlement with status
// trialing or active — or cancelled, which keeps what was paid
// for until the period ends — and the period has not ended.
// Everything else (no record, past_due, expired, an ended period,
// an entitlement word this app does not sell) opens nothing.
export function plusEntitlementOpen(entitlement, now = Date.now()) {
  if (!entitlement || typeof entitlement !== "object") return false;
  if (String(entitlement.entitlement || "").trim().toLowerCase() !== "plus") return false;
  const status = String(entitlement.status || "").trim().toLowerCase();
  if (status !== "trialing" && status !== "active" && status !== "cancelled") return false;
  const ends = Date.parse(entitlement.period_ends_at || "");
  if (isFinite(ends) && ends <= now) return false;
  return true;
}

// Resolve the signed-in user's plan state from their profile
// (its age, for the in-app month) and their entitlement record
// (the paid authority — see the note at the head of this file).
// Pure — the logic harness drives this exact function.
export function resolvePlan(profile, entitlement) {
  if (plusEntitlementOpen(entitlement)) {
    return { key: "plus", name: PLUS_PLAN.name, paid: true, capApplies: true, accountsCap: PLUS_PLAN.accountsCap };
  }
  const created = Date.parse((profile && profile.createdAt) || "");
  if (!isFinite(created)) return { key: "unknown", name: "", paid: false, capApplies: false };
  const ageDays = (Date.now() - created) / 864e5;
  if (ageDays < FREE_MONTH_DAYS) return { key: "month", name: "Free month", paid: false, capApplies: false };
  return { key: "free", name: FREE_PLAN.name, paid: false, capApplies: true, accountsCap: FREE_PLAN.accountsCap };
}

// The cap decision for an "Add an account" tap: capped only when
// the resolved state carries a cap AND the user already holds
// that cap — Free Forever's 2, or Plus's 5 (a Plus member adding
// a sixth account meets the same popup; its Plus-shaped words
// are the enabling build's copy pass). The free month and the
// unreadable state sail, as they always have.
export function accountCapHit(profile, count, entitlement) {
  const state = resolvePlan(profile, entitlement);
  const n = Number.isFinite(count) ? count : 0;
  if (!state.capApplies) return { capped: false, state, count: n };
  return { capped: n >= state.accountsCap, state, count: n };
}
