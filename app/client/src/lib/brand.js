// The client's half of the brand. Mirrors server/lib/brand.js.
//
// Kept as plain constants rather than fetched: the wordmark and the login
// heading are the first thing painted, and a name that arrives a beat late
// reads as a page that hasn't finished loading.
//
//   BRAND_FULL  — where the product introduces itself: the tab title, the
//                 wordmark, the signup and login headings, booking pages.
//   BRAND_SHORT — in running prose, where the full name would read as
//                 shouting: "your Kairos account".

export const BRAND_SHORT = 'Kairos';
export const BRAND_FULL = 'Kairos by Exousia';
export const BRAND_COMPANY = 'Exousia Prime Emporium Ltd';
