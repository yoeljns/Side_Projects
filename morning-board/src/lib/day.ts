// The board follows the morning of whichever city you wake up in.

export type City = 'london' | 'istanbul'
export type CityChoice = City | 'auto'

export const CITIES: Record<City, { label: string; tz: string }> = {
  london: { label: 'London', tz: 'Europe/London' },
  istanbul: { label: 'Istanbul', tz: 'Europe/Istanbul' },
}

/** A new board is dealt at 04:00 local, so a late night still counts as "today". */
const ROLLOVER_HOUR = 4

function offsetMinutes(tz: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
    }).formatToParts(at).map((p) => [p.type, Number(p.value)]),
  )
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  return Math.round((asUtc - at.getTime()) / 60000)
}

/** Pick the city from the device clock: whichever of the two it currently agrees with. */
export function detectCity(now = new Date(), deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone): City {
  if (deviceTz === CITIES.istanbul.tz) return 'istanbul'
  if (deviceTz === CITIES.london.tz) return 'london'
  let device: number
  try {
    device = offsetMinutes(deviceTz, now)
  } catch {
    return 'london'
  }
  const dist = (c: City) => Math.abs(offsetMinutes(CITIES[c].tz, now) - device)
  return dist('istanbul') < dist('london') ? 'istanbul' : 'london'
}

export const resolveCity = (choice: CityChoice, now = new Date()): City => (choice === 'auto' ? detectCity(now) : choice)

/** Local wall-clock parts in a city. */
export function cityClock(city: City, now = new Date()): { hour: number; minute: number; text: string } {
  const shifted = new Date(now.getTime() + offsetMinutes(CITIES[city].tz, now) * 60000)
  const hour = shifted.getUTCHours()
  const minute = shifted.getUTCMinutes()
  return { hour, minute, text: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}

/** The board's date key (YYYY-MM-DD) for a city, with the 04:00 rollover. */
export function boardDay(city: City, now = new Date()): string {
  const shifted = new Date(now.getTime() + (offsetMinutes(CITIES[city].tz, now) - ROLLOVER_HOUR * 60) * 60000)
  return shifted.toISOString().slice(0, 10)
}

export function greeting(city: City, now = new Date()): string {
  const { hour } = cityClock(city, now)
  if (hour >= ROLLOVER_HOUR && hour < 12) return 'Good morning'
  if (hour >= 12 && hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(day) + n * 86400000).toISOString().slice(0, 10)
}
