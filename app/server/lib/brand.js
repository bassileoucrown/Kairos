// How the product names itself, in one place.
//
// The name appears in a browser tab, a wordmark, a login heading, four kinds
// of email and a booking page seen by people who have no account. Scattering
// the literal across fifteen files is how a product ends up called two
// different things on the same screen.
//
// Two forms, used deliberately:
//   full  — the brand, where the product introduces itself. Tab title,
//           wordmark, signup and login headings, outbound email.
//   short — the same product in running prose, where the legal suffix would
//           read as shouting. "your Kairos account", not "your Kairos by
//           Exousia account".
//
// Overridable by environment so a deployment can carry a different name
// without a code change.

const SHORT = process.env.BRAND_SHORT_NAME || 'Kairos';
const FULL = process.env.BRAND_NAME || 'Kairos by Exousia';
const COMPANY = process.env.BRAND_COMPANY || 'Exousia Prime Emporium Ltd';

module.exports = {
  BRAND_SHORT: SHORT,
  BRAND_FULL: FULL,
  BRAND_COMPANY: COMPANY,
  // What outbound email signs itself as, when no EMAIL_FROM is configured.
  emailFrom: () => process.env.EMAIL_FROM || `${FULL} <onboarding@resend.dev>`,
};
