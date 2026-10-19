// ------------------------------------------------------- social posting
// The owner-first posting room (design RUEFLY-OWNER-POSTING, slice S0):
// brands above profiles, one brand open at a time, the brand kit, and
// the connect-once frame. This module is ROOM BUILD ONLY. The product
// build never ships it: vite.config.js aliases ./social-pages.js to
// ./social-pages-product.js under PRODUCT_BUILD=1, where every export
// is an inert stub, so no brands data path, no connect route and no
// room copy can appear in the public bundle's bytes (Security OA-6).
// All data moves through admin-api's social_* actions (owner-gated);
// the browser never sees a platform token. In preview (no backend),
// the page runs on the clearly-marked fixtures at the bottom.
import "./room.css";
import { $, esc, callAdmin, accountMode } from "./main.js";
import { LIVE } from "./config.js";

const PLANE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/></svg>';

const PLATFORMS = [
  { key: "meta", label: "Instagram + Facebook", note: "The first wire." },
  { key: "youtube", label: "YouTube", note: "Second wire." },
  { key: "tiktok", label: "TikTok", note: "Third wire." },
  { key: "threads", label: "Threads", note: "Fourth wire." },
];
const PROFILE_PLATFORM_LABEL = {
  instagram: "Instagram",
  facebook_page: "Facebook Page",
  youtube: "YouTube",
  tiktok: "TikTok",
  threads: "Threads",
};

export function postingNavHtml(r) {
  if (accountMode === "user") return "";
  return `<span class="side-group-title">Posting</span>
        <a class="side-link ${r.page === "posting" ? "on" : ""}" data-nav="posting" href="#/posting" title="Posting"><span class="side-ico">${PLANE_ICON}</span><span class="side-txt">Posting</span></a>`;
}

// ------------------------------------------------------------ data path
// One small adapter, two homes: live goes through admin-api (which
// calls the social_* RPCs server-side); preview uses in-memory
// fixtures so the page can be walked with no backend at all.
async function api(action, body = {}) {
  if (!LIVE) return fixtureApi(action, body);
  const out = await callAdmin({ action, ...body });
  if (!out || out.ok === false) throw new Error((out && out.error) || "That did not work.");
  return out;
}

let brandsCache = null;
let currentBrandId = localStorage.getItem("social_brand_id") || "";
let notice = "";

function linesToList(text) {
  return String(text || "").split("\n").map((s) => s.trim()).filter(Boolean);
}
function csvToList(text) {
  return String(text || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function banksToObject(text) {
  const out = {};
  for (const line of linesToList(text)) {
    const cut = line.indexOf(":");
    if (cut < 0) continue;
    const name = line.slice(0, cut).trim();
    if (!name) continue;
    out[name] = line.slice(cut + 1).split(",")
      .map((t) => t.trim().replace(/^#+/, "")).filter(Boolean).map((t) => `#${t}`);
  }
  return out;
}
function banksToText(banks) {
  return Object.entries(banks || {}).map(([name, tags]) => `${name}: ${(tags || []).join(", ")}`).join("\n");
}

async function loadBrands() {
  const out = await api("social_brands_list");
  brandsCache = out.brands || [];
  const open = brandsCache.filter((b) => !b.archived_at);
  if (!open.some((b) => b.id === currentBrandId)) {
    currentBrandId = open.length ? open[0].id : "";
    if (currentBrandId) localStorage.setItem("social_brand_id", currentBrandId);
  }
  return brandsCache;
}

// ------------------------------------------------------------ the page
export async function renderPostingPage() {
  const host = $("#content");
  if (!host) return;
  if (accountMode === "user") {
    host.innerHTML = `<section class="panel"><p class="empty">That page is not here.</p></section>`;
    return;
  }
  const q = (location.hash.split("?")[1] || "");
  const params = new URLSearchParams(q);
  const noteParam = params.get("connected") || params.get("connect");
  if (noteParam && !notice) notice = noteParam;
  host.innerHTML = `<section class="panel"><p class="empty">Opening your brands…</p></section>`;
  let brands;
  try {
    brands = await loadBrands();
  } catch (err) {
    host.innerHTML = `<section class="panel"><h3>Posting</h3><p class="empty">Your brands could not be loaded. (${esc(err.message)})</p></section>`;
    return;
  }
  const open = brands.filter((b) => !b.archived_at);
  const archived = brands.filter((b) => b.archived_at);
  let detail = null;
  if (currentBrandId) {
    try { detail = await api("social_brand_get", { brand_id: currentBrandId }); }
    catch { detail = null; }
  }
  const kit = (detail && detail.kit) || {};
  const profiles = (detail && detail.profiles) || [];
  host.innerHTML = `
  <section class="panel posting-panel">
    <div class="panel-head"><h3>Posting</h3></div>
    <p class="posting-intro">Your brands live here, in your room only. A post can only go out under the brand you pick, and only to that brand's own accounts. Nothing on this page is in the public app.</p>
    ${notice ? `<p class="posting-notice">${esc(notice)}</p>` : ""}
    <div class="brand-chips" role="tablist" aria-label="Your brands">
      ${open.map((b) => `<button class="brand-chip ${b.id === currentBrandId ? "on" : ""}" data-brand="${esc(b.id)}"><span class="brand-dot" style="background:${esc(b.colour || "#C93327")}"></span>${esc(b.name)}<small>${Number(b.profile_count || 0)} account${Number(b.profile_count || 0) === 1 ? "" : "s"}</small></button>`).join("")}
    </div>
    <form class="brand-new" id="brandNewForm">
      <input id="brandName" type="text" maxlength="80" placeholder="New brand name" aria-label="New brand name" />
      <input id="brandColour" type="color" value="#C93327" aria-label="Brand colour" />
      <button class="btn" type="submit">Add brand</button>
    </form>
    ${archived.length ? `<p class="posting-archived">Archived: ${archived.map((b) => esc(b.name)).join(", ")}</p>` : ""}
  </section>
  ${currentBrandId && detail ? `
  <section class="panel posting-panel">
    <div class="panel-head"><h3>${esc(detail.brand.name)}</h3>
    <button class="btn ghost-btn" id="brandArchiveBtn" type="button">Archive brand</button></div>
    <h4 class="posting-h">Accounts</h4>
    ${profiles.length ? profiles.map((p) => `
      <div class="acct-row">
        <div class="acct-main"><b>${esc(PROFILE_PLATFORM_LABEL[p.platform] || p.platform)}</b>
        <span>${esc(p.handle || p.display_name || "")}</span>
        <span class="pill acct-pill ${p.status === "connected" ? "pill-on" : ""}">${p.status === "connected" ? "Connected" : p.status === "needs_reconnect" ? "Needs reconnect" : "Disconnected"}</span></div>
        ${p.reach_state === "private_until_audit" ? `<p class="acct-note">Posts stay private until the platform audit passes.</p>` : ""}
        ${Array.isArray(p.scopes) && p.scopes.length ? `<p class="acct-note">Access: ${esc(p.scopes.join(", "))}</p>` : ""}
        ${p.status !== "disconnected" ? `<button class="btn ghost-btn" data-disconnect="${esc(p.id)}" type="button">Disconnect</button>` : ""}
      </div>`).join("") : `<p class="empty">No accounts connected yet. Connect one below, and it belongs to this brand for good.</p>`}
    <div class="connect-row">
      ${PLATFORMS.map((p) => `<button class="btn" data-connect="${p.key}" type="button">Connect ${esc(p.label)}</button>`).join("")}
    </div>
    <p class="acct-note" id="connectNote">Connect once per account, with the platform's own sign-in. Posting starts when the first wire is switched on.</p>
    <h4 class="posting-h">Brand kit</h4>
    <form id="kitForm" class="kit-form">
      <label class="kit-field"><span>Voice notes</span>
        <textarea id="kitVoice" rows="3" maxlength="8000" placeholder="How this brand sounds, in plain words.">${esc(kit.voice_notes || "")}</textarea></label>
      <label class="kit-field"><span>Tone samples, one per line</span>
        <textarea id="kitTone" rows="3" placeholder="A real caption that sounds right.">${esc((kit.tone_samples || []).join("\n"))}</textarea></label>
      <label class="kit-field"><span>Words this brand uses, comma separated</span>
        <input id="kitDo" type="text" value="${esc((kit.do_words || []).join(", "))}" /></label>
      <label class="kit-field"><span>Words this brand never uses, comma separated</span>
        <input id="kitDont" type="text" value="${esc((kit.dont_words || []).join(", "))}" /></label>
      <label class="kit-field"><span>Colours, comma separated</span>
        <input id="kitColours" type="text" value="${esc((kit.colours || []).join(", "))}" placeholder="#C93327, #FFF8E7" /></label>
      <label class="kit-field"><span>Hashtag banks, one per line: name: #tag, #tag</span>
        <textarea id="kitBanks" rows="3" placeholder="launch: #ruefly, #newpost">${esc(banksToText(kit.hashtag_banks))}</textarea></label>
      <label class="kit-field"><span>First comments, one per line</span>
        <textarea id="kitFirst" rows="2">${esc((kit.first_comments || []).join("\n"))}</textarea></label>
      <button class="btn" type="submit">Save kit</button>
      <span class="acct-note" id="kitSaved"></span>
    </form>
    ${Array.isArray(kit.assets) && kit.assets.length ? `<h4 class="posting-h">Files</h4><p class="acct-note">${kit.assets.length} saved. Files arrive with the composer.</p>` : ""}
  </section>` : `
  <section class="panel posting-panel"><p class="empty">Make your first brand above, then connect its accounts.</p></section>`}`;

  host.querySelectorAll("[data-brand]").forEach((el) => el.addEventListener("click", () => {
    currentBrandId = el.getAttribute("data-brand");
    localStorage.setItem("social_brand_id", currentBrandId);
    renderPostingPage();
  }));
  const newForm = host.querySelector("#brandNewForm");
  if (newForm) newForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = host.querySelector("#brandName").value.trim();
    const colour = host.querySelector("#brandColour").value || "#C93327";
    if (!name) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    try {
      const out = await api("social_brand_create", { slug, name, colour });
      currentBrandId = out.brand.id;
      localStorage.setItem("social_brand_id", currentBrandId);
      notice = `Brand "${name}" is ready. Connect its accounts below.`;
    } catch (err) { notice = `That brand could not be added. (${err.message})`; }
    renderPostingPage();
  });
  const archBtn = host.querySelector("#brandArchiveBtn");
  if (archBtn) archBtn.addEventListener("click", async () => {
    try {
      await api("social_brand_archive", { brand_id: currentBrandId });
      notice = "Brand archived. Its accounts and history stay saved, and nothing was posted.";
      currentBrandId = "";
      localStorage.removeItem("social_brand_id");
    } catch (err) { notice = `That brand could not be archived. (${err.message})`; }
    renderPostingPage();
  });
  host.querySelectorAll("[data-disconnect]").forEach((el) => el.addEventListener("click", async () => {
    try {
      await api("social_profile_disconnect", { profile_id: el.getAttribute("data-disconnect") });
      notice = "Account disconnected. Its sign-in was deleted; its history stays.";
    } catch (err) { notice = `That account could not be disconnected. (${err.message})`; }
    renderPostingPage();
  }));
  host.querySelectorAll("[data-connect]").forEach((el) => el.addEventListener("click", async () => {
    const platform = el.getAttribute("data-connect");
    const label = (PLATFORMS.find((p) => p.key === platform) || {}).label || platform;
    const noteEl = host.querySelector("#connectNote");
    if (!LIVE) {
      if (noteEl) noteEl.textContent = `${label} connect is built, but it is not switched on yet. The wire lands next, one platform at a time.`;
      return;
    }
    try {
      const out = await api("social_oauth_start", { platform, brand_id: currentBrandId });
      if (out.configured && out.url) { location.href = out.url; return; }
      if (noteEl) noteEl.textContent = `${label} connect is built, but its app is not registered yet, so there is nowhere to send you yet.`;
    } catch (err) {
      if (noteEl) noteEl.textContent = `That connect could not start. (${err.message})`;
    }
  }));
  const kitForm = host.querySelector("#kitForm");
  if (kitForm) kitForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const kitBody = {
      voice_notes: host.querySelector("#kitVoice").value,
      tone_samples: linesToList(host.querySelector("#kitTone").value),
      do_words: csvToList(host.querySelector("#kitDo").value),
      dont_words: csvToList(host.querySelector("#kitDont").value),
      colours: csvToList(host.querySelector("#kitColours").value),
      hashtag_banks: banksToObject(host.querySelector("#kitBanks").value),
      first_comments: linesToList(host.querySelector("#kitFirst").value),
    };
    try {
      await api("social_kit_set", { brand_id: currentBrandId, kit: kitBody });
      const saved = host.querySelector("#kitSaved");
      if (saved) saved.textContent = "Saved.";
    } catch (err) {
      const saved = host.querySelector("#kitSaved");
      if (saved) saved.textContent = `Not saved. (${err.message})`;
    }
  });
}

// ------------------------------------------------------------ fixtures
// Preview only (no backend). Clearly sample data: two brands, one kit
// filled in, one sample account marked as an example. Nothing here is
// real, and none of it can post.
const FX = {
  brands: [
    { id: "fx-alpha", slug: "example-alpha", name: "Example Alpha", colour: "#B3401E", created_at: "", archived_at: null, profile_count: 1 },
    { id: "fx-beta", slug: "example-beta", name: "Example Beta", colour: "#3E6B48", created_at: "", archived_at: null, profile_count: 0 },
  ],
  kits: {
    "fx-alpha": {
      voice_notes: "Warm and plain. Short sentences. A little funny, never salesy.",
      tone_samples: ["Day one of doing the boring bit properly. It works."],
      do_words: ["simple", "steady", "real"],
      dont_words: ["synergy", "hustle"],
      colours: ["#B3401E", "#FFF8E7"],
      hashtag_banks: { launch: ["#example", "#firstpost"] },
      first_comments: ["Questions welcome. I read every one."],
      assets: [],
      updated_at: "",
    },
    "fx-beta": { voice_notes: "", tone_samples: [], do_words: [], dont_words: [], colours: [], hashtag_banks: {}, first_comments: [], assets: [], updated_at: "" },
  },
  profiles: {
    "fx-alpha": [{
      id: "fx-prof-1", brand_id: "fx-alpha", platform: "instagram", platform_account_id: "example",
      handle: "@example.only", display_name: "Example account (not real)", status: "needs_reconnect",
      reach_state: "full", connected_at: "", scopes: ["instagram_basic"], token_expires_at: null, has_refresh: true,
    }],
    "fx-beta": [],
  },
  seq: 3,
};

function fixtureApi(action, body) {
  if (action === "social_brands_list") return { ok: true, brands: FX.brands };
  if (action === "social_brand_create") {
    const brand = { id: `fx-${FX.seq++}`, slug: body.slug || `brand-${FX.seq}`, name: body.name || "Brand", colour: body.colour || "#C93327", created_at: "", archived_at: null, profile_count: 0 };
    FX.brands.push(brand);
    FX.kits[brand.id] = { voice_notes: "", tone_samples: [], do_words: [], dont_words: [], colours: [], hashtag_banks: {}, first_comments: [], assets: [], updated_at: "" };
    FX.profiles[brand.id] = [];
    return { ok: true, brand };
  }
  if (action === "social_brand_archive") {
    const brand = FX.brands.find((b) => b.id === body.brand_id);
    if (brand) brand.archived_at = "preview";
    return { ok: true, brand };
  }
  if (action === "social_brand_get") {
    const brand = FX.brands.find((b) => b.id === body.brand_id);
    return { ok: true, brand, kit: FX.kits[body.brand_id] || null, profiles: FX.profiles[body.brand_id] || [] };
  }
  if (action === "social_kit_set") {
    FX.kits[body.brand_id] = { ...(FX.kits[body.brand_id] || {}), ...body.kit };
    return { ok: true, kit: FX.kits[body.brand_id] };
  }
  if (action === "social_profiles_list") return { ok: true, profiles: FX.profiles[body.brand_id] || [] };
  if (action === "social_profile_disconnect") {
    for (const list of Object.values(FX.profiles)) {
      const p = list.find((x) => x.id === body.profile_id);
      if (p) { p.status = "disconnected"; return { ok: true, profile: p }; }
    }
    return { ok: true, profile: null };
  }
  if (action === "social_oauth_start") return { ok: true, url: null, configured: false, expires_at: null };
  throw new Error("Unknown action.");
}
