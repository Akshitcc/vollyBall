/**
 * 1.4.4 (QA V143-11): Edit profile – a successful pincode lookup updates the city field. The field is filled
 * directly when it is empty or still holds a lookup name (the profile's district, a previous lookup's city, or
 * what this form filled in); a city the user typed themselves is never overwritten silently – the form asks
 * inline ("Use Mumbai?").
 */
const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLocaleLowerCase('en') === b.trim().toLocaleLowerCase('en');

export type CityAction = { action: 'none' } | { action: 'fill'; name: string } | { action: 'ask'; name: string };

export function citySuggestion(city: string, found: { city?: string | null; district?: string | null } | null, lookupNames: readonly (string | null | undefined)[]): CityAction {
  const name = (found?.city || found?.district || '').trim();
  if (!name || same(city, name)) return { action: 'none' };
  if (!city.trim() || lookupNames.some((n) => same(city, n))) return { action: 'fill', name };
  return { action: 'ask', name };
}
