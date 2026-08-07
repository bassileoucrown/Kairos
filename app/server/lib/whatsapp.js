// WhatsApp Business API notifications (blueprint Section 1.1: "WhatsApp-native"
// is core to the positioning; Section 11.1 names the WhatsApp Business API
// directly). Stubbed the same way as calendarSync.js: real send logic plugs
// in here once a token exists, and every entry point is honest about not
// being configured until then.
//
// To activate: set WHATSAPP_BUSINESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID
// from a Meta for Developers WhatsApp Business app.

function isConfigured() {
  return Boolean(process.env.WHATSAPP_BUSINESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function sendWhatsAppMessage(_toPhoneNumber, _body) {
  if (!isConfigured()) {
    throw new Error('WhatsApp is not configured — set WHATSAPP_BUSINESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID first.');
  }
  // Real implementation: POST to
  // https://graph.facebook.com/v19.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
  // with the Bearer token, following the WhatsApp Business Cloud API's
  // message-template rules for outbound notifications.
  throw new Error('WhatsApp send not implemented yet — credentials are configured but the API call still needs building.');
}

module.exports = { isConfigured, sendWhatsAppMessage };
