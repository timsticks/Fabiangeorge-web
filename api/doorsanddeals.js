// POST /api/doorsanddeals
// Saves a Doors & Deals waitlist signup to the "DoorsAndDeals" table in
// Airtable, then emails a notification to each address in NOTIFY_TO_EMAIL
// individually (so each recipient only sees their own address in "To").

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

  const { name, email, phone, occupation, location, notes } = req.body || {};

  if (!name || !email || !location) {
    return res.status(400).json({ errors: [{ message: 'Name, email and location are required.' }] });
  }

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID, RESEND_API_KEY, NOTIFY_TO_EMAIL } = process.env;

  try {
    // 1. Save to Airtable
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/DoorsAndDeals`,
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
            Occupation: occupation || '',
            Location: location || '',
            Notes: notes || ''
          }
        })
      }
    );

    if (!airtableRes.ok) {
      const errText = await airtableRes.text();
      console.error('Airtable error (doorsanddeals):', errText);
      return res.status(502).json({ errors: [{ message: 'Could not save your submission. Please try again.' }] });
    }

    // 2. Email notification — sent as separate individual emails so each
    // recipient only ever sees their own address in "To", not everyone else's.
    const recipients = (NOTIFY_TO_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean);
    for (const recipient of recipients) {
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'Fabian George <hello@fabiangeorge.com>',
            to: recipient,
            subject: 'New Doors & Deals Waitlist Signup',
            html: `
              <p><strong>Name:</strong> ${escapeHtml(name)}</p>
              <p><strong>Email:</strong> ${escapeHtml(email)}</p>
              <p><strong>Phone:</strong> ${escapeHtml(phone || '—')}</p>
              <p><strong>Occupation:</strong> ${escapeHtml(occupation || '—')}</p>
              <p><strong>Registering For:</strong> ${escapeHtml(location || '—')}</p>
              <p><strong>Notes / Expectations:</strong><br>${escapeHtml(notes || '—').replace(/\n/g, '<br>')}</p>
            `
          })
        });
        if (!resendRes.ok) {
          const resendErrText = await resendRes.text();
          console.error(`Resend rejected the email (doorsanddeals) for ${recipient}:`, resendRes.status, resendErrText);
        }
      } catch (emailErr) {
        console.error(`Resend network error (doorsanddeals) for ${recipient}:`, emailErr);
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Doors & Deals handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Something went wrong. Please try again.' }] });
  }
}
