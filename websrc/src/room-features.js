// Build-time feature flag: the ROOM build carries the room-only
// surfaces (worker rooms). The product build aliases this module to
// ./room-features-product.js (ROOM_FEATURES = false), so room-only
// routes fold out of the public bundle.
export const ROOM_FEATURES = true;
