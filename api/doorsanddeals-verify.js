// GET /api/doorsanddeals-verify?reference=PAYSTACK_REF
// Step 2 of registration: called when Paystack redirects the customer
// back. Verifies the transaction server-to-server with the secret key,
// then marks the Airtable row "Registered" (idempotent) and returns
// the ticket number for the success screen.

import { finalizePaidRegistration } from './_lib/finalize.js';
import { getRegistration } from './_lib/airtable.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ errors: [{ message: 'Method not allowed.' }] });
  }

  const reference = String(req.query?.reference || '').trim();
  if (!reference) {
    return res.status(400).json({ errors: [{ message: 'Missing payment reference.' }] });
  }

  const { PAYSTACK_SECRET_KEY } = process.env;
  if (!PAYSTACK_SECRET_KEY) {
    return res.status(500).json({ errors: [{ message: 'Payments are not configured yet.' }] });
  }

  try {
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` } }
    );
    const verifyData = await verifyRes.json().catch(() => null);
    if (!verifyRes.ok || !verifyData || !verifyData.status) {
      console.error('Paystack verify failed:', JSON.stringify(verifyData));
      return res.status(502).json({ errors: [{ message: 'Could not confirm the payment. Please try again.' }] });
    }

    const txn = verifyData.data || {};
    if (txn.status !== 'success') {
      return res.status(400).json({ errors: [{ message: 'The payment was not completed.' }] });
    }

    const recordId = txn.metadata && txn.metadata.recordId;
    if (!recordId) {
      console.error('Verified txn has no recordId metadata:', reference);
      return res.status(400).json({ errors: [{ message: 'Payment confirmed but registration not found. Contact us.' }] });
    }

    const done = await finalizePaidRegistration(recordId, txn.amount, txn.reference || reference);
    const current = await getRegistration(recordId).then(
      (r) => r.fields || {},
      () => done.fields
    );

    return res.status(200).json({
      ok: true,
      ticketNumber: done.ticketNumber,
      name: current.Name || '',
      ticket: current.Ticket || '',
      location: current.Location || '',
    });
  } catch (err) {
    console.error('Verify handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Something went wrong. Please try again.' }] });
  }
}
