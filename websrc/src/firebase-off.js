// Accounts phase — Firebase shell, BUILD-TIME OFF state. When the build has
// no VITE_FIREBASE_* vars, vite.config.js aliases "app-firebase" to THIS file
// instead of src/firebase.js — so no Firebase SDK code reaches the bundle at
// all (Store Review SR-F3: one story per release). Same exports, all no-ops.
export const FIREBASE_ON = false;
export function withTimeout(promise, ms, label) {
  let timer = null;
  const bound = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label || "sdk-timeout")), ms);
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}
export async function firebaseApp() { return null; }
export async function firebaseAuth() { return null; }
export async function firebaseDb() { return null; }
export async function firebaseFirestore() { throw new Error("accounts-off"); }
export function firebaseUser() { return null; }
export async function watchFirebaseUser() { return () => {}; }
export async function completeEmailLink() { return null; }
export async function signUpWithPassword() { throw new Error("accounts-off"); }
export async function signInWithPassword() { throw new Error("accounts-off"); }
export async function sendPasswordReset() { throw new Error("accounts-off"); }
export async function signInGoogle() { throw new Error("accounts-off"); }
export async function signInApple() { throw new Error("accounts-off"); }
export async function signInDemoAnon() { throw new Error("accounts-off"); }
export async function signOutUser() { return; }
export async function reauthenticateCurrentUser() { throw new Error("accounts-off"); }
export async function deleteCurrentUser() { throw new Error("accounts-off"); }
