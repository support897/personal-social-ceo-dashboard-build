// Room (legacy) literals for the private room build — the strings
// that name the owner. The PRODUCT build never ships this file:
// vite.config.js aliases ./room-strings.js to
// ./room-strings-product.js under PRODUCT_BUILD=1, where every value
// here has a generic equivalent. Keep the two files' export lists
// identical.
export const WAITING_ON_OWNER_LABEL = "Waiting on Ilse";
export const HERO_OWNER_LINE = "Ilse, as herself";
export const WITH_OWNER_RE = /^With Ilse/i;
export const SOCIALS_OWNER_LABEL = "Her Socials";
export const SOCIALS_PANEL_LABEL = "Her socials";
export const SOCIALS_BRAND_LABEL = "HER SOCIALS";
