// Operator SMS nudges via Twilio. Mirrors the hermes-triage ops_sms_post
// contract: form POST with basic auth, body capped at 320 characters. Env is
// read at call time so a restart after adding credentials is all that is
// needed; without credentials every call is a silent no-op.
const OPS_SMS_MAX_CHARS = 320;

export async function sendOpsSms(body, { fetchImpl = fetch } = {}) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
  const authToken = process.env.TWILIO_AUTH_TOKEN || '';
  const from = process.env.TWILIO_PHONE_NUMBER || '';
  const to = process.env.OPS_SMS_TO || '';
  if (!accountSid || !authToken || !from || !to) return { sent: false, reason: 'not-configured' };

  try {
    const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: String(body).slice(0, OPS_SMS_MAX_CHARS) }).toString(),
    });
    if (!response?.ok) return { sent: false, reason: `http-${response?.status ?? 'unknown'}` };
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: error?.message || 'unknown' };
  }
}
