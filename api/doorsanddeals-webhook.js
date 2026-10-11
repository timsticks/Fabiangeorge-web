// POST /api/doorsanddeals-webhook
// Paystack webhook receiver (backup confirmation for customers who close
// the tab before the redirect-back verify runs).
//
// Security: the event is signature-checked (HMAC SHA-256 with the secret
// key), AND the transaction is re-verified server-to-server before the
// row is marked "Registered" — so a forged event alone can never create
// a ticket. Set this URL in the Paystack dashboard:
//   https://fabiangeorge.com/api/doorsanddeals-webhook

import crypto from 'node:crypto';
import { finalizePaidRegistration } from './_lib/finalize.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ errors: [{ message: 'Method not allowed.' }] });
  }

  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return res.status(500).json({ errors: [{ message: 'Not configured.' }] });

  try {
    // Signature check over the raw JSON payload.
    const signature = req.headers['x-paystack-signature'];
    const rawBody = JSON.stringify(req.body || {});
    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    if (!signature || signature !== expected) {
      console.error('Webhook signature mismatch');
      return res.status(401).json({ errors: [{ message: 'Invalid signature.' }] });
    }

    const event = req.body || {};
    if (event.event !== 'charge.success') {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const data = event.data || {};
    const recordId = data.metadata && data.metadata.recordId;
    if (!recordId) {
      console.error('Webhook charge.success without recordId');
      return res.status(200).json({ ok: true, ignored: true });
    }

    // Re-verify server-to-server — the webhook is only a trigger.
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(data.reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } }
    );
    const verifyData = await verifyRes.json().catch(() => null);
    const txn = (verifyData && verifyData.data) || {};
    if (!verifyRes.ok || (verifyData && !verifyData.status) || txn.status !== 'success') {
      console.error('Webhook re-verify failed for', data.reference);
      return res.status(200).json({ ok: true, ignored: true });
    }

    await finalizePaidRegistration(recordId, txn.amount, txn.reference);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Webhook failed.' }] });
  }
}
