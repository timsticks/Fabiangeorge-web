// GET /api/doorsanddeals-quote?city=Lagos
// Public price lookup for the registration page: returns the current
// pricing tier for a city plus both ticket base prices, so the page can
// show which price is live (early-bird vs regular). Read-only —
// it never writes to Airtable and never starts a payment.

import { basePrice, getTier, ACTIVE_CITIES } from './_lib/pricing.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errors: [{ message: 'Method not allowed.' }] });
  }

  const city = String(req.query?.city || '').trim();
  if (!city) {
    return res.status(400).json({ errors: [{ message: 'Missing city.' }] });
  }

  if (!ACTIVE_CITIES.includes(city)) {
    return res.status(400).json({ errors: [{ message: 'Unknown city.' }] });
  }

  try {
    const tier = await getTier(city);
    return res.status(200).json({
      ok: true,
      tier,
      prices: {
        room: { early: basePrice('Room Pass', 'Early Bird'), regular: basePrice('Room Pass', 'Regular') },
        inner: { early: basePrice('Inner Circle Pass', 'Early Bird'), regular: basePrice('Inner Circle Pass', 'Regular') },
      },
    });
  } catch (err) {
    console.error('Quote handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Could not fetch prices.' }] });
  }
}
