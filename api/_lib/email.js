// Resend email helpers for Doors & Deals.
// Sends as Fabian George <hello@fabiangeorge.com>. Admin notifications go
// to each address in NOTIFY_TO_EMAIL as separate individual emails
// (same pattern as waitlist.js / contact.js).

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (s) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[s]));
}

export function naira(amount) {
  return '₦' + Number(amount || 0).toLocaleString('en-NG');
}

async function sendEmail(to, subject, html) {
  const { RESEND_API_KEY } = process.env;
  if (!RESEND_API_KEY) {
    console.error('RESEND_API_KEY missing — skipping email to', to);
    return;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Fabian George <hello@fabiangeorge.com>',
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error(`Resend rejected email to ${to}:`, res.status, await res.text());
    }
  } catch (err) {
    console.error(`Resend network error for ${to}:`, err);
  }
}

/** Ticket confirmation to the person who just paid. Never throws. */
export async function sendConfirmationEmail(reg) {
  const html = `
    <p>Hi ${escapeHtml(reg.Name)},</p>
    <p>Your registration for <strong>Doors &amp; Deals (${escapeHtml(reg.Location)})</strong> is confirmed. See you in the room.</p>
    <p><strong>Ticket:</strong> ${escapeHtml(reg.Ticket)} (${escapeHtml(reg['Pricing Tier'] || '')})<br>
    <strong>Ticket number:</strong> ${escapeHtml(reg['Ticket Number'])}<br>
    <strong>Amount paid:</strong> ${escapeHtml(naira(reg['Amount Paid']))}</p>
    <p>Keep this ticket number safe — it is your proof of registration and entry pass.</p>
    <p>— Fabian George</p>
  `;
  await sendEmail(reg.Email, `Your Doors & Deals ticket — ${reg['Ticket Number']}`, html);
}

/** Admin notification, one individual email per NOTIFY_TO_EMAIL address. */
export async function sendAdminNotification(kind, reg) {
  const recipients = (process.env.NOTIFY_TO_EMAIL || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  const subject =
    kind === 'paid'
      ? `Paid: Doors & Deals registration — ${reg.Name}`
      : `Interested: Doors & Deals signup — ${reg.Name}`;
  for (const recipient of recipients) {
    const html = `
      <p><strong>${kind === 'paid' ? 'New paid registration' : 'New signup (not yet paid)'}</strong></p>
      <p><strong>Name:</strong> ${escapeHtml(reg.Name)}<br>
      <strong>Phone (WhatsApp):</strong> ${escapeHtml(reg.Phone || '—')}<br>
      <strong>Email:</strong> ${escapeHtml(reg.Email)}<br>
      <strong>Job Title / Role:</strong> ${escapeHtml(reg['Job Title'] || '—')}<br>
      <strong>Organisation:</strong> ${escapeHtml(reg.Organization || '—')}<br>
      <strong>City:</strong> ${escapeHtml(reg.Location)}<br>
      <strong>Ticket:</strong> ${escapeHtml(reg.Ticket)} (${escapeHtml(reg['Pricing Tier'] || '')})<br>
      <strong>Discount code:</strong> ${escapeHtml(reg['Discount Code'] || '—')}<br>
      <strong>Amount due:</strong> ${escapeHtml(naira(reg['Amount Due']))}<br>
      <strong>Amount paid:</strong> ${escapeHtml(naira(reg['Amount Paid'] || 0))}<br>
      <strong>Status:</strong> ${escapeHtml(reg.Status)}<br>
      <strong>Ticket number:</strong> ${escapeHtml(reg['Ticket Number'] || '—')}<br>
      <strong>Heard about event:</strong> ${escapeHtml(reg['Hear About'] || '—')}</p>
    `;
    await sendEmail(recipient, subject, html);
  }
}
