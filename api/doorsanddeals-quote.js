// GET /api/doorsanddeals-quote?city=Lagos&code=SAVE5K
// Public price/discount lookup for the registration page. Read-only —
// it never writes to Airtable and never starts a payment.
//   city (optional): returns the live tier + both ticket base prices.
//   code (optional): validates a discount code, returns its naira-off value.
// At least one of the two must be supplied.

import { basePrice, getTier, ACTIVE_CITIES } from './_lib/pricing.js';
import { lookupDiscount } from './_lib/discount.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errors: [{ message: 'Method not allowed.' }] });
  }

  const city = String(req.query?.city || '').trim();
  const code = String(req.query?.code || '').trim();
  if (!city && !code) {
    return res.status(400).json({ errors: [{ message: 'Supply a city, a code, or both.' }] });
  }
  if (city && !ACTIVE_CITIES.includes(city)) {
    return res.status(400).json({ errors: [{ message: 'Unknown city.' }] });
  }

  try {
    const out = { ok: true };

    if (city) {
      out.tier = await getTier(city);
      out.prices = {
        room: { early: basePrice('Room Pass', 'Early Bird'), regular: basePrice('Room Pass', 'Regular') },
        inner: { early: basePrice('Inner Circle Pass', 'Early Bird'), regular: basePrice('Inner Circle Pass', 'Regular') },
      };
    }

    if (code) {
      const found = await lookupDiscount(code);
      out.discount = found || { ok: false, message: 'That discount code is not valid.' };
    } else {
      out.discount = null;
    }

    return res.status(200).json(out);
  } catch (err) {
    console.error('Quote handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Could not fetch prices.' }] });
  }
}
