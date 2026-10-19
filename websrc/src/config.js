// Build-time config. When the VITE_ vars are empty (before the Supabase
// project exists), the app runs in PREVIEW mode on bundled seed data and
// says so on screen. Nothing is faked: preview data is the same seed the
// database will hold, generated from the workers' real files.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
export const LIVE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
export const FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "";

// Palette: burgundy + pink shades — Ilse's brand palette (her order,
// 11 Oct 2026, reversing this app's 10 Oct 2026 Pastel Flow assignment;
// Pastel Flow still governs her posts and personal brand surfaces outside
// this app). The Apex navy belongs to the Apex room only. Full note:
// PALETTE.md.
export const PALETTE = {
  burgundy: "#C93327",
  wineDeep: "#33161F",
  claret: "#A8261E",
  dustyRose: "#FF9A8A",
  babyPink: "#FFC4B8",
  pinkSoft: "#FFE3D6",
  pinkPale: "#FFF1E4",
  ground: "#FFF4E8",
  ink: "#33161F",
  inkSoft: "#755144",
};

