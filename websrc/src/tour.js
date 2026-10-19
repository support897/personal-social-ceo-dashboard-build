// ------------------------------------------------------------ tour
// DOOR v4 (her approval, 15 Oct 22:26): joining lands a NEW account
// straight inside the app, and Rue gives ONE guided tour there —
// a single pop-up in the middle of the screen while the real app
// moves behind it. Stop 1 asks the name; Next walks the menu and
// the app's areas; the last stop ends on Done. The ✕ closes the
// tour at any stop. First visit only: the tour state rides the
// profile's guide record (guide.tourStep / guide.tourDone /
// guide.nameSkipUnanswered / guide.nameReoffered), written through
// the app's normal profile saves.
//
// This module is the tour's pure half: the stops, the card markup,
// the show / re-offer decision and the guide-state reducer. It
// touches no DOM and no store, so the logic harness drives it
// directly. main.js wires it to the shell, the router and
// saveUserProfile.
//
// NAME RE-OFFER (HQ ruling, 15 Oct 22:06): if the tour's name step
// is closed or skipped UNANSWERED, Rue re-offers the name ONCE on
// the next visit — one small quiet bubble, never in the session
// the skip happened in — then never again. After that the name
// lives only in Account; the greeting stays "Hello, friend"; a
// missing name blocks nothing anywhere.
//
// Copy discipline: the stop lines are the filed prep's
// (personal-brand/TOUR-STOPS-V4.md), planner verbs only — the
// product plans and schedules in the app; it never claims to
// post for anyone (Detachment Law). No em dashes in shipped
// words (house discipline).
//
// LANGUAGE LAYER (16 Oct 2026): the English lines below stay the
// source of truth on the stops themselves; the card renders each
// stop's line through src/i18n.js (t("tour.stop.<id>")), so a
// Spanish device reads the tour in Spanish end to end. The
// dictionary's English values are these lines, word for word.

import { t } from "./i18n.js";

const esc = (v = "") => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

// Rue's art of record (mascot-sheets/rue-firefly, SHEET.md seat
// map): hello = guide welcome · point = planner steps · think =
// drafting · excited = celebrate. Files ship byte-identical from
// public/icons; no other Rue art may sit in a guide seat.
// (The kite is the app's icon + door mark only, never a guide.)
export const RUE_HELLO = "/icons/media-generation-rue-firefly-pose-hello-wave2-0-b2cc42bc-5bba-49ef-b717-cc5a771f8625.webp";
export const RUE_POINT = "/icons/media-generation-rue-firefly-pose-point-guide-0-8f786af1-33a2-4526-9896-667f7ad84396.webp";
export const RUE_THINK = "/icons/media-generation-rue-firefly-pose-think-0-2d1f280f-3716-4e98-bccb-38c6c9e7a1fd.webp";
export const RUE_EXCITED = "/icons/media-generation-rue-firefly-react-excited-0-f9b23b15-e695-434b-be7c-e07b1a852b34.webp";

// The stops. `go` names where the real app stands behind the
// pop-up (main.js applies it): home-top / menu / home-brands /
// planner / planner-queue / home-accounts / account. Stops 4 + 5
// stand on the Planner page itself (planner slice B re-anchored
// them there once the page existed): stop 4 at its week strip,
// stop 5 scrolled to its queue — the drafts live in that queue,
// in the order the user chose.
//   1 name · 2 menu · 3 home (brands) · 4 planner · 5 drafts +
//   queue · 6 your accounts · 7 account (last, Done).
export const TOUR_STOPS = [
  {
    id: "name", img: RUE_HELLO, go: "home-top",
    line: "Hi! I'm Rue. Welcome in! What's your name?",
  },
  {
    id: "menu", img: RUE_POINT, go: "menu",
    line: "This is your menu. Everything lives here, in tidy groups.",
  },
  {
    id: "home", img: RUE_POINT, go: "home-brands",
    line: "Home is your brands. Each brand keeps its own accounts, its own look, its own plans. Nothing mixes.",
  },
  {
    id: "planner", img: RUE_POINT, go: "planner",
    line: "The planner is your calm calendar. Draft posts, plan the week, see it all at a glance.",
  },
  {
    id: "drafts", img: RUE_THINK, go: "planner-queue",
    line: "Drafts wait here until you are happy with them. Your queue keeps the order you chose.",
  },
  {
    id: "accounts", img: RUE_POINT, go: "home-accounts",
    line: "Connect your own accounts here, the ones you plan for. Free holds 2. Plans holds the bigger shelves.",
  },
  {
    id: "account", img: RUE_EXCITED, go: "account",
    line: "This is Account: your background, your plans, your data. Your data is yours. That's the tour!",
  },
];

export const TOUR_LAST = TOUR_STOPS.length - 1;

// The guide record's tour fields, with the defaults an older
// profile (written before the tour existed) reads as.
export function tourState(guide) {
  const g = guide || {};
  return {
    step: Number.isFinite(g.tourStep) ? g.tourStep : 0,
    done: Boolean(g.tourDone),
    presented: Boolean(g.tourPresented),
    nameSkipUnanswered: Boolean(g.nameSkipUnanswered),
    nameReoffered: Boolean(g.nameReoffered),
  };
}

// The decision, made once per entry (enterUserMode, after the
// load): what, if anything, Rue shows this visit.
//   profile — the loaded profile (name + guide record).
//   isNew   — THIS entry created the profile (loadUserSpace's
//             isNew): a fresh join lands in the tour. A returning
//             sign-in NEVER gets the tour.
//   skippedThisLoad — the name step was skipped earlier in THIS
//             page load; the re-offer never fires in the session
//             the skip happened in (HQ 22:06).
// Returns { show: "tour", startAt } | { show: "reoffer" } | null.
export function decideTour(profile, { isNew = false, skippedThisLoad = false } = {}) {
  if (!profile) return null;
  const t = tourState(profile.guide);
  const named = Boolean(String(profile.name || "").trim());
  // A tour that has never been PRESENTED runs, whenever the
  // account arrives — new or returning (build-7 retest R-002(i):
  // the re-offer must never pre-empt a tour the user has not
  // seen). Presentation itself writes the marker (the "presented"
  // guide event, fired when the card first paints), so a tour
  // abandoned mid-way is distinguishable from a never-run one
  // even when the close wrote nothing else. (The isNew fast path
  // of the first shape is subsumed: a fresh join has never been
  // presented.)
  if (!t.done && !t.presented) return { show: "tour", startAt: t.step };
  // Dogfood fix (R-002): the re-offer used to arm only from the
  // "end" event's nameSkipUnanswered flag — so a first visit cut
  // short (app closed mid-tour, no ✕, no Skip) never armed it, and
  // the name was lost for good: no tour (returning visits never
  // tour), no re-offer, "Hello, friend" forever. An unfinished,
  // already-presented tour with no name IS a passed-by name step;
  // on a later visit the one quiet re-offer is the catch, exactly
  // as designed. A tour that ENDED unnamed (done, with the name
  // step recorded unanswered) earns the same catch; a name given
  // and later cleared in Account (done, skip answered) never
  // does — the distinction is the skip flag the "end" event set.
  if (!named && !t.nameReoffered && !skippedThisLoad && (!t.done || t.nameSkipUnanswered)) {
    return { show: "reoffer" };
  }
  return null;
}

// The guide reducer: pure transitions over the tour fields.
// Every event returns a NEW guide object; the caller merges it
// onto the profile and saves through saveUserProfile.
//   "next"    — advance one stop (clamped at the last).
//   "end"     — the tour is over (Done, ✕, or Skip tour). Marks
//               the tour done and the guide finished (the guide
//               card's standing machinery), and arms the name
//               re-offer when the name step went unanswered.
//   "presented" — the tour card has painted at least once; a
//               never-presented tour always runs before any
//               re-offer is considered (R-002(i)).
//   "reoffer-answered" — the re-offer was ANSWERED (Save or Not
//               now); only an answer spends it (R-002(ii)). A
//               showing, a ✕ or a reload spend nothing.
//   "restart" — a manual re-run from Account's setup guide: a
//               fresh walk. The re-offer flags stand as they are
//               (a spent re-offer stays spent).
export function applyGuideEvent(guide, event, payload = {}) {
  const g = { ...(guide || {}) };
  const t = tourState(g);
  if (event === "next") {
    g.tourStep = Math.min(t.step + 1, TOUR_LAST);
  } else if (event === "end") {
    g.tourStep = TOUR_STOPS.length;
    g.tourDone = true;
    g.finished = true;
    g.nameSkipUnanswered = !payload.named;
  } else if (event === "presented") {
    g.tourPresented = true;
  } else if (event === "reoffer-answered") {
    g.nameReoffered = true;
  } else if (event === "restart") {
    g.tourStep = 0;
    g.tourDone = false;
    g.finished = false;
    g.hidden = false;
  }
  return g;
}

// ------------------------------------------------------------ cards
// The tour pop-up for one stop (rendered by main.js into a
// body-level overlay, over the real app). Stop 1 carries the
// name field + Skip tour; every stop carries the ✕, the dots,
// and Next — Done on the last stop.
export function tourCardHtml(stopIndex, { nameValue = "" } = {}) {
  const i = Math.max(0, Math.min(stopIndex, TOUR_LAST));
  const stop = TOUR_STOPS[i];
  const last = i === TOUR_LAST;
  const dots = TOUR_STOPS.map((_, d) => (d === i ? "●" : "○")).join(" ");
  return `
  <section class="tour-card" role="dialog" aria-modal="true" aria-label="${esc(t("tour.aria"))}">
    <button class="tour-x" id="tourClose" type="button" aria-label="${esc(t("tour.close"))}">✕</button>
    <div class="tour-mascot"><img src="${stop.img}" alt="" /></div>
    <p class="tour-line">${esc(t(`tour.stop.${stop.id}`, null) || stop.line)}</p>
    ${i === 0 ? `<input class="tour-field" id="tourName" type="text" placeholder="${esc(t("common.yourName"))}" autocomplete="name" value="${esc(nameValue)}" />` : ""}
    <div class="tour-row">
      ${i === 0 ? `<button class="tour-skip" id="tourSkip" type="button">${esc(t("tour.skip"))}</button>` : `<span></span>`}
      <button class="btn primary tour-next" id="tourNext" type="button">${last ? esc(t("tour.done")) : esc(t("tour.next"))}</button>
    </div>
    <div class="tour-dots" aria-hidden="true">${dots}</div>
  </section>`;
}

// The one quiet re-offer (HQ 22:06): small, no dots, no tour —
// just Rue and the name question, once.
export function reofferCardHtml() {
  return `
  <section class="tour-card reoffer-card" role="dialog" aria-modal="true" aria-label="${esc(t("tour.reoffer.aria"))}">
    <button class="tour-x" id="reofferClose" type="button" aria-label="${esc(t("tour.reoffer.close"))}">✕</button>
    <div class="tour-mascot"><img src="${RUE_HELLO}" alt="" /></div>
    <p class="tour-line">${esc(t("tour.reoffer.line"))}</p>
    <input class="tour-field" id="reofferName" type="text" placeholder="${esc(t("common.yourName"))}" autocomplete="name" />
    <div class="tour-row">
      <button class="tour-skip" id="reofferSkip" type="button">${esc(t("common.notNow"))}</button>
      <button class="btn primary tour-next" id="reofferSave" type="button">${esc(t("common.save"))}</button>
    </div>
  </section>`;
}
