// PRODUCT build equivalents of ./room-strings.js — vite.config.js
// aliases ./room-strings.js to this file under PRODUCT_BUILD=1, so
// the public bundle carries generic wording only: no owner name in
// any label or matcher. Keep the two files' export lists identical.
export const WAITING_ON_OWNER_LABEL = "Waiting";
export const HERO_OWNER_LINE = "Your socials";
// Product data is the signed-in user's own; no record in it carries
// an owner-gated verdict, so this matcher never fires.
export const WITH_OWNER_RE = /$^/;
export const SOCIALS_OWNER_LABEL = "Your Socials";
export const SOCIALS_PANEL_LABEL = "Socials";
export const SOCIALS_BRAND_LABEL = "YOUR SOCIALS";
