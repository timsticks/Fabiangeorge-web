// POST /api/contact
// Saves a contact form message to the "Contact" table in Airtable, then
// emails a notification via Resend. Both keys/IDs come from Vercel's
// environment variables (Project Settings -> Environment Variables), never
// hardcoded here.

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[s]));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ errors: [{ message: 'Method not allowed.' }] });
  }

  const { name, email, reason, message } = req.body || {};

  if (!name || !email || !message) {
    return res.status(400).json({ errors: [{ message: 'Name, email and message are required.' }] });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, RESEND_API_KEY, NOTIFY_TO_EMAIL } = process.env;

  try {
    // 1. Save to Airtable
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Contact`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            Name: name,
            Email: email,
            Reason: reason || '',
            Message: message
          }
        })
      }
    );

    if (!airtableRes.ok) {
      const errText = await airtableRes.text();
      console.error('Airtable error (contact):', errText);
      return res.status(502).json({ errors: [{ message: 'Could not save your message. Please try again.' }] });
    }

    // 2. Email notification (best-effort: don't fail the whole request if this errors,
    // but DO log the response body so a rejection is actually visible in Vercel logs)
    try {
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'FabianGeorge.com <onboarding@resend.dev>',
          to: NOTIFY_TO_EMAIL,
          subject: 'New Contact Message, FabianGeorge.com',
          html: `
            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Reason:</strong> ${escapeHtml(reason || '—')}</p>
            <p><strong>Message:</strong><br>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
          `
        })
      });
      if (!resendRes.ok) {
        const resendErrText = await resendRes.text();
        console.error('Resend rejected the email (contact):', resendRes.status, resendErrText);
      }
    } catch (emailErr) {
      console.error('Resend network error (contact):', emailErr);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Contact handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Something went wrong. Please try again.' }] });
  }
}
