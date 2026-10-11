// Ticket-number generation for Doors & Deals.
//
// Format: {TICKETPREFIX}-{CITYCODE}-{6 random chars}
//   Room Pass → RM-...    Inner Circle Pass → IC-...
//   Lagos → LAG, Kwara → KW, Abuja → ABJ
// e.g. RM-LAG-A1B2C3, IC-KW-X7Y9Z2

import crypto from 'node:crypto';

const TICKET_PREFIX = {
  'Room Pass': 'RM',
  'Inner Circle Pass': 'IC',
};

const CITY_CODE = {
  Lagos: 'LAG',
  Kwara: 'KW',
  Abuja: 'ABJ',
};

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous I/O/0/1

export function generateTicketNumber(ticket, city) {
  const prefix = TICKET_PREFIX[ticket] || 'DD';
  const cityCode = CITY_CODE[city] || 'GEN';
  const bytes = crypto.randomBytes(6);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length];
  return `${prefix}-${cityCode}-${rand}`;
}
