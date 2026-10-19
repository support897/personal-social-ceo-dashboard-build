// Accounts phase — Firebase shell (P1). DORMANT until the VITE_FIREBASE_*
// build vars exist (they arrive with Ilse's Firebase project). While dormant
// this module connects to nothing and changes nothing: the app runs on its
// current doors exactly as before. When the vars exist, it initialises
// Firebase Auth (email link, Google, Apple per the ILSE-STANDARD §5 standard)
// and Firestore, where the user's uid keys every record (users/{uid}).
// Project config — PUBLIC by design (these values ship in every visitor's
// bundle; the Security Rules are the wall, not secrecy). Per-app project:
// this file's values belong to THIS app only, never shared with the other.
const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBPq7NuTovnLg9wsplsWmQGEQs6N3FseOA",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "ilse-socials.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "ilse-socials",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:316440145161:web:8e949828485de67c2ab7d8",
  storageBucket: "ilse-socials.firebasestorage.app",
  messagingSenderId: "316440145161",
};
export const FIREBASE_ON = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

// BOOT RESILIENCE (her phone finding, build 13, 19 Oct): every SDK
// wait in this module is BOUNDED. On a real device the web SDK's
// auth chain can stall without ever settling (its persistence
// layer inside WKWebView is the flaky step) — an unbounded await
// here is what stranded the boot splash on "One moment…" forever,
// and the same shape hangs a native door tap when the plugin's
// promise never settles. withTimeout turns a silent hang into a
// named, honest failure the callers already know how to show; a
// timed-out module promise is FORGOTTEN, so the next call retries
// the load instead of inheriting the wedge.
export function withTimeout(promise, ms, label) {
  let timer = null;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || "sdk-timeout")), ms);
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}

let appPromise = null;
export async function firebaseApp() {
  if (!FIREBASE_ON) return null;
  if (!appPromise) {
    appPromise = import("firebase/app").then(({ initializeApp }) => initializeApp(cfg));
  }
  try {
    return await withTimeout(appPromise, 10000, "app-timeout");
  } catch (e) {
    if (e && e.message === "app-timeout") appPromise = null;
    throw e;
  }
}

let authPromise = null;
export async function firebaseAuth() {
  const app = await firebaseApp();
  if (!app) return null;
  if (!authPromise) {
    authPromise = import("firebase/auth").then((mod) => {
      // Persistence is named, not defaulted: the default chain
      // settles through IndexedDB, the layer that can stall inside
      // WKWebView under the packaged app's scheme. Browser-local
      // persistence is the reliable settler in that webview (and
      // works identically on the open web). If Auth was already
      // initialised by an earlier race, getAuth returns it.
      try {
        return mod.initializeAuth(app, { persistence: mod.browserLocalPersistence });
      } catch {
        return mod.getAuth(app);
      }
    });
  }
  try {
    return await withTimeout(authPromise, 10000, "auth-timeout");
  } catch (e) {
    if (e && e.message === "auth-timeout") authPromise = null;
    throw e;
  }
}

// Firestore (P3): the per-user data base. The uid keys every record —
// all reads/writes live under users/{uid} (see src/user-store.js).
let dbPromise = null;
export async function firebaseDb() {
  const app = await firebaseApp();
  if (!app) return null;
  if (!dbPromise) {
    dbPromise = import("firebase/firestore").then(({ getFirestore }) => getFirestore(app));
  }
  return dbPromise;
}

// The Firestore module itself, handed out ONLY through this alias
// module: src/user-store.js lazy-loads it from here, never from the
// "firebase/firestore" package directly — so a FIREBASE_OFF build
// (which swaps this whole file for the stub) carries zero Firestore
// SDK bytes and no user-store chunk (SR-F3, slice 1 QA F1).
export async function firebaseFirestore() {
  return import("firebase/firestore");
}

// Tracks the signed-in Firebase user (null when dormant or signed out).
// P1 wires the listener only — no screen changes until the project exists
// and the sign-in door can be tested end to end.
let currentUser = null;
export function firebaseUser() { return currentUser; }
export async function watchFirebaseUser(cb) {
  const auth = await firebaseAuth();
  if (!auth) return () => {};
  const { onAuthStateChanged } = await import("firebase/auth");
  return onAuthStateChanged(auth, (u) => { currentUser = u; if (cb) cb(u); });
}

// ---- The doors. The set is EXCLUSIVE (her ruling, 15 Oct): Google ·
// Apple · email + the user's own chosen password (below). The email
// LINK was retired as a door the same day — no surface sends one; its
// completion path stays so a link already in flight still lands.
export async function completeEmailLink() {
  const auth = await firebaseAuth();
  if (!auth) return null;
  const { isSignInWithEmailLink, signInWithEmailLink } = await import("firebase/auth");
  if (!isSignInWithEmailLink(auth, window.location.href)) return null;
  let email = null;
  try { email = localStorage.getItem("fb_link_email"); } catch {}
  if (!email) email = window.prompt("Your email, to finish signing in");
  if (!email) return null;
  const cred = await signInWithEmailLink(auth, email, window.location.href);
  try { localStorage.removeItem("fb_link_email"); } catch {}
  return cred.user;
}

// ---- The email + password door (her ruling, 15 Oct): the email route
// is the address plus THE USER'S OWN chosen password. Firebase holds
// the password (hashed); this code only hands the form field over.
export async function signUpWithPassword(email, password) {
  const auth = await firebaseAuth();
  if (!auth) throw new Error("accounts-off");
  const { createUserWithEmailAndPassword } = await import("firebase/auth");
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function signInWithPassword(email, password) {
  const auth = await firebaseAuth();
  if (!auth) throw new Error("accounts-off");
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// The standard reset door: Firebase mails the reset link and the new
// password is chosen on Firebase's own page, never inside this app.
export async function sendPasswordReset(email) {
  const auth = await firebaseAuth();
  if (!auth) throw new Error("accounts-off");
  const { sendPasswordResetEmail } = await import("firebase/auth");
  await sendPasswordResetEmail(auth, email);
  return true;
}

// ---- The native branch (Native Doors Recipe of record, §6). Inside
// the packaged app the web popup flow cannot return, so on native the
// doors call the bundled @capacitor-firebase/authentication plugin and
// hand its credential to the SAME web SDK session. The plugin is
// reached through window.Capacitor.Plugins (never imported), so the
// web build carries no plugin bytes and the web doors stay untouched.
export function nativeAuthPlugin() {
  const cap = window.Capacitor;
  if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return null;
  const plug = (cap.Plugins || {}).FirebaseAuthentication;
  if (!plug || typeof plug.signInWithGoogle !== "function") return null;
  return plug;
}

export async function signInGoogle() {
  const auth = await firebaseAuth();
  if (!auth) throw new Error("accounts-off");
  const plug = nativeAuthPlugin();
  if (plug) {
    const result = await withTimeout(plug.signInWithGoogle(), 45000, "native-timeout");
    const idToken = result && result.credential && result.credential.idToken;
    if (!idToken) throw new Error("native-no-token");
    const { GoogleAuthProvider, signInWithCredential } = await import("firebase/auth");
    const cred = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    return cred.user;
  }
  const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const cred = await signInWithPopup(auth, new GoogleAuthProvider());
  return cred.user;
}

export async function signInApple() {
  const auth = await firebaseAuth();
  if (!auth) throw new Error("accounts-off");
  const plug = nativeAuthPlugin();
  if (plug) {
    const result = await withTimeout(plug.signInWithApple(), 45000, "native-timeout");
    const pc = (result && result.credential) || {};
    if (!pc.idToken) throw new Error("native-no-token");
    const { OAuthProvider, signInWithCredential } = await import("firebase/auth");
    // The plugin's nonce IS the raw nonce: pass it verbatim, never hashed.
    const provider = new OAuthProvider("apple.com");
    const cred = await signInWithCredential(auth, provider.credential({ idToken: pc.idToken, rawNonce: pc.nonce }));
    return cred.user;
  }
  const { OAuthProvider, signInWithPopup } = await import("firebase/auth");
  const cred = await signInWithPopup(auth, new OAuthProvider("apple.com"));
  return cred.user;
}

// The demo door (SPARK shape): an ANONYMOUS session in its own uid
// space. It carries no identity and can never be linked or upgraded
// into a real account; the unlock + seeding live in src/user-store.js.
export async function signInDemoAnon() {
  const auth = await firebaseAuth();
  if (!auth) throw new Error("accounts-off");
  const { signInAnonymously } = await import("firebase/auth");
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export async function signOutUser() {
  const auth = await firebaseAuth();
  if (!auth) return;
  const plug = nativeAuthPlugin();
  if (plug && typeof plug.signOut === "function") {
    try { await plug.signOut(); } catch {}
  }
  const { signOut } = await import("firebase/auth");
  await signOut(auth);
}

// Account deletion (Apple closure F1): removing the sign-in itself.
// Firebase asks for a FRESH sign-in before it deletes a user
// (auth/requires-recent-login), so the caller re-proves the user
// first through this road, which follows the user's own provider:
// email + password re-checks the password typed into the confirm
// sheet; Google / Apple re-prove through their own door (the native
// plugin branch inside the packaged app, the popup on web). An anonymous
// (demo) session holds no credential to re-check — it calls
// deleteCurrentUser directly, and a refusal there surfaces to the
// caller, which reports the partial state honestly.
export async function reauthenticateCurrentUser(password) {
  const auth = await firebaseAuth();
  if (!auth || !auth.currentUser) throw new Error("accounts-off");
  const user = auth.currentUser;
  const {
    EmailAuthProvider, GoogleAuthProvider, OAuthProvider,
    reauthenticateWithCredential, reauthenticateWithPopup,
  } = await import("firebase/auth");
  const providers = (user.providerData || []).map((p) => p && p.providerId);
  if (providers.includes("password")) {
    if (!password) {
      const e = new Error("password-needed");
      e.code = "auth/missing-password";
      throw e;
    }
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
    return "password";
  }
  if (providers.includes("google.com")) {
    const plug = nativeAuthPlugin();
    if (plug) {
      const result = await withTimeout(plug.signInWithGoogle(), 45000, "native-timeout");
      const idToken = result && result.credential && result.credential.idToken;
      if (!idToken) throw new Error("native-no-token");
      await reauthenticateWithCredential(user, GoogleAuthProvider.credential(idToken));
      return "google.com";
    }
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
    return "google.com";
  }
  if (providers.includes("apple.com")) {
    const plug = nativeAuthPlugin();
    if (plug) {
      const result = await withTimeout(plug.signInWithApple(), 45000, "native-timeout");
      const pc = (result && result.credential) || {};
      if (!pc.idToken) throw new Error("native-no-token");
      const provider = new OAuthProvider("apple.com");
      await reauthenticateWithCredential(user, provider.credential({ idToken: pc.idToken, rawNonce: pc.nonce }));
      return "apple.com";
    }
    await reauthenticateWithPopup(user, new OAuthProvider("apple.com"));
    return "apple.com";
  }
  const e = new Error("no-reauth-path");
  e.code = "auth/no-reauth-path";
  throw e;
}

export async function deleteCurrentUser() {
  const auth = await firebaseAuth();
  if (!auth || !auth.currentUser) throw new Error("accounts-off");
  await auth.currentUser.delete();
}
