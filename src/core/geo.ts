/** Geo helpers. Pure TypeScript. */
export interface GeoPoint {
  lat: number;
  lng: number;
}
export interface Place extends GeoPoint {
  name: string;
}

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function nearby<T extends { location?: GeoPoint | null }>(
  items: readonly T[],
  center: GeoPoint,
  radiusKm: number,
): (T & { distanceKm: number })[] {
  return items
    .filter((i): i is T & { location: GeoPoint } => !!i.location)
    .map((i) => ({ ...i, distanceKm: distanceKm(center, i.location) }))
    .filter((i) => i.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/**
 * The place a match "at this court" is played at: named after the court ("Lodhi Garden Sand Court"),
 * not its area ("Lodhi Garden"). A Place has a single name, so the area isn't kept separately
 * (fix re-test 209).
 */
export function placeFromCourt(c: { name: string; location: Place }): Place {
  return { lat: c.location.lat, lng: c.location.lng, name: c.name.trim() || c.location.name };
}

/**
 * Map radius (km, half the square map's side) that shows every point around `center` with some
 * margin – used for the Nearby map's "Anywhere" (fix re-test 210 #4: Marine Drive Courts in Mumbai
 * was listed but had no dot, because the map stayed at 200 km). The centre stays on the user, so
 * the "you are here" dot doesn't move. 1° ≈ 111 km, matching the map's own projection.
 */
export function fitRadiusKm(center: GeoPoint, points: readonly GeoPoint[], minKm = 100, pad = 1.2): number {
  const deg = points.reduce((m, p) => Math.max(m, Math.abs(p.lat - center.lat), Math.abs(p.lng - center.lng)), 0);
  return Math.min(10000, Math.max(minKm, Math.ceil(deg * 111 * pad)));
}
