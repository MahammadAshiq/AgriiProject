// Sends SMS via Fast2SMS (popular, cheap, works well for Indian numbers).
// If SMS_API_KEY isn't set in .env, falls back to logging the message to the
// server console instead — lets you test the entire OTP/reset flow for free
// before you've signed up for an SMS provider.
//
// Swap the fetch URL/body below if you prefer a different provider (Twilio,
// MSG91, etc.) — the rest of the app only calls sendSms(phone, message) and
// doesn't care which provider is behind it.

async function sendSms(phone, message) {
  const apiKey = process.env.SMS_API_KEY;

  if (!apiKey) {
    console.log('\n===== [DEV MODE — NO SMS_API_KEY SET] =====');
    console.log(`Would send SMS to ${phone}:`);
    console.log(message);
    console.log('============================================\n');
    return { devMode: true, sent: false };
  }

  try {
    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        route: 'q',
        message,
        numbers: phone,
      }),
    });
    const data = await res.json();
    if (!data.return) {
      console.error('SMS provider returned an error:', data);
      return { devMode: false, sent: false, error: data };
    }
    return { devMode: false, sent: true };
  } catch (err) {
    console.error('Failed to send SMS:', err.message);
    return { devMode: false, sent: false, error: err.message };
  }
}

module.exports = { sendSms };
