// ------------------------------------------------------------------
// RevenueCat attach (Payments Chapter, enabling build).
//
// The client half has exactly three jobs:
//   1. configure RevenueCat with the signed-in user's Firebase uid
//      as the RC app user id, so webhook events arrive already named
//      in the entitlement record's own key;
//   2. show the Current offering's own price strings on the Plans
//      surface (the buttons and the renewal disclosure read the same
//      source, so they can never drift apart);
//   3. run the store purchase / restore dialogs.
//
// It NEVER unlocks anything. A completed purchase is only a store
// fact: the system webhook receiver writes _entitlements/{uid}, and
// plans.js opens Plus from that record alone (Chapter §3, the only
// unlock rule). The public key below is RevenueCat's public SDK key
// for this app — public by design, shipped in the client.

const RC_PUBLIC_SDK_KEY = "appl_zysTHAeqyBusPsygYmEITBlRHtn";
export const PLUS_PRODUCT_IDS = {
  monthly: "ruefly_plus_monthly",
  yearly: "ruefly_plus_yearly",
};

let sdkPromise = null;
let configuredUid = "";
let offeringCache = null; // { monthly: pkgView, yearly: pkgView }
const rawPackages = new Map(); // productId -> PurchasesPackage (kept whole for purchasePackage)

function nativePlatform() {
  try {
    const cap = typeof window !== "undefined" ? window.Capacitor : null;
    return Boolean(cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform());
  } catch {
    return false;
  }
}

export function purchasesNative() {
  return nativePlatform();
}

async function sdk() {
  if (!sdkPromise) {
    sdkPromise = import("@revenuecat/purchases-capacitor")
      .then((mod) => mod.Purchases)
      .catch((e) => {
        sdkPromise = null;
        throw e;
      });
  }
  return sdkPromise;
}

function packageView(pkg) {
  if (!pkg || !pkg.product) return null;
  return {
    productId: String(pkg.product.identifier || ""),
    priceString: String(pkg.product.priceString || ""),
    title: String(pkg.product.title || ""),
  };
}

// Configure (or re-identify) RevenueCat for this account, then load
// the Current offering. Safe to call on every entry: it no-ops when
// the same uid is already configured, and logIn()s when the account
// changed. Returns the offering view ({ monthly, yearly } | null).
export async function initPurchases(uid) {
  if (!uid || !nativePlatform()) return null;
  const Purchases = await sdk();
  if (configuredUid && configuredUid !== uid) {
    await Purchases.logIn({ appUserID: uid });
    configuredUid = uid;
    offeringCache = null;
    rawPackages.clear();
  } else if (!configuredUid) {
    await Purchases.configure({ apiKey: RC_PUBLIC_SDK_KEY, appUserID: uid });
    configuredUid = uid;
  }
  return loadPlusOffering();
}

export async function loadPlusOffering() {
  if (!configuredUid) return null;
  if (offeringCache) return offeringCache;
  const Purchases = await sdk();
  const offerings = await Purchases.getOfferings();
  const current = offerings && offerings.current;
  if (!current) return null;
  rawPackages.clear();
  const view = { monthly: null, yearly: null };
  const pkgs = [];
  if (current.monthly) pkgs.push(current.monthly);
  if (current.annual) pkgs.push(current.annual);
  for (const pkg of current.availablePackages || []) {
    if (!pkgs.includes(pkg)) pkgs.push(pkg);
  }
  for (const pkg of pkgs) {
    const v = packageView(pkg);
    if (!v || !v.productId) continue;
    rawPackages.set(v.productId, pkg);
    if (v.productId === PLUS_PRODUCT_IDS.monthly) view.monthly = v;
    if (v.productId === PLUS_PRODUCT_IDS.yearly) view.yearly = v;
  }
  offeringCache = view;
  return view;
}

export function plusOffering() {
  return offeringCache;
}

function purchaseCancelled(e) {
  if (!e) return false;
  if (e.userCancelled === true) return true;
  const code = String(e.code || e.errorCode || "").toLowerCase();
  return code.includes("cancel") || code === "1";
}

// Run the store dialog for one Plus package. The result NEVER
// carries an unlock — only what the store said. "purchased" means
// the store completed; Plus opens when the system record lands and
// the caller re-reads it.
export async function buyPlus(kind) {
  if (!nativePlatform()) return { status: "unavailable" };
  if (!configuredUid) return { status: "failed" };
  const productId = PLUS_PRODUCT_IDS[kind];
  let pkg = rawPackages.get(productId);
  if (!pkg) {
    await loadPlusOffering();
    pkg = rawPackages.get(productId);
  }
  if (!pkg) return { status: "failed" };
  const Purchases = await sdk();
  try {
    const result = await Purchases.purchasePackage({ aPackage: pkg });
    const info = result && result.customerInfo;
    const active = Boolean(
      info && info.entitlements && info.entitlements.active && info.entitlements.active.plus,
    );
    return { status: active ? "purchased" : "completed" };
  } catch (e) {
    if (purchaseCancelled(e)) return { status: "cancelled" };
    return { status: "failed" };
  }
}

// Restore: the store re-proves an earlier purchase to RevenueCat,
// whose webhook then lands (or refreshes) the system record. The
// client still opens nothing itself.
export async function restorePlus() {
  if (!nativePlatform()) return { status: "unavailable" };
  if (!configuredUid) return { status: "failed" };
  const Purchases = await sdk();
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const active = Boolean(
      customerInfo &&
        customerInfo.entitlements &&
        customerInfo.entitlements.active &&
        customerInfo.entitlements.active.plus,
    );
    return { status: active ? "restored" : "none" };
  } catch {
    return { status: "failed" };
  }
}

// Sign-out hygiene: RevenueCat returns to an anonymous id, so the
// next account on this device never inherits this one's store view.
export async function resetPurchases() {
  const wasConfigured = Boolean(configuredUid);
  configuredUid = "";
  offeringCache = null;
  rawPackages.clear();
  if (!wasConfigured || !nativePlatform()) return;
  try {
    const Purchases = await sdk();
    await Purchases.logOut();
  } catch {
    // The local state is already cleared; a failed logOut must never
    // block the app's own sign-out.
  }
}
