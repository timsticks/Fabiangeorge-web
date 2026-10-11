// Minimal Airtable helpers for the Doors & Deals registration flow.
// Auth via AIRTABLE_TOKEN / AIRTABLE_BASE_ID env vars (never hardcoded).

const TABLE = 'DoorsAndDeals';

function base() {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) {
    throw new Error('Airtable is not configured.');
  }
  return {
    url: `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${TABLE}`,
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
  };
}

export async function createRegistration(fields) {
  const { url, headers } = base();
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ fields }) });
  if (!res.ok) throw new Error(`Airtable create failed: ${await res.text()}`);
  return res.json(); // { id, fields, ... }
}

export async function getRegistration(recordId) {
  const { url, headers } = base();
  const res = await fetch(`${url}/${recordId}`, { headers });
  if (!res.ok) throw new Error(`Airtable fetch failed: ${await res.text()}`);
  return res.json();
}

/** Latest registration for an email with Status "Interested" (for resume-pay). */
export async function findPendingByEmail(email) {
  const { url, headers } = base();
  const safe = String(email || '').toLowerCase().replace(/"/g, '');
  const formula = `AND(LOWER({Email})="${safe}", {Status}="Interested")`;
  const query =
    `?filterByFormula=${encodeURIComponent(formula)}` +
    `&sort%5B0%5D%5Bfield%5D=Created&sort%5B0%5D%5Bdirection%5D=desc&maxRecords=1`;
  const res = await fetch(url + query, { headers });
  if (!res.ok) throw new Error(`Airtable search failed: ${await res.text()}`);
  const data = await res.json();
  return data.records && data.records[0] ? data.records[0] : null;
}

export async function updateRegistration(recordId, fields) {
  const { url, headers } = base();
  const res = await fetch(`${url}/${recordId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Airtable update failed: ${await res.text()}`);
  return res.json();
}
