// POST /api/waitlist
// Saves a LINKED-IN waitlist signup to the "Waitlist" table in Airtable,
// then emails a notification via Resend. Both keys/IDs come from Vercel's
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

  const { name, email, phone, profession } = req.body || {};

  if (!name || !email) {
    return res.status(400).json({ errors: [{ message: 'Name and email are required.' }] });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, RESEND_API_KEY, NOTIFY_TO_EMAIL } = process.env;

  try {
    // 1. Save to Airtable
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Waitlist`,
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
            Phone: phone || '',
            Profession: profession || ''
          }
        })
      }
    );

    if (!airtableRes.ok) {
      const errText = await airtableRes.text();
      console.error('Airtable error (waitlist):', errText);
      return res.status(502).json({ errors: [{ message: 'Could not save your submission. Please try again.' }] });
    }

    // 2. Email notification (best-effort: don't fail the whole request if this errors)
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'LINKED-IN Waitlist <onboarding@resend.dev>',
          to: NOTIFY_TO_EMAIL,
          subject: 'New LINKED-IN Waitlist Signup',
          html: `
            <p><strong>Name:</strong> ${escapeHtml(name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Phone:</strong> ${escapeHtml(phone || '—')}</p>
            <p><strong>Profession:</strong> ${escapeHtml(profession || '—')}</p>
          `
        })
      });
    } catch (emailErr) {
      console.error('Resend error (waitlist):', emailErr);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Waitlist handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Something went wrong. Please try again.' }] });
  }
}
