// Two-way Google/Outlook calendar sync (blueprint Section 3.6, Gap 3;
// Section 11.1 lists Google Calendar API + Microsoft Graph API as the
// target integrations). This module is the seam: real OAuth + sync logic
// plugs in here once credentials exist. Until then, every entry point
// reports 'not_configured' rather than silently pretending to work.
//
// To activate Google: set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// GOOGLE_REDIRECT_URI (from a project in Google Cloud Console with the
// Calendar API enabled). To activate Outlook: set MICROSOFT_CLIENT_ID,
// MICROSOFT_CLIENT_SECRET, MICROSOFT_REDIRECT_URI (from an Azure AD app
// registration with Microsoft Graph Calendars.ReadWrite).

function isConfigured(provider) {
  if (provider === 'google') {
    return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  }
  if (provider === 'outlook') {
    return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
  }
  return false;
}

// Once configured, this returns the real provider consent-screen URL.
// Today it always throws — callers must check isConfigured() first.
function getAuthorizationUrl(provider, ownerId) {
  if (!isConfigured(provider)) {
    throw new Error(`${provider} is not configured — set the OAuth client credentials as env vars first.`);
  }
  // Real implementation: build the provider's OAuth2 authorize URL with
  // client_id, redirect_uri, scope (calendar read/write), and `state` set
  // to a signed token containing ownerId, then exchange the callback code
  // for access/refresh tokens in a corresponding /callback route.
  throw new Error('OAuth flow not implemented yet — credentials are configured but the exchange still needs building.');
}

module.exports = { isConfigured, getAuthorizationUrl };
