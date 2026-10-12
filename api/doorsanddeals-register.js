// POST /api/doorsanddeals-register
// Step 1 of registration: validate details, compute the server-side price
// (early-bird tier + single discount code), save the row as "Interested",
// then initialize a Paystack transaction and return the checkout URL.
// If the final amount is ₦0 (full discount), the row is marked
// "Registered" immediately with no Paystack step.

import { quotePrice, TICKET_TYPES, ACTIVE_CITIES } from './_lib/pricing.js';
import { lookupDiscount } from './_lib/discount.js';
import { createRegistration, updateRegistration, findRegistrationByEmailAndCity } from './_lib/airtable.js';
import { sendAdminNotification } from './_lib/email.js';
import { finalizePaidRegistration } from './_lib/finalize.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ errors: [{ message: 'Method not allowed.' }] });
  }

  const {
    name, phone, email, jobTitle, organization,
    location, ticket, discountCode, hearAbout,
  } = req.body || {};

  if (!name || !phone || !email || !location || !ticket) {
    return res.status(400).json({
      errors: [{ message: 'Name, WhatsApp number, email, city and ticket are required.' }],
    });
  }
  if (!EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ errors: [{ message: 'Please enter a valid email address.' }] });
  }
  if (!ACTIVE_CITIES.includes(location)) {
    return res.status(400).json({ errors: [{ message: 'That city is not open for registration yet.' }] });
  }
  if (!TICKET_TYPES.includes(ticket)) {
    return res.status(400).json({ errors: [{ message: 'Please choose a valid ticket.' }] });
  }

  const { PAYSTACK_SECRET_KEY } = process.env;
  if (!PAYSTACK_SECRET_KEY) {
    console.error('PAYSTACK_SECRET_KEY missing');
    return res.status(500).json({ errors: [{ message: 'Payments are not configured yet. Please try again later.' }] });
  }

  try {
    // 0. Same email may register for MULTIPLE cities — but not twice for
    // the SAME city. Catch that here so a second Lagos signup doesn't
    // create a duplicate row (or a double charge).
    const cleanEmail = String(email).trim();
    const existing = await findRegistrationByEmailAndCity(cleanEmail, location);
    if (existing) {
      const ef = existing.fields || {};
      if (ef.Status === 'Registered') {
        return res.status(409).json({
          errors: [{ message: 'You have already been registered for ' + location + '. Your ticket is shown below.' }],
          alreadyRegistered: true,
          registrations: [{
            ticketNumber: ef['Ticket Number'] || '',
            ticket: ef.Ticket || '',
            location: ef.Location || location,
            name: ef.Name || '',
          }],
        });
      }
      return res.status(409).json({
        errors: [{ message: 'You already started a registration for ' + location + '. Use Resume Payment below with your email to continue.' }],
        pending: true,
        location,
        ticket: ef.Ticket || '',
      });
    }

    // 1. Discount (at most one code — the form only has one field).
    const discount = await lookupDiscount(discountCode);
    if (discount && !discount.ok) {
      return res.status(400).json({ errors: [{ message: discount.message }] });
    }
    const amountOff = discount && discount.ok ? discount.amountOff : 0;
    const usedCode = discount && discount.ok ? discount.code : '';

    // 2. Server-side price (never trust a client-submitted total).
    const quote = await quotePrice(ticket, location, amountOff);
    if (!quote) {
      return res.status(400).json({ errors: [{ message: 'Please choose a valid ticket.' }] });
    }

    // 3. Save as Interested.
    const record = await createRegistration({
      Name: String(name).trim(),
      Phone: String(phone).trim(),
      Email: cleanEmail,
      'Job Title': String(jobTitle || '').trim(),
      Organization: String(organization || '').trim(),
      Location: location,
      Ticket: ticket,
      'Hear About': String(hearAbout || '').trim(),
      Status: 'Interested',
      'Pricing Tier': quote.tier,
      'Amount Due': quote.total,
      'Discount Code': usedCode,
      'Paystack Reference': '',
    });

    try {
      await sendAdminNotification('interested', {
        Name: String(name).trim(),
        Phone: String(phone).trim(),
        Email: cleanEmail,
        'Job Title': String(jobTitle || '').trim(),
        Organization: String(organization || '').trim(),
        Location: location,
        Ticket: ticket,
        'Hear About': String(hearAbout || '').trim(),
        Status: 'Interested',
        'Pricing Tier': quote.tier,
        'Amount Due': quote.total,
        'Discount Code': usedCode,
      });
    } catch (err) {
      console.error('Interested notification failed:', err);
    }

    // 4. Fully discounted → registered immediately, no payment needed.
    if (quote.total <= 0) {
      const done = await finalizePaidRegistration(record.id, 0, 'FREE');
      return res.status(200).json({
        ok: true,
        free: true,
        ticketNumber: done.ticketNumber,
        amount: 0,
        tier: quote.tier,
      });
    }

    // 5. Initialize Paystack transaction (amounts in kobo).
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const callbackUrl = `https://${host}/doorsanddeals`;
    const payRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: cleanEmail,
        amount: quote.total * 100,
        callback_url: callbackUrl,
        metadata: {
          recordId: record.id,
          ticket,
          city: location,
          tier: quote.tier,
          discountCode: usedCode,
        },
      }),
    });
    const payData = await payRes.json().catch(() => null);
    if (!payRes.ok || !payData || !payData.status || !payData.data) {
      console.error('Paystack init failed:', JSON.stringify(payData));
      return res.status(502).json({
        errors: [{ message: 'Could not start the payment. Your details were saved — please resume with your email.' }],
      });
    }

    await updateRegistration(record.id, { 'Paystack Reference': payData.data.reference });

    return res.status(200).json({
      ok: true,
      authorization_url: payData.data.authorization_url,
      reference: payData.data.reference,
      amount: quote.total,
      tier: quote.tier,
    });
  } catch (err) {
    console.error('Register handler error:', err);
    return res.status(500).json({ errors: [{ message: 'Something went wrong. Please try again.' }] });
  }
}
