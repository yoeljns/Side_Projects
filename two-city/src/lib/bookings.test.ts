import { describe, expect, it } from 'vitest';
import { airportsIn, applyImport, findDates, flightsFromIcs, parseConfirmation, planImport, segmentsToStays } from './bookings.ts';
import { parseIcs } from './ics.ts';
import type { Stay } from './ledger.ts';

// Fixtures written for these tests in the layouts the three airlines use. Names and codes are invented.

const THY_EN = `Turkish Airlines
Your e-ticket itinerary receipt
Date of issue: 02 Nov 2026
Reservation code (PNR): TX4K9M

FLIGHT   FROM                      TO                         DATE          DEP    ARR
TK1980   London Heathrow (LHR)     Istanbul Airport (IST)     12 Dec 2026   11:25  18:20
TK1987   Istanbul Airport (IST)    London Heathrow (LHR)      04 Jan 2027   07:55  09:05

Baggage allowance: 1 piece
Turkish Airlines Inc. General Management Building, Istanbul`;

const THY_TR = `Türk Hava Yolları
Elektronik bilet yolcu seyahat belgesi
Düzenleme tarihi: 02.11.2026
Rezervasyon kodu (PNR): TX4K9M

Uçuş: TK1986
Kalkış: İstanbul Havalimanı (IST) 12 Aralık 2026 Cumartesi 14:10
Varış: Londra Heathrow (LHR) 12 Aralık 2026 Cumartesi 15:25

Uçuş: TK1979
Kalkış: Londra Heathrow (LHR) 3 Ocak 2027 Pazar 22:40
Varış: İstanbul Havalimanı (IST) 4 Ocak 2027 Pazartesi 05:30

İyi uçuşlar dileriz.`;

const BA_EN = `British Airways
Your booking confirmation
Booking reference: Q7WZ3P
Booked on 28 Jul 2026

Flight BA0676 | British Airways | Euro Traveller | Confirmed
Depart: 15 Aug 2026 10:35 Heathrow (London) Terminal 5
Arrive: 15 Aug 2026 16:30 Istanbul (Istanbul)

Flight BA0677 | British Airways | Euro Traveller | Confirmed
Depart: 29 Aug 2026 17:40 Istanbul (Istanbul)
Arrive: 29 Aug 2026 19:50 Heathrow (London) Terminal 5

British Airways Plc, registered office: Waterside, Harmondsworth, London`;

const PEGASUS_EN = `Pegasus Airlines
Booking confirmation
PNR: P1Q2R3

Departure flight
London Stansted (STN) - Istanbul Sabiha Gokcen (SAW)
PC1170  20/09/2026 12:40 - 18:45

Return flight
Istanbul Sabiha Gokcen (SAW) - London Stansted (STN)
PC1169  04/10/2026 09:15 - 11:20`;

const PEGASUS_TR = `Sayın yolcumuz, rezervasyonunuz onaylandı.
PNR: P1Q2R3

Gidiş Uçuşu
PC1169  İstanbul Sabiha Gökçen (SAW) → Londra Stansted (STN)
Tarih: 20.09.2026  Kalkış: 09:15  Varış: 11:20

Dönüş Uçuşu
PC1170  Londra Stansted (STN) → İstanbul Sabiha Gökçen (SAW)
Tarih: 04.10.2026  Kalkış: 12:40  Varış: 18:45`;

describe('dates in text', () => {
  it('reads English and Turkish month names, numeric and compact forms', () => {
    expect(findDates('Sat, 15 Aug 2026 10:35').map((d) => d.value)).toEqual(['2026-08-15']);
    expect(findDates('12 Aralık 2026 Cumartesi').map((d) => d.value)).toEqual(['2026-12-12']);
    expect(findDates('3 Şubat 2027 / 9 Ağustos 2027 / 1 Eylül 2027').map((d) => d.value)).toEqual(['2027-02-03', '2027-08-09', '2027-09-01']);
    expect(findDates('Tarih: 20.09.2026 ve 04/10/2026').map((d) => d.value)).toEqual(['2026-09-20', '2026-10-04']);
    expect(findDates('August 15, 2026 and 2026-08-29').map((d) => d.value)).toEqual(['2026-08-15', '2026-08-29']);
    expect(findDates('15AUG26 LHR IST').map((d) => d.value)).toEqual(['2026-08-15']);
  });

  it('ignores things that are not dates', () => {
    expect(findDates('Terminal 5, 31 Foo 2026, 31.02.2026, flight 1980')).toEqual([]);
  });
});

describe('airports in text', () => {
  it('prefers codes and falls back to names', () => {
    expect(airportsIn('London Heathrow (LHR) to Istanbul Airport (IST)')).toEqual(['LHR', 'IST']);
    expect(airportsIn('TK1980 LHR-IST')).toEqual(['LHR', 'IST']);
    expect(airportsIn('Flight to İstanbul Sabiha Gökçen from Londra')).toEqual(['SAW', 'LHR']);
    expect(airportsIn('Heathrow (London) Terminal 5')).toEqual(['LHR']);
    expect(airportsIn('Lunch with the team')).toEqual([]);
  });
});

describe('confirmation emails', () => {
  it('reads a Turkish Airlines itinerary in English (one row per flight)', () => {
    expect(parseConfirmation(THY_EN)).toEqual({
      segments: [
        { from: 'LHR', to: 'IST', depart: '2026-12-12', arrive: '2026-12-12', flight: 'TK1980' },
        { from: 'IST', to: 'LHR', depart: '2027-01-04', arrive: '2027-01-04', flight: 'TK1987' },
      ],
      notes: [],
    });
  });

  it('reads a Turkish Airlines itinerary in Turkish, including an overnight arrival', () => {
    expect(parseConfirmation(THY_TR).segments).toEqual([
      { from: 'IST', to: 'LHR', depart: '2026-12-12', arrive: '2026-12-12', flight: 'TK1986' },
      { from: 'LHR', to: 'IST', depart: '2027-01-03', arrive: '2027-01-04', flight: 'TK1979' },
    ]);
  });

  it('reads a British Airways confirmation that names cities, not codes, and ignores the address in the footer', () => {
    expect(parseConfirmation(BA_EN)).toEqual({
      segments: [
        { from: 'LHR', to: 'IST', depart: '2026-08-15', arrive: '2026-08-15', flight: 'BA0676' },
        { from: 'IST', to: 'LHR', depart: '2026-08-29', arrive: '2026-08-29', flight: 'BA0677' },
      ],
      notes: [],
    });
  });

  it('reads Pegasus confirmations in English and Turkish (date on the line under the route)', () => {
    expect(parseConfirmation(PEGASUS_EN).segments).toEqual([
      { from: 'STN', to: 'SAW', depart: '2026-09-20', arrive: '2026-09-20', flight: 'PC1170' },
      { from: 'SAW', to: 'STN', depart: '2026-10-04', arrive: '2026-10-04', flight: 'PC1169' },
    ]);
    expect(parseConfirmation(PEGASUS_TR).segments).toEqual([
      { from: 'SAW', to: 'STN', depart: '2026-09-20', arrive: '2026-09-20', flight: 'PC1169' },
      { from: 'STN', to: 'SAW', depart: '2026-10-04', arrive: '2026-10-04', flight: 'PC1170' },
    ]);
  });

  it('takes the date from the line above when that is where the email puts it', () => {
    const text = '20 Sep 2026\nSTN - SAW\n\n27 Sep 2026\nSAW - STN';
    expect(parseConfirmation(text).segments.map((s) => [s.from, s.depart])).toEqual([['STN', '2026-09-20'], ['SAW', '2026-09-27']]);
  });

  it('says so when there is nothing to read', () => {
    const r = parseConfirmation('Thank you for your order. Your parcel will arrive on 3 Dec 2026.');
    expect(r.segments).toEqual([]);
    expect(r.notes[0]).toMatch(/No flights found/);
    expect(parseConfirmation('LHR to IST, see you there').notes[0]).toMatch(/no date found/);
  });
});

describe('calendar files', () => {
  const ICS = [
    'BEGIN:VCALENDAR',
    // TripIt-style: codes in the summary, UTC times.
    'BEGIN:VEVENT', 'UID:1', 'SUMMARY:TK1980 LHR to IST', 'DTSTART:20261212T112500Z', 'DTEND:20261212T152000Z', 'END:VEVENT',
    // Gmail-style: destination in the summary, origin in the location, local time with a zone.
    'BEGIN:VEVENT', 'UID:2', 'SUMMARY:Flight to London (TK 1987)', 'LOCATION:Istanbul IST', 'DTSTART;TZID=Europe/Istanbul:20270104T075500', 'DTEND;TZID=Europe/London:20270104T090500', 'END:VEVENT',
    // 22:30 UTC on 1 July is 01:30 on 2 July in Istanbul: the local date is what counts.
    'BEGIN:VEVENT', 'UID:3', 'SUMMARY:Flight PC1169 SAW-STN', 'DTSTART:20270701T223000Z', 'DTEND:20270702T023500Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:4', 'SUMMARY:Dentist', 'DTSTART:20261201T100000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:5', 'SUMMARY:Chelsea v Arsenal', 'LOCATION:Stamford Bridge, London', 'DTSTART:20261205T150000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  it('finds the flights and leaves everything else', () => {
    const r = flightsFromIcs(parseIcs(ICS));
    expect(r.segments).toEqual([
      { from: 'LHR', to: 'IST', depart: '2026-12-12', arrive: '2026-12-12', flight: 'TK1980' },
      { from: 'IST', to: 'LHR', depart: '2027-01-04', arrive: '2027-01-04', flight: 'TK1987' },
      { from: 'SAW', to: 'STN', depart: '2027-07-02', arrive: '2027-07-02', flight: 'PC1169' },
    ]);
    expect(r.notes).toEqual(['2 calendar events were not a recognisable flight and were ignored.']);
  });

  it('says so when a calendar has no flights', () => {
    expect(flightsFromIcs(parseIcs('BEGIN:VEVENT\nSUMMARY:Dentist\nDTSTART:20261201T100000Z\nEND:VEVENT')).notes).toHaveLength(2);
  });
});

describe('flights to stays', () => {
  const segs = parseConfirmation(THY_EN).segments;

  it('turns consecutive flights into a stay and the last landing into an open-ended one', () => {
    const d = segmentsToStays(segs, 'email');
    expect(d.origin).toEqual({ city: 'london', depart: '2026-12-12' });
    expect(d.stays).toEqual([
      { id: 'email-istanbul-2026-12-12', city: 'istanbul', country: 'TR', arrive: '2026-12-12', depart: '2027-01-04', source: 'email', note: 'Arrived on TK1980' },
      { id: 'email-london-2027-01-04', city: 'london', country: 'GB', arrive: '2027-01-04', depart: null, source: 'email', note: 'Arrived on TK1987' },
    ]);
  });

  it('skips a same-day connection', () => {
    const d = segmentsToStays(
      [
        { from: 'LHR', to: 'IST', depart: '2027-02-01', arrive: '2027-02-01', flight: null },
        { from: 'IST', to: 'TOS', depart: '2027-02-01', arrive: '2027-02-01', flight: null },
        { from: 'TOS', to: 'LHR', depart: '2027-02-06', arrive: '2027-02-06', flight: null },
      ],
      'ics',
    );
    expect(d.stays.map((s) => [s.city, s.country, s.arrive, s.depart])).toEqual([
      ['tromso', 'NO', '2027-02-01', '2027-02-06'],
      ['london', 'GB', '2027-02-06', null],
    ]);
    expect(d.notes).toEqual(['Same-day connection in Istanbul on 2027-02-01: no stay created.']);
  });

  it('plans an import: closes the open stay you left from, creates the rest', () => {
    const existing: Stay[] = [{ id: 'm1', city: 'london', country: 'GB', arrive: '2026-11-10', depart: null, source: 'manual' }];
    const plan = planImport(existing, { segments: segs, notes: [] }, 'email');
    expect(plan.update).toEqual([{ before: existing[0], after: { ...existing[0], depart: '2026-12-12' }, why: 'Departure flight found' }]);
    expect(plan.create.map((s) => s.id)).toEqual(['email-istanbul-2026-12-12', 'email-london-2027-01-04']);
    expect(plan.unchanged).toEqual([]);
    const after = applyImport(existing, plan);
    expect(after.map((s) => [s.city, s.arrive, s.depart, s.source])).toEqual([
      ['london', '2026-11-10', '2026-12-12', 'manual'],
      ['istanbul', '2026-12-12', '2027-01-04', 'email'],
      ['london', '2027-01-04', null, 'email'],
    ]);
    // Importing the same confirmation again changes nothing.
    const again = planImport(after, { segments: segs, notes: [] }, 'email');
    expect(again.create).toEqual([]);
    expect(again.update).toEqual([]);
    expect(again.unchanged).toHaveLength(2);
  });

  it('treats a rebooked flight as a change to the existing stay, not a second stay', () => {
    const existing: Stay[] = [
      { id: 'e1', city: 'istanbul', country: 'TR', arrive: '2026-12-12', depart: '2027-01-04', source: 'email' },
      { id: 'e2', city: 'london', country: 'GB', arrive: '2027-01-04', depart: null, source: 'email' },
    ];
    const moved = segs.map((s) => (s.from === 'IST' ? { ...s, depart: '2027-01-08', arrive: '2027-01-08' } : s));
    const plan = planImport(existing, { segments: moved, notes: [] }, 'email');
    expect(plan.create).toEqual([{ id: 'email-london-2027-01-08', city: 'london', country: 'GB', arrive: '2027-01-08', depart: null, source: 'email', note: 'Arrived on TK1987' }]);
    expect(plan.update).toEqual([{ before: existing[0], after: { ...existing[0], depart: '2027-01-08' }, why: 'Departure date changed' }]);
  });
});
