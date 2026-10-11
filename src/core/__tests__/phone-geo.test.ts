import { distanceKm, nearby } from '../geo';
import { normalizePhone } from '../phone';

describe('phone', () => {
  it.each([
    ['98765 43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765-43210', '+919876543210'],
  ])('normalizes %s', (input, out) => expect(normalizePhone(input)).toBe(out));
  it.each(['', '123', '12345678901234567', '1234567890', '+1 650 555 1234'])('rejects %s', (input) => expect(normalizePhone(input)).toBeNull());
});

describe('geo', () => {
  it('computes distances', () => {
    const delhi = { lat: 28.6139, lng: 77.209 };
    const mumbai = { lat: 19.076, lng: 72.8777 };
    expect(Math.round(distanceKm(delhi, mumbai))).toBeGreaterThan(1100);
    expect(Math.round(distanceKm(delhi, mumbai))).toBeLessThan(1200);
    const items = [{ id: 1, location: mumbai }, { id: 2, location: { lat: 28.62, lng: 77.21 } }, { id: 3, location: null }];
    expect(nearby(items, delhi, 50).map((i) => i.id)).toEqual([2]);
  });
});
