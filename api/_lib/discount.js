// Discount-code lookups for Doors & Deals.
//
// Codes live in the Airtable `DiscountCodes` table
// (columns: Code, AmountOff, Active) so new codes / amounts can be added
// like a spreadsheet — no code change, no redeploy. The API reads the
// table on every registration, so edits take effect immediately.
// Each code is a fixed naira amount off, and only one code per order
// (the form has a single discount field).

/**
 * @param {string} code raw user input (may be empty)
 * @returns {Promise<{ok:true, code:string, amountOff:number}|{ok:false,message:string}|null>}
 *   null = no code supplied (no discount, not an error).
 */
export async function lookupDiscount(code) {
  const clean = String(code || '').trim().toUpperCase();
  if (!clean) return null;

  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    return { ok: false, message: 'Discounts are unavailable right now. Please try again.' };
  }

  try {
    const safe = clean.replace(/"/g, '');
    const formula = `AND(UPPER({Code})="${safe}", {Active})`;
    const url =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/DiscountCodes` +
      `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    if (!res.ok) {
      console.error('DiscountCodes lookup failed:', await res.text());
      return { ok: false, message: 'Could not verify the discount code. Please try again.' };
    }
    const data = await res.json();
    const row = data.records && data.records[0];
    if (!row) return { ok: false, message: 'That discount code is not valid.' };
    const amountOff = Number(row.fields.AmountOff) || 0;
    if (amountOff <= 0) return { ok: false, message: 'That discount code is not valid.' };
    return { ok: true, code: clean, amountOff };
  } catch (err) {
    console.error('Discount lookup error:', err);
    return { ok: false, message: 'Could not verify the discount code. Please try again.' };
  }
}
