// Shared "mark as paid" logic, used by both the redirect-back verifier
// and the Paystack webhook. Idempotent: calling it twice for the same
// record returns the existing ticket number without duplicates or
// double-emails.

import { getRegistration, updateRegistration } from './airtable.js';
import { generateTicketNumber } from './ticket.js';
import { sendConfirmationEmail, sendAdminNotification } from './email.js';

/**
 * @param {string} recordId Airtable record id from Paystack metadata
 * @param {number} amountPaidKobo amount Paystack reports (kobo)
 * @param {string} paystackRef Paystack transaction reference
 * @returns {Promise<{ticketNumber:string, fields:object}>}
 */
export async function finalizePaidRegistration(recordId, amountPaidKobo, paystackRef) {
  const record = await getRegistration(recordId);
  const current = record.fields || {};

  if (current.Status === 'Registered' && current['Ticket Number']) {
    return { ticketNumber: current['Ticket Number'], fields: current };
  }

  const ticketNumber = generateTicketNumber(current.Ticket, current.Location);
  const updated = await updateRegistration(recordId, {
    Status: 'Registered',
    'Ticket Number': ticketNumber,
    'Amount Paid': Math.round((Number(amountPaidKobo) || 0) / 100),
    'Paystack Reference': paystackRef || current['Paystack Reference'] || '',
  });
  const fields = updated.fields || {};

  // Emails are best-effort: a mail failure must not fail the payment.
  try {
    await sendConfirmationEmail({ ...current, ...fields });
  } catch (err) {
    console.error('Confirmation email failed:', err);
  }
  try {
    await sendAdminNotification('paid', { ...current, ...fields });
  } catch (err) {
    console.error('Admin notification failed:', err);
  }

  return { ticketNumber, fields: { ...current, ...fields } };
}
