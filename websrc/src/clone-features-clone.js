// Clone features — CLONE BUILD ONLY (CLONE_BUILD=1; vite.config.js
// aliases ./clone-features.js to this file). This module ships ONLY
// in Ilse's private Ruefly clone (her editing playground, pointed at
// the ilse-socials-test twin). Production builds never see it.
//
// Contents:
//  - the "Ilse's copy" marker (title + a small fixed pill), so she
//    always knows which Ruefly she is editing;
//  - the Brands area (route #/brands): a general per-user feature.
//    A signed-in user creates brands, edits the name, uploads/swaps
//    a logo, and keeps a channel list (platform + handle/link) with
//    a visible "+ Add channel" control. Every record lives under
//    the caller's own users/{uid} space (the app's per-user layer),
//    written whole through the same app-firebase alias discipline
//    as src/user-store.js — nothing here can address another uid.
//  - the tracked-posts read: HQ writes published posts at
//    users/{uid}/brands/{brandId}/posts/{postId}
//    { platform, publishedAt, captionSummary, url, source: "hq" };
//    the brand view lists them newest first. The clone never writes
//    posts and never connects a platform: every channel honestly
//    reads "Not connected yet", because the clone has no platform
//    wires at all.
import { firebaseDb, firebaseFirestore, watchFirebaseUser } from "app-firebase";
import { $, esc } from "./main.js";

export const CLONE_FEATURES = true;

// ------------------------------------------------------------ marker
// Seats (Quality fix, 16 Oct): the pill's home seat is bottom-left,
// as shipped. ON THE DOOR that seat is wrong at phone widths: the
// demo line ("Just looking? …") rides the bottom edge (the pill
// covered its opening words), and on short screens the centred form
// itself reaches the bottom strip — no bottom seat clears the line,
// the email field AND the round arrow at every 320–430px size
// (measured, RUEFLY-CLONE-BUILD.md). So while the door is up, the
// stylesheet below moves the pill to the top-left corner, above the
// door block: the one strip that is empty at every phone size.
// Inside the app (no .door-wrap) the rule never matches and the
// pill keeps its shipped bottom-left seat.
document.title = "Ruefly (Ilse's copy)";
function plantMarker() {
  if (document.getElementById("cloneMarker")) return;
  const el = document.createElement("div");
  el.id = "cloneMarker";
  el.textContent = "Ruefly — Ilse's copy";
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:9999;"
    + "background:#C93327;color:#FFF4E8;font:600 12px/1 Outfit,system-ui,sans-serif;"
    + "padding:7px 11px;border-radius:999px;box-shadow:0 2px 10px rgba(51,22,31,.25);"
    + "pointer-events:none;letter-spacing:.02em;";
  document.body.appendChild(el);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", plantMarker);
} else { plantMarker(); }

// ------------------------------------------------------------ styles
// The Posting page's chip/form shapes live in room.css, which the
// product bundle never ships — so the clone carries its own small
// copy of just those shapes, in the app palette.
(function plantStyles() {
  if (document.getElementById("cloneStyles")) return;
  const el = document.createElement("style");
  el.id = "cloneStyles";
  el.textContent = `
body:has(.door-wrap) #cloneMarker{top:10px!important;bottom:auto!important}
.brand-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.brand-chip{display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:999px;border:1.5px solid #FFC4B8;background:#FFF1E4;color:#33161F;font:600 14px Outfit,system-ui,sans-serif;cursor:pointer}
.brand-chip small{font-weight:500;opacity:.65}
.brand-chip.on{background:#C93327;border-color:#C93327;color:#FFF4E8}
.brand-new{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.brand-new input{flex:1;min-width:180px}`;
  document.head.appendChild(el);
})();

// ------------------------------------------------------------ session
let cloneUser = undefined; // undefined = not yet known
watchFirebaseUser((u) => {
  const was = cloneUser && cloneUser.uid;
  cloneUser = u;
  if (u && u.uid !== was && location.hash.startsWith("#/brands")) renderCloneBrandsPage();
}).catch(() => { cloneUser = null; });

// ------------------------------------------------------------ data
let fsPromise = null;
function fs() {
  if (!fsPromise) fsPromise = firebaseFirestore();
  return fsPromise;
}
const clean = (o) => JSON.parse(JSON.stringify(o ?? null));
const nowIso = () => new Date().toISOString();

async function brandsRef(db, uid) {
  const { collection } = await fs();
  return collection(db, "users", uid, "brands");
}
async function brandRef(db, uid, id) {
  const { doc } = await fs();
  return doc(db, "users", uid, "brands", id);
}
async function postsRef(db, uid, id) {
  const { collection } = await fs();
  return collection(db, "users", uid, "brands", id, "posts");
}

async function loadBrands(uid) {
  const db = await firebaseDb();
  const { getDocs } = await fs();
  const snap = await getDocs(await brandsRef(db, uid));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}
async function saveBrand(uid, brand) {
  const db = await firebaseDb();
  const { setDoc } = await fs();
  const { id, ...record } = brand;
  await setDoc(await brandRef(db, uid, id), clean({ ...record, updatedAt: nowIso() }));
}
async function loadPosts(uid, brandId) {
  const db = await firebaseDb();
  const { getDocs } = await fs();
  const snap = await getDocs(await postsRef(db, uid, brandId));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
}

// ------------------------------------------------------------ nav
const TAG_ICON = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4Z"/><circle cx="7" cy="7" r="1.5"/></svg>';
export function cloneNavHtml(r) {
  return `<a class="side-link ${r.page === "brands" ? "on" : ""}" data-nav="brands" href="#/brands" title="Brands"><span class="side-ico">${TAG_ICON}</span><span class="side-txt">Brands</span></a>`;
}

// ------------------------------------------------------------ logo
// The logo is user data under the user's own uid space, held on the
// brand record itself (the app has no separate file store in its
// per-user layer). The image is downscaled in the browser before it
// is saved, so the record stays small; swapping replaces the value,
// removing clears it — both are the user's own edits.
function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 480;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      let out = canvas.toDataURL("image/png");
      if (out.length > 700000) out = canvas.toDataURL("image/jpeg", 0.85);
      if (out.length > 950000) { reject(new Error("That image is too large even shrunk — try a smaller one.")); return; }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That file could not be read as an image.")); };
    img.src = url;
  });
}

// ------------------------------------------------------------ page
const PLATFORM_SUGGESTIONS = ["Facebook", "Instagram", "TikTok", "YouTube", "Threads", "X", "LinkedIn", "Pinterest"];
let openBrandId = "";
try { openBrandId = localStorage.getItem("clone_brand_id") || ""; } catch { openBrandId = ""; }
let brandsNotice = "";

function fmtWhen(v) {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString("en-AU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export async function renderCloneBrandsPage() {
  const host = $("#content");
  if (!host) return;
  if (cloneUser === undefined) {
    host.innerHTML = `<section class="panel"><h3>Brands</h3><p class="empty">One moment…</p></section>`;
    setTimeout(() => { if (location.hash.startsWith("#/brands")) renderCloneBrandsPage(); }, 600);
    return;
  }
  if (!cloneUser) {
    host.innerHTML = `<section class="panel"><h3>Brands</h3><p class="empty">Sign in to see your brands. They live in your account, and only yours.</p></section>`;
    return;
  }
  const uid = cloneUser.uid;
  host.innerHTML = `<section class="panel"><h3>Brands</h3><p class="empty">Opening your brands…</p></section>`;
  let brands;
  try { brands = await loadBrands(uid); }
  catch (err) {
    host.innerHTML = `<section class="panel"><h3>Brands</h3><p class="empty">Your brands could not be loaded. (${esc(err.message)})</p></section>`;
    return;
  }
  if (!brands.some((b) => b.id === openBrandId)) {
    openBrandId = brands.length ? brands[0].id : "";
    try { localStorage.setItem("clone_brand_id", openBrandId); } catch {}
  }
  const open = brands.find((b) => b.id === openBrandId) || null;
  let posts = [];
  if (open) { try { posts = await loadPosts(uid, open.id); } catch { posts = []; } }

  host.innerHTML = `
  <section class="panel">
    <div class="panel-head"><h3>Brands</h3></div>
    <p>Your brands, in your copy only. Name, logo and channels are yours to edit — everything saves to your own account space.</p>
    ${brandsNotice ? `<p class="form-note">${esc(brandsNotice)}</p>` : ""}
    <div class="brand-chips" role="tablist" aria-label="Your brands">
      ${brands.map((b) => `<button class="brand-chip ${b.id === openBrandId ? "on" : ""}" data-brand="${esc(b.id)}" type="button">${b.logo ? `<img src="${b.logo}" alt="" style="width:20px;height:20px;border-radius:6px;object-fit:cover;vertical-align:-5px;margin-right:6px" />` : ""}${esc(b.name || "Untitled brand")}<small>${(b.channels || []).length} channel${(b.channels || []).length === 1 ? "" : "s"}</small></button>`).join("")}
    </div>
    <form class="brand-new" id="cloneBrandNew">
      <input id="cloneBrandName" type="text" maxlength="80" placeholder="New brand name" aria-label="New brand name" />
      <button class="btn" type="submit">Add brand</button>
    </form>
  </section>
  ${open ? `
  <section class="panel">
    <div class="panel-head"><h3>${esc(open.name || "Untitled brand")}</h3></div>
    <div class="panel-head"><h3>Brand name</h3></div>
    <div class="name-row">
      <input id="cloneBrandEditName" type="text" maxlength="80" value="${esc(open.name || "")}" aria-label="Brand name" />
      <button class="btn soft" id="cloneBrandNameSave" type="button">Save</button>
    </div>
    <div class="panel-head"><h3>Logo</h3></div>
    ${open.logo ? `<p><img src="${open.logo}" alt="Brand logo" style="width:96px;height:96px;border-radius:18px;object-fit:cover" /></p>` : `<p class="form-note">No logo yet.</p>`}
    <div class="name-row">
      <label class="btn soft" for="cloneLogoFile" style="cursor:pointer">${open.logo ? "Swap logo" : "Upload logo"}</label>
      <input id="cloneLogoFile" type="file" accept="image/*" hidden />
      ${open.logo ? `<button class="btn soft" id="cloneLogoRemove" type="button">Remove logo</button>` : ""}
    </div>
    <p class="form-note" id="cloneLogoNote"></p>
    <div class="panel-head"><h3>Channels</h3></div>
    <div id="cloneChannels">
      ${(open.channels || []).map((c, i) => `
      <div class="name-row" data-channel-row="${i}">
        <input type="text" list="clonePlatforms" placeholder="Platform" value="${esc(c.platform || "")}" data-ch-platform aria-label="Channel platform" />
        <input type="text" placeholder="@handle or link" value="${esc(c.handle || "")}" data-ch-handle aria-label="Channel handle or link" />
        <span class="pill">Not connected yet</span>
        <button class="btn soft" type="button" data-ch-remove="${i}">Remove</button>
      </div>`).join("")}
    </div>
    <datalist id="clonePlatforms">${PLATFORM_SUGGESTIONS.map((p) => `<option value="${p}"></option>`).join("")}</datalist>
    <div class="name-row">
      <button class="btn soft" id="cloneChannelAdd" type="button">+ Add channel</button>
      <button class="btn" id="cloneChannelsSave" type="button">Save channels</button>
    </div>
    <p class="form-note" id="cloneChannelsNote"></p>
    <div class="panel-head"><h3>Tracked posts</h3></div>
    ${posts.length ? posts.map((p) => `
      <p><b>${esc(p.platform || "")}</b> · ${esc(fmtWhen(p.publishedAt))}<br />${esc(p.captionSummary || "")}${p.url ? `<br /><a href="${esc(p.url)}" target="_blank" rel="noopener">See the post</a>` : ""}</p>`).join("")
      : `<p class="empty">No posts tracked yet — posts HQ publishes for ${esc(open.name || "this brand")} will appear here.</p>`}
  </section>` : `
  <section class="panel"><p class="empty">Make your first brand above.</p></section>`}`;

  host.querySelectorAll("[data-brand]").forEach((el) => el.addEventListener("click", () => {
    openBrandId = el.getAttribute("data-brand");
    try { localStorage.setItem("clone_brand_id", openBrandId); } catch {}
    renderCloneBrandsPage();
  }));
  const newForm = host.querySelector("#cloneBrandNew");
  if (newForm) newForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = host.querySelector("#cloneBrandName").value.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
      + "-" + Math.random().toString(36).slice(2, 8);
    const brand = { id, name, logo: "", channels: [], createdAt: nowIso(), updatedAt: nowIso() };
    try {
      await saveBrand(uid, brand);
      openBrandId = id;
      try { localStorage.setItem("clone_brand_id", id); } catch {}
      brandsNotice = `Brand "${name}" is ready. Add its logo and channels below.`;
    } catch (err) { brandsNotice = `That brand could not be added. (${err.message})`; }
    renderCloneBrandsPage();
  });
  if (!open) return;
  const reread = async () => (await loadBrands(uid)).find((b) => b.id === open.id) || open;

  const nameSave = host.querySelector("#cloneBrandNameSave");
  if (nameSave) nameSave.addEventListener("click", async () => {
    const fresh = await reread();
    fresh.name = host.querySelector("#cloneBrandEditName").value.trim();
    try { await saveBrand(uid, fresh); brandsNotice = "Brand name saved."; }
    catch (err) { brandsNotice = `That name could not be saved. (${err.message})`; }
    renderCloneBrandsPage();
  });
  const logoFile = host.querySelector("#cloneLogoFile");
  if (logoFile) logoFile.addEventListener("change", async () => {
    const note = host.querySelector("#cloneLogoNote");
    const file = logoFile.files && logoFile.files[0];
    if (!file) return;
    try {
      const logo = await fileToLogo(file);
      const fresh = await reread();
      fresh.logo = logo;
      await saveBrand(uid, fresh);
      brandsNotice = "Logo saved.";
      renderCloneBrandsPage();
    } catch (err) { if (note) note.textContent = err.message; }
  });
  const logoRemove = host.querySelector("#cloneLogoRemove");
  if (logoRemove) logoRemove.addEventListener("click", async () => {
    const fresh = await reread();
    fresh.logo = "";
    try { await saveBrand(uid, fresh); brandsNotice = "Logo removed."; }
    catch (err) { brandsNotice = `That logo could not be removed. (${err.message})`; }
    renderCloneBrandsPage();
  });
  const readChannels = () => [...host.querySelectorAll("[data-channel-row]")].map((row) => ({
    platform: row.querySelector("[data-ch-platform]").value.trim(),
    handle: row.querySelector("[data-ch-handle]").value.trim(),
  })).filter((c) => c.platform || c.handle);
  const chAdd = host.querySelector("#cloneChannelAdd");
  if (chAdd) chAdd.addEventListener("click", async () => {
    const fresh = await reread();
    fresh.channels = [...readChannels(), { platform: "", handle: "" }];
    // Render the extra row without a round-trip: keep typed values.
    const list = host.querySelector("#cloneChannels");
    const i = list.children.length;
    const div = document.createElement("div");
    div.className = "name-row";
    div.setAttribute("data-channel-row", String(i));
    div.innerHTML = `<input type="text" list="clonePlatforms" placeholder="Platform" value="" data-ch-platform aria-label="Channel platform" />
      <input type="text" placeholder="@handle or link" value="" data-ch-handle aria-label="Channel handle or link" />
      <span class="pill">Not connected yet</span>
      <button class="btn soft" type="button" data-ch-remove="${i}">Remove</button>`;
    list.appendChild(div);
    wireRemove(div);
    const inp = div.querySelector("[data-ch-platform]");
    if (inp) inp.focus();
  });
  const wireRemove = (scope) => {
    scope.querySelectorAll("[data-ch-remove]").forEach((btn) => btn.addEventListener("click", () => {
      const row = btn.closest("[data-channel-row]");
      if (row) row.remove();
    }));
  };
  wireRemove(host);
  const chSave = host.querySelector("#cloneChannelsSave");
  if (chSave) chSave.addEventListener("click", async () => {
    const note = host.querySelector("#cloneChannelsNote");
    const fresh = await reread();
    fresh.channels = readChannels();
    try {
      await saveBrand(uid, fresh);
      if (note) note.textContent = "Channels saved.";
      brandsNotice = "Channels saved.";
      renderCloneBrandsPage();
    } catch (err) { if (note) note.textContent = `Not saved. (${err.message})`; }
  });
}
