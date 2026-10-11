// POST /api/doorsanddeals-resume  { email }
// For customers who filled their details (Status "Interested") but did
// not finish paying: finds the latest pending row by email, re-quotes the
// current price (early-bird may have ended since), and returns a fresh
// Paystack checkout URL for the SAME row (no duplicate records).

import { quotePrice } from './_lib/pricing.js';
import { lookupDiscount } from './_lib/discount.js';
import { findPendingByEmail, updateRegistration } from './_lib/airtable.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ errors: [{ message: 'Method not allowed.' }] });
  }

  const email = String(req.body?.email || '').trim();
  if (!email) {
    return res.status(400).json({ errors: [{ message: 'Please enter your email address.' }] });
  }

  const { PAYSTACK_SECRET_KEY } = process.env;
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ errors: [{ message: 'Payments are not configured yet.' }] });
  }

  try {
    const pending = await findPendingByEmail(email);
    if (!pending) {
      return res.status(404).json({
        errors: [{ message: 'No unpaid registration found for that email. Please register first.' }],
      });
    }
    const f = pending.fields || {};

    // Re-quote at today's tier; honour the originally used discount code.
    const discount = await lookupDiscount(f['Discount Code'] || '');
    const amountOff = discount && discount.ok ? discount.amountOff : 0;
    const quote = await quotePrice(f.Ticket, f.Location, amountOff);
    if (!quote) {
      return res.status(400).json({ errors: [{ message: 'That registration can no longer be priced. Contact us.' }] });
    }

    if (quote.total <= 0) {
      const { finalizePaidRegistration } = await import('./_lib/finalize.js');
      const done = await finalizePaidRegistration(pending.id, 0, 'FREE');
      return res.status(200).json({ ok: true, free: true, ticketNumber: done.ticketNumber });
    }

    await updateRegistration(pending.id, {
      'Pricing Tier': quote.tier,
      'Amount Due': quote.total,
    });

    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const payRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: f.Email,
        amount: quote.total * 100,
        callback_url: `https://${host}/doorsanddeals`,
        metadata: {
          recordId: pending.id,
          ticket: f.Ticket,
          city: f.Location,
          tier: quote.tier,
          resumed: true,
        },
      }),
    });
    const payData = await payRes.json().catch(() => null);
    if (!payRes.ok || !payData || !payData.status || !payData.data) {
      console.error('Paystack resume init failed:', JSON.stringify(payData));
      return res.status(502).json({ errors: [{ message: 'Could not restart the payment. Please try again.' }] });
    }

    await updateRegistration(pending.id, { 'Paystack Reference': payData.data.reference });

    return res.status(200).json({
      ok: true,
      authorization_url: payData.data.authorization_url,
      reference: payData.data.reference,
      amount: quote.total,
      tier: quote.tier,
      name: f.Name || '',
      priceChanged: Number(f['Amount Due']) !== quote.total,
    });
  } catch (err) {
    console.error('Resume handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Something went wrong. Please try again.' }] });
  }
}
