// Ruefly — service worker. Its one real job is Web Push: receive the
// ping, show the notification, and (when the app has told it the function
// address) report the delivery back so HQ can prove push actually lands.
// It deliberately does NO response caching: the app itself is always
// fetched fresh, so a deploy can never be masked by a stale worker.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(clients.claim()));
self.addEventListener("fetch", () => {});

// The page hands over the (public) function address + anon key after
// registering, kept in IndexedDB so a push arriving while no page is
// open can still send its delivery receipt.
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("socials-push", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function cfgSet(value) {
  const db = await idbOpen();
  return new Promise((resolve) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, "cfg");
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
}
async function cfgGet() {
  const db = await idbOpen();
  return new Promise((resolve) => {
    const req = db.transaction("kv", "readonly").objectStore("kv").get("cfg");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}
self.addEventListener("message", (event) => {
  if (event.data?.type === "push-config") {
    event.waitUntil(cfgSet({ functionsUrl: event.data.functionsUrl, anonKey: event.data.anonKey }));
  }
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || "Ruefly";
  const jobs = [
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/app/" },
    }),
  ];
  if (data.nonce) {
    jobs.push((async () => {
      try {
        const cfg = await cfgGet();
        if (!cfg?.functionsUrl) return;
        await fetch(`${cfg.functionsUrl}/admin-api`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` },
          body: JSON.stringify({ action: "push_receipt", nonce: data.nonce }),
        });
      } catch { /* a lost receipt never blocks the notification itself */ }
    })());
  }
  event.waitUntil(Promise.all(jobs));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/app/";
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { w.focus(); return; } }
    await clients.openWindow(url);
  })());
});
