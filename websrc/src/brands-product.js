// Brands workspace — PRODUCT build (Build 2, Ruefly's road to its
// single 100% build). A real product surface, wired in src/main.js
// like the app's other product pages (route #/brands, and
// #/brands/{brandId} for one brand's page). It is NOT the clone's
// module: the clone (src/clone-features-clone.js) proved the shape
// on Ilse's private copy; this module is the shipped product's own
// brands area, open to every signed-in user in their own space.
//
// Contents:
//  - the Brands page: the user's brand cards (logo or initial tile,
//    name, channel count in plain words) + the Add-a-brand form;
//  - the Brand page: rename, logo upload / swap / remove (the
//    clone's downscale path, the image held on the record), the
//    channel list (platform + handle, every row honestly reading
//    "Not connected yet" — connecting accounts is the connections
//    build, and there is NO connect button or OAuth here), and
//  - the per-brand KIT, the room shape of record
//    (src/social-pages.js: voice_notes · tone_samples · do_words ·
//    dont_words · colours · hashtag_banks · first_comments ·
//    assets), held on the brand record as its `kit` field, sealed
//    per brand: nothing here ever reads or writes another brand's
//    record, and every path is rooted at the caller's own
//    users/{uid} (the same discipline as src/user-store.js).
//
// The demo: the demo space seeds no brands docs — its two brands
// are worker records (Marina's Bakery / Coastline Yoga, both made
// up). The Brands page shows those as read-only cards labelled
// made up; Add still works and writes a real brands doc into the
// demo session's own space, exactly as the demo's other writes do.
import { firebaseDb, firebaseFirestore, watchFirebaseUser } from "app-firebase";
import { $, esc, DATA } from "./main.js";
import { t } from "./i18n.js";
import { saveUserRecord, deleteUserRecord } from "./user-store.js";

export const BRANDS_FEATURES = true;

// ------------------------------------------------------------ styles
// The product bundle's styles.css carries the shared panel / row /
// button shapes; the brands workspace adds its own small set here
// (the clone module's precedent: a module-planted style block in
// the app palette, so styles.css itself never grows per feature).
(function plantStyles() {
  if (document.getElementById("brandsStyles")) return;
  const el = document.createElement("style");
  el.id = "brandsStyles";
  el.textContent = `
.bp-cards{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));margin:10px 0}
.bp-card{display:flex;gap:12px;align-items:center;text-align:left;width:100%;padding:14px;border:1.5px solid #FFC4B8;border-radius:16px;background:#FFF1E4;color:#33161F;font:inherit;cursor:pointer}
.bp-card.static{cursor:default}
.bp-thumb{width:52px;height:52px;border-radius:14px;object-fit:cover;flex:none}
.bp-initial{width:52px;height:52px;border-radius:14px;flex:none;display:flex;align-items:center;justify-content:center;background:#C93327;color:#FFF4E8;font:600 24px "Instrument Serif",serif}
.bp-card-main{min-width:0}
.bp-card-name{display:block;font-weight:600;font-size:16px}
.bp-card-sub{display:block;font-size:13px;opacity:.7;margin-top:2px}
.bp-new{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.bp-new input{flex:1;min-width:180px}
.bp-logo-img{width:96px;height:96px;border-radius:18px;object-fit:cover}
.bp-row{display:flex;gap:8px;align-items:center;margin:6px 0;flex-wrap:wrap}
.bp-row input,.bp-row select{flex:1;min-width:130px}
.bp-swatch{width:26px;height:26px;border-radius:8px;border:1.5px solid #FFC4B8;flex:none;background:transparent}
.bp-kit textarea{width:100%}
.bp-kit .kit-field{display:block;margin:10px 0}
.bp-kit .kit-field>span{display:block;font-weight:600;margin-bottom:4px}
.bp-kit .kit-field input{width:100%}
.bp-back{display:inline-block;margin-bottom:10px}
`;
  document.head.appendChild(el);
})();

// ------------------------------------------------------------ session
let brandsUser = undefined; // undefined = not yet known
let brandsPageLive = false; // this module painted the current page
watchFirebaseUser((u) => {
  brandsUser = u;
  if (brandsPageLive && location.hash.startsWith("#/brands")) {
    renderBrandsPage({ brandId: location.hash.split("/").filter(Boolean)[1] || "" });
  }
}).catch(() => { brandsUser = null; });

// ------------------------------------------------------------ data
let fsPromise = null;
function fs() {
  if (!fsPromise) fsPromise = firebaseFirestore();
  return fsPromise;
}
const clean = (o) => JSON.parse(JSON.stringify(o ?? null));
const nowIso = () => new Date().toISOString();

const PLATFORMS = ["Instagram", "Facebook", "TikTok", "YouTube", "Threads"];

const EMPTY_KIT = () => ({
  voice_notes: "",
  tone_samples: [],
  do_words: [],
  dont_words: [],
  colours: [],
  hashtag_banks: {},
  first_comments: [],
  assets: [],
});
const kitOf = (brand) => ({ ...EMPTY_KIT(), ...((brand && brand.kit) || {}) });

async function loadBrands(uid) {
  const db = await firebaseDb();
  const { collection, getDocs } = await fs();
  const snap = await getDocs(collection(db, "users", uid, "brands"));
  return snap.docs.map((d) => ({ ...d.data(), id: d.id }))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
}

async function saveBrand(user, brand) {
  const { id, ...record } = brand;
  await saveUserRecord(user, "brands", id, clean({ ...record, updatedAt: nowIso() }));
  if (DATA) {
    const mine = (DATA.brands || []).filter((b) => b.id !== id);
    mine.push({ ...record, id, updatedAt: nowIso() });
    mine.sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
    DATA.brands = mine;
  }
}

// ------------------------------------------------------------ nav
const TAG_ICON = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4Z"/><circle cx="7" cy="7" r="1.5"/></svg>';
export function brandsNavHtml(r) {
  return `<a class="side-link ${r.page === "brands" ? "on" : ""}" data-nav="brands" href="#/brands" title="${esc(t("brands.title"))}"><span class="side-ico">${TAG_ICON}</span><span class="side-txt">${esc(t("brands.title"))}</span></a>`;
}

// ------------------------------------------------------------ logo
// The clone's downscale path, unchanged in shape: the logo is user
// data under the user's own uid space, held on the brand record
// itself (the app has no separate file store in its per-user
// layer). The image is downscaled in the browser before it is
// saved, so the record stays small; swapping replaces the value,
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
      if (out.length > 950000) { reject(new Error(t("brands.logoTooLarge"))); return; }
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(t("brands.logoBadFile"))); };
    img.src = url;
  });
}

// ------------------------------------------------------------ page
let brandsNotice = "";

function channelsLabel(n) {
  if (!n) return t("brands.noChannels");
  return n === 1 ? t("brands.channelsOne") : t("brands.channelsMany", { n });
}

function brandCardHtml(b) {
  const initial = esc(String(b.name || "?").trim().charAt(0).toUpperCase() || "?");
  return `
  <button class="bp-card" data-brand-open="${esc(b.id)}" type="button">
    ${b.logo ? `<img class="bp-thumb" src="${esc(b.logo)}" alt="" />` : `<span class="bp-initial" aria-hidden="true">${initial}</span>`}
    <span class="bp-card-main">
      <span class="bp-card-name">${esc(b.name || "")}</span>
      <span class="bp-card-sub">${esc(channelsLabel((b.channels || []).length))}</span>
    </span>
  </button>`;
}

function demoCardHtml(w) {
  return `
  <div class="bp-card static">
    <span class="bp-initial" aria-hidden="true">${esc(String(w.name || "?").trim().charAt(0).toUpperCase() || "?")}</span>
    <span class="bp-card-main">
      <span class="bp-card-name">${esc(w.name || "")} <span class="pill">${esc(t("brands.madeUp"))}</span></span>
      ${w.short ? `<span class="bp-card-sub">${esc(w.short)}</span>` : ""}
    </span>
  </div>`;
}

export async function renderBrandsPage(r = {}) {
  const host = $("#content");
  if (!host) return;
  brandsPageLive = true;
  const brandId = r.brandId || "";
  if (brandsUser === undefined) {
    host.innerHTML = `<section class="panel"><h3>${esc(t("brands.title"))}</h3><p class="empty">${esc(t("account.oneMoment"))}</p></section>`;
    setTimeout(() => { if (brandsPageLive && location.hash.startsWith("#/brands")) renderBrandsPage(r); }, 600);
    return;
  }
  if (!brandsUser) {
    host.innerHTML = `<section class="panel"><h3>${esc(t("brands.title"))}</h3><p class="empty">${esc(t("brands.signIn"))}</p></section>`;
    return;
  }
  const user = brandsUser;
  const uid = user.uid;
  const demo = Boolean(user.isAnonymous);
  host.innerHTML = `<section class="panel"><h3>${esc(t("brands.title"))}</h3><p class="empty">${esc(t("brands.loading"))}</p></section>`;
  let brands;
  try { brands = await loadBrands(uid); }
  catch (err) {
    host.innerHTML = `<section class="panel"><h3>${esc(t("brands.title"))}</h3><p class="empty">${esc(t("brands.loadFailed"))} (${esc(err.message)})</p></section>`;
    return;
  }
  if (DATA) DATA.brands = brands;
  const open = brandId ? brands.find((b) => b.id === brandId) || null : null;
  if (open) return renderBrandPage(host, user, open);
  return renderBrandsList(host, user, brands, demo);
}

function renderBrandsList(host, user, brands, demo) {
  const allWorkers = demo && DATA && Array.isArray(DATA.workers) ? DATA.workers : [];
  // Dogfood fix (ISSUE-003): the demo seeds its two businesses BOTH as
  // worker cards and as brand records. A business with a brand record
  // shows once — as the record's openable card — never twice.
  const docNames = new Set(brands.map((b) => String(b.name || "").trim().toLowerCase()));
  const workers = allWorkers.filter((w) => !docNames.has(String(w.name || "").trim().toLowerCase()));
  host.innerHTML = `
  <section class="panel">
    <div class="panel-head"><h3>${esc(t("brands.title"))}</h3></div>
    <p>${esc(t("brands.intro"))}</p>
    ${brandsNotice ? `<p class="form-note">${esc(brandsNotice)}</p>` : ""}
    ${workers.length ? `
    <div class="panel-head"><h3>${esc(t("brands.demoTitle"))}</h3></div>
    <div class="bp-cards">${workers.map(demoCardHtml).join("")}</div>` : ""}
    ${brands.length ? `<div class="bp-cards">${brands.map(brandCardHtml).join("")}</div>`
      : (workers.length ? "" : `<p class="empty">${esc(t("brands.empty"))}</p>`)}
    <form class="bp-new" id="bpBrandNew">
      <input id="bpBrandName" type="text" maxlength="80" placeholder="${esc(t("brands.addPh"))}" aria-label="${esc(t("brands.addPh"))}" />
      <button class="btn" type="submit">${esc(t("brands.add"))}</button>
    </form>
  </section>`;
  host.querySelectorAll("[data-brand-open]").forEach((el) => el.addEventListener("click", () => {
    location.hash = `#/brands/${el.getAttribute("data-brand-open")}`;
  }));
  const form = host.querySelector("#bpBrandNew");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = host.querySelector("#bpBrandName").value.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
      + "-" + Math.random().toString(36).slice(2, 8);
    const brand = { id, name, logo: "", channels: [], kit: EMPTY_KIT(), createdAt: nowIso(), updatedAt: nowIso() };
    try {
      await saveBrand(user, brand);
      brandsNotice = t("brands.added", { name });
      location.hash = `#/brands/${id}`;
    } catch (err) {
      brandsNotice = `${t("brands.notSaved")} (${err.message})`;
      renderBrandsPage({});
    }
  });
}

const listRow = (value, phKey, attr) => `
  <div class="bp-row" ${attr}>
    <input type="text" value="${esc(value || "")}" placeholder="${esc(t(phKey))}" maxlength="300" data-list-val aria-label="${esc(t(phKey))}" />
    <button class="btn soft" type="button" data-row-remove>${esc(t("brands.remove"))}</button>
  </div>`;

function kitHtml(kit) {
  const banks = Object.entries(kit.hashtag_banks || {});
  return `
  <form id="bpKitForm" class="bp-kit">
    <label class="kit-field"><span>${esc(t("brands.kitVoice"))}</span>
      <textarea id="bpKitVoice" rows="3" maxlength="8000" placeholder="${esc(t("brands.kitVoicePh"))}">${esc(kit.voice_notes || "")}</textarea></label>
    <div class="panel-head"><h3>${esc(t("brands.kitTone"))}</h3></div>
    <div id="bpKitTone">${(kit.tone_samples || []).map((v) => listRow(v, "brands.kitTonePh", "data-tone-row")).join("")}</div>
    <p><button class="btn soft" type="button" data-kit-add="bpKitTone">${esc(t("brands.kitAddRow"))}</button></p>
    <label class="kit-field"><span>${esc(t("brands.kitDo"))}</span>
      <input id="bpKitDo" type="text" maxlength="500" placeholder="${esc(t("brands.kitCommaPh"))}" value="${esc((kit.do_words || []).join(", "))}" /></label>
    <label class="kit-field"><span>${esc(t("brands.kitDont"))}</span>
      <input id="bpKitDont" type="text" maxlength="500" placeholder="${esc(t("brands.kitCommaPh"))}" value="${esc((kit.dont_words || []).join(", "))}" /></label>
    <div class="panel-head"><h3>${esc(t("brands.kitColours"))}</h3></div>
    <div id="bpKitColours">${(kit.colours || []).map((c) => `
      <div class="bp-row" data-colour-row>
        <span class="bp-swatch" data-swatch style="background:${esc(c)}"></span>
        <input type="text" value="${esc(c)}" placeholder="${esc(t("brands.kitColourPh"))}" data-colour-val aria-label="${esc(t("brands.kitColours"))}" />
        <button class="btn soft" type="button" data-row-remove>${esc(t("brands.remove"))}</button>
      </div>`).join("")}</div>
    <p><button class="btn soft" type="button" data-kit-add="bpKitColours">${esc(t("brands.kitAddRow"))}</button></p>
    <div class="panel-head"><h3>${esc(t("brands.kitBanks"))}</h3></div>
    <div id="bpKitBanks">${banks.map(([name, tags]) => `
      <div class="bp-row" data-bank-row>
        <input type="text" value="${esc(name)}" placeholder="${esc(t("brands.kitBankNamePh"))}" maxlength="60" data-bank-name aria-label="${esc(t("brands.kitBankNamePh"))}" />
        <input type="text" value="${esc((tags || []).join(", "))}" placeholder="${esc(t("brands.kitBankTagsPh"))}" maxlength="1000" data-bank-tags aria-label="${esc(t("brands.kitBankTagsPh"))}" />
        <button class="btn soft" type="button" data-row-remove>${esc(t("brands.remove"))}</button>
      </div>`).join("")}</div>
    <p><button class="btn soft" type="button" data-kit-add="bpKitBanks">${esc(t("brands.kitAddRow"))}</button></p>
    <div class="panel-head"><h3>${esc(t("brands.kitFirst"))}</h3></div>
    <div id="bpKitFirst">${(kit.first_comments || []).map((v) => listRow(v, "brands.kitFirstPh", "data-first-row")).join("")}</div>
    <p><button class="btn soft" type="button" data-kit-add="bpKitFirst">${esc(t("brands.kitAddRow"))}</button></p>
    <div class="panel-head"><h3>${esc(t("brands.kitAssets"))}</h3></div>
    <div id="bpKitAssets">${(kit.assets || []).map((a) => `
      <div class="bp-row" data-asset-row>
        <input type="text" value="${esc(a.label || "")}" placeholder="${esc(t("brands.kitAssetLabelPh"))}" maxlength="80" data-asset-label aria-label="${esc(t("brands.kitAssetLabelPh"))}" />
        <input type="text" value="${esc(a.url || "")}" placeholder="${esc(t("brands.kitAssetUrlPh"))}" maxlength="500" data-asset-url aria-label="${esc(t("brands.kitAssetUrlPh"))}" />
        <button class="btn soft" type="button" data-row-remove>${esc(t("brands.remove"))}</button>
      </div>`).join("")}</div>
    <p><button class="btn soft" type="button" data-kit-add="bpKitAssets">${esc(t("brands.kitAddRow"))}</button></p>
    <p>
      <button class="btn" type="submit">${esc(t("brands.kitSave"))}</button>
      <span class="form-note" id="bpKitNote"></span>
    </p>
  </form>`;
}

function renderBrandPage(host, user, brand) {
  const kit = kitOf(brand);
  host.innerHTML = `
  <section class="panel">
    <a class="bp-back" href="#/brands">← ${esc(t("brands.back"))}</a>
    <div class="panel-head"><h3>${esc(brand.name || "")}</h3></div>
    ${brandsNotice ? `<p class="form-note">${esc(brandsNotice)}</p>` : ""}
    <div class="panel-head"><h3>${esc(t("brands.nameLabel"))}</h3></div>
    <div class="name-row">
      <input id="bpBrandEditName" type="text" maxlength="80" value="${esc(brand.name || "")}" aria-label="${esc(t("brands.nameLabel"))}" />
      <button class="btn soft" id="bpBrandNameSave" type="button">${esc(t("common.save"))}</button>
    </div>
    <p class="form-note" id="bpNameNote"></p>
    <div class="panel-head"><h3>${esc(t("brands.logoTitle"))}</h3></div>
    ${brand.logo ? `<p><img class="bp-logo-img" src="${esc(brand.logo)}" alt="" /></p>` : `<p class="form-note">${esc(t("brands.noLogo"))}</p>`}
    <div class="name-row">
      <label class="btn soft" for="bpLogoFile" style="cursor:pointer">${esc(brand.logo ? t("brands.swapLogo") : t("brands.uploadLogo"))}</label>
      <input id="bpLogoFile" type="file" accept="image/*" hidden />
      ${brand.logo ? `<button class="btn soft" id="bpLogoRemove" type="button">${esc(t("brands.removeLogo"))}</button>` : ""}
    </div>
    <p class="form-note" id="bpLogoNote"></p>
    <div class="panel-head"><h3>${esc(t("brands.channelsTitle"))}</h3></div>
    <div id="bpChannels">
      ${(brand.channels || []).map((c, i) => channelRowHtml(c, i)).join("")}
    </div>
    <div class="name-row">
      <button class="btn soft" id="bpChannelAdd" type="button">${esc(t("brands.addChannel"))}</button>
      <button class="btn" id="bpChannelsSave" type="button">${esc(t("brands.saveChannels"))}</button>
    </div>
    <p class="form-note" id="bpChannelsNote"></p>
    <div class="panel-head"><h3>${esc(t("brands.kitTitle"))}</h3></div>
    <p>${esc(t("brands.kitIntro"))}</p>
    ${kitHtml(kit)}
    <p>${esc(t("brands.plannerLine"))} <a href="#/planner">${esc(t("brands.seePlanner"))}</a></p>
    <div class="panel-head"><h3>${esc(t("brands.removeBrand"))}</h3></div>
    <p>
      <button class="btn soft" id="bpBrandRemove" type="button">${esc(t("brands.removeBrand"))}</button>
      <span class="form-note" id="bpRemoveNote"></span>
    </p>
  </section>`;
  wireBrandPage(host, user, brand);
}

function channelRowHtml(c, i) {
  return `
  <div class="bp-row" data-channel-row="${i}">
    <select data-ch-platform aria-label="${esc(t("brands.channelPlatform"))}">
      ${PLATFORMS.map((p) => `<option value="${esc(p)}" ${c.platform === p ? "selected" : ""}>${esc(p)}</option>`).join("")}
    </select>
    <input type="text" maxlength="100" placeholder="${esc(t("brands.channelHandle"))}" value="${esc(c.handle || "")}" data-ch-handle aria-label="${esc(t("brands.channelHandle"))}" />
    <span class="pill">${esc(t("brands.notConnected"))}</span>
    <button class="btn soft" type="button" data-ch-remove="${i}">${esc(t("brands.remove"))}</button>
  </div>`;
}

function wireBrandPage(host, user, brand) {
  const reread = async () => (await loadBrands(user.uid)).find((b) => b.id === brand.id) || brand;

  // Dogfood fix (ISSUE-004): a brand can be removed. Arm, then
  // confirm — the app's two-tap pattern. The brand's planned posts
  // go with it (they key to this brand and would point at nothing).
  const removeBtn = host.querySelector("#bpBrandRemove");
  if (removeBtn) {
    let armed = false;
    removeBtn.addEventListener("click", async () => {
      const note = host.querySelector("#bpRemoveNote");
      if (!armed) {
        armed = true;
        removeBtn.textContent = t("brands.removeArm");
        return;
      }
      removeBtn.disabled = true;
      try {
        const db = await firebaseDb();
        const { collection, getDocs } = await fs();
        const snap = await getDocs(collection(db, "users", user.uid, "plannedPosts"));
        for (const d of snap.docs) {
          if ((d.data() || {}).brandId === brand.id) await deleteUserRecord(user, "plannedPosts", d.id);
        }
        await deleteUserRecord(user, "brands", brand.id);
        if (DATA) DATA.brands = (DATA.brands || []).filter((b) => b.id !== brand.id);
        brandsNotice = t("brands.removed", { name: brand.name || "" });
        location.hash = "#/brands";
      } catch (err) {
        if (note) note.textContent = `${t("brands.notSaved")} (${err.message})`;
        removeBtn.disabled = false;
      }
    });
  }

  const nameSave = host.querySelector("#bpBrandNameSave");
  nameSave.addEventListener("click", async () => {
    const note = host.querySelector("#bpNameNote");
    const fresh = await reread();
    fresh.name = host.querySelector("#bpBrandEditName").value.trim();
    try { await saveBrand(user, fresh); brandsNotice = t("brands.saved"); renderBrandsPage({ brandId: brand.id }); }
    catch (err) { if (note) note.textContent = `${t("brands.notSaved")} (${err.message})`; }
  });

  const logoFile = host.querySelector("#bpLogoFile");
  logoFile.addEventListener("change", async () => {
    const note = host.querySelector("#bpLogoNote");
    const file = logoFile.files && logoFile.files[0];
    if (!file) return;
    try {
      const logo = await fileToLogo(file);
      const fresh = await reread();
      fresh.logo = logo;
      await saveBrand(user, fresh);
      brandsNotice = t("brands.saved");
      renderBrandsPage({ brandId: brand.id });
    } catch (err) { if (note) note.textContent = err.message; }
  });
  const logoRemove = host.querySelector("#bpLogoRemove");
  if (logoRemove) logoRemove.addEventListener("click", async () => {
    const fresh = await reread();
    fresh.logo = "";
    try { await saveBrand(user, fresh); brandsNotice = t("brands.saved"); renderBrandsPage({ brandId: brand.id }); }
    catch (err) { brandsNotice = `${t("brands.notSaved")} (${err.message})`; renderBrandsPage({ brandId: brand.id }); }
  });

  const readChannels = () => [...host.querySelectorAll("[data-channel-row]")].map((row) => ({
    platform: row.querySelector("[data-ch-platform]").value,
    handle: row.querySelector("[data-ch-handle]").value.trim(),
  })).filter((c) => c.handle);
  const wireChannelRemove = (scope) => {
    scope.querySelectorAll("[data-ch-remove]").forEach((btn) => btn.addEventListener("click", () => {
      const row = btn.closest("[data-channel-row]");
      if (row) row.remove();
    }));
  };
  wireChannelRemove(host);
  host.querySelector("#bpChannelAdd").addEventListener("click", () => {
    const list = host.querySelector("#bpChannels");
    const div = document.createElement("div");
    div.innerHTML = channelRowHtml({ platform: PLATFORMS[0], handle: "" }, list.children.length);
    const row = div.firstElementChild;
    list.appendChild(row);
    wireChannelRemove(row.parentElement);
    const inp = row.querySelector("[data-ch-handle]");
    if (inp) inp.focus();
  });
  host.querySelector("#bpChannelsSave").addEventListener("click", async () => {
    const note = host.querySelector("#bpChannelsNote");
    const fresh = await reread();
    fresh.channels = readChannels();
    try {
      await saveBrand(user, fresh);
      brandsNotice = t("brands.channelsSaved");
      renderBrandsPage({ brandId: brand.id });
    } catch (err) { if (note) note.textContent = `${t("brands.notSaved")} (${err.message})`; }
  });

  // ---- the kit: rows are DOM state until Save kit writes the
  // whole kit onto a fresh-read brand record in one write.
  const wireRowRemove = (scope) => {
    scope.querySelectorAll("[data-row-remove]").forEach((btn) => btn.addEventListener("click", () => {
      const row = btn.closest(".bp-row");
      if (row) row.remove();
    }));
  };
  wireRowRemove(host);
  host.querySelectorAll("[data-kit-add]").forEach((btn) => btn.addEventListener("click", () => {
    const targetId = btn.getAttribute("data-kit-add");
    const list = host.querySelector("#" + targetId);
    if (!list) return;
    const div = document.createElement("div");
    if (targetId === "bpKitColours") {
      div.innerHTML = `<div class="bp-row" data-colour-row>
        <span class="bp-swatch" data-swatch></span>
        <input type="text" value="" placeholder="${esc(t("brands.kitColourPh"))}" data-colour-val aria-label="${esc(t("brands.kitColours"))}" />
        <button class="btn soft" type="button" data-row-remove>${esc(t("brands.remove"))}</button></div>`;
    } else if (targetId === "bpKitBanks") {
      div.innerHTML = `<div class="bp-row" data-bank-row>
        <input type="text" value="" placeholder="${esc(t("brands.kitBankNamePh"))}" maxlength="60" data-bank-name aria-label="${esc(t("brands.kitBankNamePh"))}" />
        <input type="text" value="" placeholder="${esc(t("brands.kitBankTagsPh"))}" maxlength="1000" data-bank-tags aria-label="${esc(t("brands.kitBankTagsPh"))}" />
        <button class="btn soft" type="button" data-row-remove>${esc(t("brands.remove"))}</button></div>`;
    } else if (targetId === "bpKitAssets") {
      div.innerHTML = `<div class="bp-row" data-asset-row>
        <input type="text" value="" placeholder="${esc(t("brands.kitAssetLabelPh"))}" maxlength="80" data-asset-label aria-label="${esc(t("brands.kitAssetLabelPh"))}" />
        <input type="text" value="" placeholder="${esc(t("brands.kitAssetUrlPh"))}" maxlength="500" data-asset-url aria-label="${esc(t("brands.kitAssetUrlPh"))}" />
        <button class="btn soft" type="button" data-row-remove>${esc(t("brands.remove"))}</button></div>`;
    } else if (targetId === "bpKitTone") {
      div.innerHTML = listRow("", "brands.kitTonePh", "data-tone-row");
    } else {
      div.innerHTML = listRow("", "brands.kitFirstPh", "data-first-row");
    }
    const row = div.firstElementChild;
    list.appendChild(row);
    wireRowRemove(row.parentElement);
    const inp = row.querySelector("input");
    if (inp) inp.focus();
  }));
  // Colour swatches preview as the user types, on rows the brand
  // already had and rows added just now alike (one delegated
  // listener on the page host, which survives the form's rows).
  host.addEventListener("input", (e) => {
    if (!e.target.matches("[data-colour-val]")) return;
    const sw = e.target.closest(".bp-row")?.querySelector("[data-swatch]");
    if (sw) sw.style.background = e.target.value.trim();
  });

  host.querySelector("#bpKitForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = host.querySelector("#bpKitNote");
    const csv = (v) => String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
    const lines = (sel) => [...host.querySelectorAll(sel)].map((i) => i.value.trim()).filter(Boolean);
    const banks = {};
    host.querySelectorAll("[data-bank-row]").forEach((row) => {
      const name = row.querySelector("[data-bank-name]").value.trim();
      if (!name) return;
      banks[name] = csv(row.querySelector("[data-bank-tags]").value);
    });
    const assets = [...host.querySelectorAll("[data-asset-row]")].map((row) => ({
      label: row.querySelector("[data-asset-label]").value.trim(),
      url: row.querySelector("[data-asset-url]").value.trim(),
    })).filter((a) => a.label || a.url);
    const kit = {
      voice_notes: host.querySelector("#bpKitVoice").value,
      tone_samples: lines("[data-tone-row] [data-list-val]"),
      do_words: csv(host.querySelector("#bpKitDo").value),
      dont_words: csv(host.querySelector("#bpKitDont").value),
      colours: lines("[data-colour-row] [data-colour-val]"),
      hashtag_banks: banks,
      first_comments: lines("[data-first-row] [data-list-val]"),
      assets,
    };
    const fresh = await reread();
    fresh.kit = kit;
    try {
      await saveBrand(user, fresh);
      brandsNotice = t("brands.kitSaved");
      renderBrandsPage({ brandId: brand.id });
    } catch (err) { if (note) note.textContent = `${t("brands.notSaved")} (${err.message})`; }
  });
}
