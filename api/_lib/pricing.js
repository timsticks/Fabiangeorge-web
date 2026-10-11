// Shared pricing logic for Doors & Deals ticket sales.
//
// Prices (NGN):
//   Room Pass:         early-bird ₦25,000 / regular ₦50,000
//   Inner Circle Pass: early-bird ₦50,000 / regular ₦100,000
//
// Early-bird rule: a city is on early-bird pricing until 5 days before its
// event date. Event dates live in the Airtable `EventDates` table
// (columns: City, EventDate, ForceRegular) so they can be changed without
// touching code — the API reads that table on every request.

const PRICES = {
  'Room Pass': { early: 25000, regular: 50000 },
  'Inner Circle Pass': { early: 50000, regular: 100000 },
};

export const TICKET_TYPES = Object.keys(PRICES);
export const ACTIVE_CITIES = ['Lagos', 'Kwara', 'Abuja'];

const EARLY_BIRD_CUTOFF_DAYS = 5;

function parseEventDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function readEventRow(city) {
  const { AIRTABLE_TOKEN, AIRTABLE_BASE_ID } = process.env;
  if (!AIRTABLE_TOKEN || !AIRTABLE_BASE_ID) return null;
  try {
    const formula = `LOWER({City})="${String(city).toLowerCase().replace(/"/g, '')}"`;
    const url =
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/EventDates` +
      `?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.records && data.records[0] ? data.records[0].fields : null;
  } catch {
    return null;
  }
}

/**
 * Returns 'Early Bird' or 'Regular' for a city.
 * Unknown city / missing date / Airtable unreachable → 'Early Bird'
 * (fail-open so a config gap never overcharges a customer).
 */
export async function getTier(city) {
  const row = await readEventRow(city);
  if (!row) return 'Early Bird';
  if (row.ForceRegular) return 'Regular';
  const eventDate = parseEventDate(row.EventDate);
  if (!eventDate) return 'Early Bird';
  const cutoff = new Date(eventDate);
  cutoff.setDate(cutoff.getDate() - EARLY_BIRD_CUTOFF_DAYS);
  return new Date() < cutoff ? 'Early Bird' : 'Regular';
}

export function basePrice(ticket, tier) {
  const entry = PRICES[ticket];
  if (!entry) return null;
  return tier === 'Early Bird' ? entry.early : entry.regular;
}

/** Full quote: { tier, base, discountOff, total } — total never below 0. */
export async function quotePrice(ticket, city, discountOff = 0) {
  const tier = await getTier(city);
  const base = basePrice(ticket, tier);
  if (base === null) return null;
  const off = Math.max(0, Number(discountOff) || 0);
  return { tier, base, discountOff: off, total: Math.max(0, base - off) };
}
