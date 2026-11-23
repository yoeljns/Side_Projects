// A small airport table: enough for the two home cities, the usual European
// hubs and the long-haul gateways. Add a line when a booking is not recognised.

export interface Airport {
  code: string;
  /** Display name of the city. */
  city: string;
  /** ISO-2 country. */
  country: string;
  tz: string;
}

const T = (rows: string): Airport[] =>
  rows.trim().split('\n').map((r) => {
    const [code, city, country, tz] = r.trim().split('|');
    return { code, city, country, tz };
  });

export const AIRPORTS: Airport[] = T(`
LHR|London|GB|Europe/London
LGW|London|GB|Europe/London
STN|London|GB|Europe/London
LTN|London|GB|Europe/London
LCY|London|GB|Europe/London
SEN|London|GB|Europe/London
MAN|Manchester|GB|Europe/London
BHX|Birmingham|GB|Europe/London
EDI|Edinburgh|GB|Europe/London
GLA|Glasgow|GB|Europe/London
BRS|Bristol|GB|Europe/London
NCL|Newcastle|GB|Europe/London
BFS|Belfast|GB|Europe/London
IST|Istanbul|TR|Europe/Istanbul
SAW|Istanbul|TR|Europe/Istanbul
ESB|Ankara|TR|Europe/Istanbul
ADB|Izmir|TR|Europe/Istanbul
AYT|Antalya|TR|Europe/Istanbul
DLM|Dalaman|TR|Europe/Istanbul
BJV|Bodrum|TR|Europe/Istanbul
ADA|Adana|TR|Europe/Istanbul
TZX|Trabzon|TR|Europe/Istanbul
GZT|Gaziantep|TR|Europe/Istanbul
ASR|Kayseri|TR|Europe/Istanbul
ECN|Nicosia (Ercan)|CY|Asia/Nicosia
LCA|Larnaca|CY|Asia/Nicosia
DUB|Dublin|IE|Europe/Dublin
CDG|Paris|FR|Europe/Paris
ORY|Paris|FR|Europe/Paris
NCE|Nice|FR|Europe/Paris
LYS|Lyon|FR|Europe/Paris
AMS|Amsterdam|NL|Europe/Amsterdam
BRU|Brussels|BE|Europe/Brussels
LUX|Luxembourg|LU|Europe/Luxembourg
FRA|Frankfurt|DE|Europe/Berlin
MUC|Munich|DE|Europe/Berlin
BER|Berlin|DE|Europe/Berlin
DUS|Dusseldorf|DE|Europe/Berlin
HAM|Hamburg|DE|Europe/Berlin
ZRH|Zurich|CH|Europe/Zurich
GVA|Geneva|CH|Europe/Zurich
BSL|Basel|CH|Europe/Zurich
VIE|Vienna|AT|Europe/Vienna
MAD|Madrid|ES|Europe/Madrid
BCN|Barcelona|ES|Europe/Madrid
AGP|Malaga|ES|Europe/Madrid
PMI|Palma|ES|Europe/Madrid
LIS|Lisbon|PT|Europe/Lisbon
OPO|Porto|PT|Europe/Lisbon
FCO|Rome|IT|Europe/Rome
MXP|Milan|IT|Europe/Rome
LIN|Milan|IT|Europe/Rome
VCE|Venice|IT|Europe/Rome
NAP|Naples|IT|Europe/Rome
ATH|Athens|GR|Europe/Athens
SKG|Thessaloniki|GR|Europe/Athens
CPH|Copenhagen|DK|Europe/Copenhagen
ARN|Stockholm|SE|Europe/Stockholm
GOT|Gothenburg|SE|Europe/Stockholm
OSL|Oslo|NO|Europe/Oslo
BGO|Bergen|NO|Europe/Oslo
TOS|Tromso|NO|Europe/Oslo
TRD|Trondheim|NO|Europe/Oslo
HEL|Helsinki|FI|Europe/Helsinki
KEF|Reykjavik|IS|Atlantic/Reykjavik
WAW|Warsaw|PL|Europe/Warsaw
KRK|Krakow|PL|Europe/Warsaw
PRG|Prague|CZ|Europe/Prague
BUD|Budapest|HU|Europe/Budapest
OTP|Bucharest|RO|Europe/Bucharest
SOF|Sofia|BG|Europe/Sofia
BEG|Belgrade|RS|Europe/Belgrade
ZAG|Zagreb|HR|Europe/Zagreb
TBS|Tbilisi|GE|Asia/Tbilisi
GYD|Baku|AZ|Asia/Baku
TLV|Tel Aviv|IL|Asia/Jerusalem
CAI|Cairo|EG|Africa/Cairo
CMN|Casablanca|MA|Africa/Casablanca
DXB|Dubai|AE|Asia/Dubai
AUH|Abu Dhabi|AE|Asia/Dubai
DOH|Doha|QA|Asia/Qatar
RUH|Riyadh|SA|Asia/Riyadh
JFK|New York|US|America/New_York
EWR|New York|US|America/New_York
BOS|Boston|US|America/New_York
IAD|Washington|US|America/New_York
MIA|Miami|US|America/New_York
ORD|Chicago|US|America/Chicago
LAX|Los Angeles|US|America/Los_Angeles
SFO|San Francisco|US|America/Los_Angeles
YYZ|Toronto|CA|America/Toronto
GRU|Sao Paulo|BR|America/Sao_Paulo
JNB|Johannesburg|ZA|Africa/Johannesburg
CPT|Cape Town|ZA|Africa/Johannesburg
DEL|Delhi|IN|Asia/Kolkata
BOM|Mumbai|IN|Asia/Kolkata
SIN|Singapore|SG|Asia/Singapore
BKK|Bangkok|TH|Asia/Bangkok
HKG|Hong Kong|HK|Asia/Hong_Kong
NRT|Tokyo|JP|Asia/Tokyo
HND|Tokyo|JP|Asia/Tokyo
ICN|Seoul|KR|Asia/Seoul
SYD|Sydney|AU|Australia/Sydney
`);

export const AIRPORT: Record<string, Airport> = Object.fromEntries(AIRPORTS.map((a) => [a.code, a]));

/** Fold case and Turkish/accented letters one character to one character, so positions survive. */
export function fold(s: string): string {
  const map: Record<string, string> = { İ: 'i', I: 'i', ı: 'i', ş: 's', Ş: 's', ğ: 'g', Ğ: 'g', ü: 'u', Ü: 'u', ö: 'o', Ö: 'o', ç: 'c', Ç: 'c', é: 'e', è: 'e', á: 'a', â: 'a', ø: 'o', Ø: 'o', å: 'a', ä: 'a', ñ: 'n', ó: 'o', í: 'i', ú: 'u' };
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const lower = map[ch] ?? ch.toLowerCase();
    out += lower.length === 1 ? lower : ch;
  }
  return out;
}

/** Names seen in confirmations, in English and Turkish, mapped to an airport code. Specific names first. */
const NAME_ROWS: [string, string][] = [
  ['london heathrow', 'LHR'], ['londra heathrow', 'LHR'], ['heathrow', 'LHR'],
  ['london gatwick', 'LGW'], ['londra gatwick', 'LGW'], ['gatwick', 'LGW'],
  ['london stansted', 'STN'], ['londra stansted', 'STN'], ['stansted', 'STN'],
  ['london luton', 'LTN'], ['luton', 'LTN'], ['london city', 'LCY'],
  ['london', 'LHR'], ['londra', 'LHR'],
  ['istanbul sabiha gokcen', 'SAW'], ['sabiha gokcen', 'SAW'],
  ['istanbul havalimani', 'IST'], ['istanbul airport', 'IST'], ['istanbul', 'IST'],
  ['ankara', 'ESB'], ['izmir', 'ADB'], ['antalya', 'AYT'], ['dalaman', 'DLM'], ['bodrum', 'BJV'],
  ['manchester', 'MAN'], ['edinburgh', 'EDI'], ['dublin', 'DUB'],
  ['paris', 'CDG'], ['amsterdam', 'AMS'], ['brussels', 'BRU'], ['bruksel', 'BRU'],
  ['frankfurt', 'FRA'], ['munich', 'MUC'], ['munih', 'MUC'], ['berlin', 'BER'],
  ['zurich', 'ZRH'], ['zurih', 'ZRH'], ['geneva', 'GVA'], ['cenevre', 'GVA'],
  ['vienna', 'VIE'], ['viyana', 'VIE'], ['madrid', 'MAD'], ['barcelona', 'BCN'], ['barselona', 'BCN'],
  ['lisbon', 'LIS'], ['lizbon', 'LIS'], ['rome', 'FCO'], ['roma', 'FCO'], ['milan', 'MXP'], ['milano', 'MXP'],
  ['athens', 'ATH'], ['atina', 'ATH'], ['copenhagen', 'CPH'], ['kopenhag', 'CPH'], ['stockholm', 'ARN'], ['stokholm', 'ARN'],
  ['oslo', 'OSL'], ['tromso', 'TOS'], ['bergen', 'BGO'], ['helsinki', 'HEL'],
  ['dubai', 'DXB'], ['doha', 'DOH'], ['new york', 'JFK'], ['tokyo', 'NRT'], ['singapore', 'SIN'], ['singapur', 'SIN'],
];
export const AIRPORT_NAMES: [string, string][] = [...NAME_ROWS].sort((a, b) => b[0].length - a[0].length);

/** Stable key for a stay's city: 'london', 'istanbul', 'new-york'. */
export const cityKey = (city: string): string => fold(city).replace(/\(.*?\)/g, '').trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const COUNTRY_NAMES: Record<string, string> = {
  GB: 'United Kingdom', TR: 'Turkey', NO: 'Norway', FR: 'France', DE: 'Germany', NL: 'Netherlands', ES: 'Spain', IT: 'Italy', PT: 'Portugal', GR: 'Greece',
  CH: 'Switzerland', AT: 'Austria', BE: 'Belgium', IE: 'Ireland', US: 'United States', AE: 'UAE', CY: 'Cyprus', SE: 'Sweden', DK: 'Denmark', FI: 'Finland', IS: 'Iceland',
};
export const countryName = (code: string): string => COUNTRY_NAMES[code] ?? code;

/** Country for a typed city name, when the table knows it. */
export function countryForCity(city: string): string | null {
  const key = fold(city).trim();
  const hit = AIRPORTS.find((a) => fold(a.city) === key) ?? (AIRPORT_NAMES.find(([n]) => n === key) ? AIRPORT[AIRPORT_NAMES.find(([n]) => n === key)![1]] : undefined);
  return hit ? hit.country : null;
}
