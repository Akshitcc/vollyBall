/** Key-less map (web + Android without a Maps key): tap maths (QA bug C), label layout (G), Android fallback. */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';
import React from 'react';
import PreviewMap, { USER_CLEAR, USER_DOT, CALLOUT_MAX_H, calloutHeight, calloutPlacement, calloutRowHeight, clusterIndices, CLUSTER_PX, fromFraction, labelWidth, layoutLabels, maxLabelWidth, needsReveal, spanFor, tapOffset, toFraction } from '../maps/PreviewMap';
import { canUseNativeMap } from '../maps/AppMap';
import { fitRadiusKm, type GeoPoint } from '../../core/geo';
import '../../i18n';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('react-native-maps', () => ({ __esModule: true, default: () => null, Marker: () => null, PROVIDER_GOOGLE: 'google' }));

const center = { lat: 28.6, lng: 77.2 };

test('fractions round-trip', () => {
  const span = spanFor(3);
  const p = fromFraction(0.25, 0.8, center, span);
  const f = toFraction(p, center, span);
  expect(f.fx).toBeCloseTo(0.25);
  expect(f.fy).toBeCloseTo(0.8);
  expect(toFraction(center, center, span)).toEqual({ fx: 0.5, fy: 0.5 });
});

describe('tapOffset', () => {
  const restore = Platform.OS;
  afterEach(() => {
    (Platform as { OS: string }).OS = restore;
  });
  test('web: measured against the map box, not the child element that was hit', () => {
    (Platform as { OS: string }).OS = 'web';
    const node = { getBoundingClientRect: () => ({ left: 100, top: 50 }) };
    // locationX/offsetX would be relative to a grid line here; they must be ignored
    const e = { nativeEvent: { clientX: 160, clientY: 130, locationX: 3, locationY: 1, pageX: 160, pageY: 130 } };
    expect(tapOffset(e as never, node)).toEqual({ x: 60, y: 80 });
  });
  test('native: locationX/Y of the map', () => {
    (Platform as { OS: string }).OS = 'android';
    expect(tapOffset({ nativeEvent: { locationX: 12, locationY: 34 } } as never, null)).toEqual({ x: 12, y: 34 });
  });
});

type Laid = ReturnType<typeof layoutLabels>[number];
const DOTR = 12;
/** The invariants every layout must keep: labels inside the map, off other labels and other dots. */
function checkInvariants(out: Laid[], size: { w: number; h: number }) {
  const hit = (p: { l: number; t: number; r: number; b: number }, q: typeof p) => p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
  const box = (g: Laid) => ({ l: g.label!.l, t: g.label!.t, r: g.label!.l + g.label!.w, b: g.label!.t + 18 });
  const labelled = out.filter((g) => g.label);
  for (const g of labelled) {
    const r = box(g);
    expect(r.l).toBeGreaterThanOrEqual(0);
    expect(r.t).toBeGreaterThanOrEqual(0);
    expect(r.r).toBeLessThanOrEqual(size.w);
    expect(r.b).toBeLessThanOrEqual(size.h);
    for (const o of labelled) if (o !== g) expect(hit(r, box(o))).toBe(false);
    for (const o of out) {
      if (o === g) continue;
      const x = o.fx * size.w, y = o.fy * size.h;
      expect(hit(r, { l: x - DOTR, t: y - DOTR, r: x + DOTR, b: y + DOTR })).toBe(false);
    }
  }
}

test('labels never overlap each other or other dots, stay inside, and outside markers are skipped', () => {
  const span = spanFor(3);
  const size = { w: 300, h: 200 };
  const m = (id: string, fx: number, fy: number) => ({ id, title: id, ...fromFraction(fx, fy, center, span) });
  const markers = [m('a', 0.5, 0.5), m('b', 0.53, 0.5), m('c', 0.5, 0.95), m('d', 1.4, 0.5), m('e', 0.48, 0.47), m('f', 0.55, 0.53), m('g', 0.05, 0.1), m('h', 0.97, 0.1)];
  const out = layoutLabels(markers, center, span, size);
  expect(out.some((g) => g.members.some((x) => x.id === 'd'))).toBe(false);
  // b, e and f are within CLUSTER_PX of a: one numbered cluster dot labelled "4 places"
  const cl = out.find((g) => g.members.length > 1)!;
  expect(cl.members.map((x) => x.id).sort()).toEqual(['a', 'b', 'e', 'f']);
  expect(cl.text).toBe('4 places');
  expect(needsReveal(cl)).toBe(true);
  expect(out.find((g) => g.key === 'c')!.label!.pos).not.toBe('below'); // no room below at the bottom edge
  expect(out.find((g) => g.key === 'g')!.label).not.toBeNull();
  expect(out.find((g) => g.key === 'h')!.label).not.toBeNull();
  checkInvariants(out, size);
});

test('merge radius = a dot plus a label (not smaller than the 24 px dot)', () => {
  expect(CLUSTER_PX).toBeGreaterThanOrEqual(24 + 18);
  const span = spanFor(3);
  const size = { w: 300, h: 200 };
  const m = (id: string, dx: number) => ({ id, title: id, ...fromFraction(0.5 + dx / size.w, 0.5, center, span) });
  expect(layoutLabels([m('a', 0), m('b', 30)], center, span, size)).toHaveLength(1); // 30 px apart: merged
  expect(layoutLabels([m('a', 0), m('b', CLUSTER_PX + 2)], center, span, size)).toHaveLength(2);
});

test('labels try below, above, right and left, and shorten before giving up; wide maps show whole names', () => {
  const span = spanFor(3);
  const size = { w: 300, h: 200 };
  const m = (id: string, fx: number, fy: number, title = id) => ({ id, title, ...fromFraction(fx, fy, center, span) });
  const out = layoutLabels([m('top', 0.5, 0.35, 'Top court'), m('bottom', 0.5, 0.6, 'Bottom court')], center, span, size);
  expect(out.every((g) => g.label)).toBe(true);
  checkInvariants(out, size);
  const title = 'Delhi Smashers vs Yamuna Blockers';
  const narrow = layoutLabels([m('x', 0.5, 0.5, title)], center, span, size)[0];
  expect(narrow.label!.truncated).toBe(true);
  expect(needsReveal(narrow)).toBe(false); // a single place still opens on one tap
  const wide = layoutLabels([m('x', 0.5, 0.5, title)], center, span, { w: 1024, h: 267 })[0];
  expect(wide.label!.truncated).toBe(false);
  expect(maxLabelWidth(412)).toBeLessThan(maxLabelWidth(1024));
  expect(labelWidth('Ab')).toBeLessThan(40);
});

// The Nearby map's seed data at the default 25 km, as QA saw it (fix re-tests #3 and 204 #2): the
// live match, the Monsoon Cup and Lodhi Garden court are 1-3 km apart and must merge.
const HOME = { lat: 28.6139, lng: 77.209 };
const seedMarkers = [
  { id: 'match:match_live', title: 'Delhi Smashers vs Yamuna Blockers', subtitle: 'Talkatora Indoor Stadium', lat: HOME.lat + 0.01, lng: HOME.lng, color: '#E53935' },
  { id: 'tournament:tour_monsoon', title: '🏆 Monsoon Cup 2026', subtitle: 'Jawaharlal Nehru Stadium', lat: HOME.lat + 0.005, lng: HOME.lng + 0.01, color: '#6A1B9A' },
  { id: 'court:c1', title: '🏐 Lodhi Garden Sand Court', subtitle: 'Lodhi Garden', lat: 28.5931, lng: 77.2197 },
  { id: 'match:match_upcoming', title: 'Delhi Smashers vs Yamuna Blockers', subtitle: 'Rajouri Garden Community Court', lat: HOME.lat + 0.03, lng: HOME.lng - 0.02 },
  { id: 'court:c2', title: '🏐 DDA Sports Complex', subtitle: 'Paschim Vihar', lat: 28.6448, lng: 77.1167 },
];

test.each([
  [412, 412],
  [1024, 267],
  [360, 300],
])('seed data at 25 km on %ix%i: live, Monsoon Cup and Lodhi court share one dot; no overlaps', (w, h) => {
  const out = layoutLabels(seedMarkers, HOME, spanFor(25), { w, h });
  checkInvariants(out, { w, h });
  const covered = out.flatMap((g) => g.members.map((m) => m.id)).sort();
  expect(covered).toEqual(seedMarkers.map((m) => m.id).sort());
  const live = out.find((g) => g.members.some((m) => m.id === 'match:match_live'))!;
  expect(live.members.map((m) => m.id)).toEqual(expect.arrayContaining(['match:match_live', 'tournament:tour_monsoon', 'court:c1']));
  // every dot is labelled at this zoom
  expect(out.every((g) => g.label)).toBe(true);
});

test('the list of a cluster covers no dot and stays inside (412 px seed)', () => {
  const size = { w: 412, h: 412 };
  const out = layoutLabels(seedMarkers, HOME, spanFor(25), size);
  const cl = out.find(needsReveal)!;
  // a 240 px list doesn't fit beside a centred dot on a phone; a narrower one (rows wrap) does
  expect(calloutPlacement(cl, out, size, { w: 240, h: calloutHeight(cl.members, 240) }).mode).toBe('sheet');
  const place = calloutPlacement(cl, out, size, [240, 208, 168].map((w) => ({ w, h: calloutHeight(cl.members, w) })), [{ x: 206, y: 206, d: 16 }]);
  expect(place.mode).toBe('float');
  if (place.mode !== 'float') return;
  expect(place.w).toBe(168);
  expect(place.l).toBeGreaterThanOrEqual(4);
  expect(place.l + place.w).toBeLessThanOrEqual(size.w - 4);
  expectNoDotCovered(out, size, place);
});

// ---- Fix re-test 209: QA's exact setup -------------------------------------------------------
// QA ran Chrome at a 1920x1114 CSS viewport (screenshots downscaled to 1024x594): the Nearby map
// measures 1920x479.25 there. Talkatora–Monsoon is 43.0 px (< 44, merged), Monsoon–Lodhi 27.6 px,
// but Talkatora–Lodhi 56.2 px – the old greedy pass only compared against a cluster's first member,
// so Lodhi stayed a separate pin just below the "2 places" dot (02a).
const QA_MAP = { w: 1920, h: 479.25 };
const ids = (g: Laid) => g.members.map((m) => m.id).sort();
const pxOf = (g: { fx: number; fy: number }, size: { w: number; h: number }) => [g.fx * size.w, g.fy * size.h] as const;
function expectNoDotCovered(out: Laid[], size: { w: number; h: number }, box: { l: number; t: number; w: number; h: number }) {
  for (const g of out) {
    const [x, y] = pxOf(g, size);
    const hit = box.l < x + DOTR && x - DOTR < box.l + box.w && box.t < y + DOTR && y - DOTR < box.t + box.h;
    expect({ dot: g.key, hit }).toEqual({ dot: g.key, hit: false });
  }
  const here = { x: size.w / 2, y: size.h / 2 }; // "you are here" (map centre)
  expect(box.l < here.x + 8 && here.x - 8 < box.l + box.w && box.t < here.y + 8 && here.y - 8 < box.t + box.h).toBe(false);
}
function expectTransitive(markers: typeof seedMarkers, out: Laid[], size: { w: number; h: number }, span: number, c = HOME) {
  const groupOf = new Map(out.flatMap((g, i) => g.members.map((m) => [m.id, i] as const)));
  for (const a of markers)
    for (const b of markers) {
      if (a === b || !groupOf.has(a.id) || !groupOf.has(b.id)) continue;
      const fa = toFraction(a, c, span), fb = toFraction(b, c, span);
      if (Math.hypot((fa.fx - fb.fx) * size.w, (fa.fy - fb.fy) * size.h) < CLUSTER_PX) expect([a.id, b.id, groupOf.get(a.id)]).toEqual([a.id, b.id, groupOf.get(b.id)]);
    }
  // re-checked after merging: no two dots closer than the merge radius (where they'd be drawn
  // before one is moved off the "you are here" dot)
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const [x1, y1] = pxOf({ fx: out[i].cx, fy: out[i].cy }, size), [x2, y2] = pxOf({ fx: out[j].cx, fy: out[j].cy }, size);
      expect(Math.hypot(x1 - x2, y1 - y2)).toBeGreaterThanOrEqual(CLUSTER_PX);
    }
}

test("QA's exact pins and 1920x479 map at 25 km: Lodhi joins Talkatora + Monsoon (3 places)", () => {
  const out = layoutLabels(seedMarkers, HOME, spanFor(25), QA_MAP);
  const cl = out.filter(needsReveal);
  expect(cl).toHaveLength(1);
  expect(ids(cl[0])).toEqual(['court:c1', 'match:match_live', 'tournament:tour_monsoon']);
  expect(cl[0].text).toBe('3 places');
  expect(out.map((g) => g.key)).toEqual(['cluster:court:c1,match:match_live,tournament:tour_monsoon', 'match:match_upcoming', 'court:c2']);
  expectTransitive(seedMarkers, out, QA_MAP, spanFor(25));
  checkInvariants(out, QA_MAP);
});

const permutations = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));

test.each([
  [1920, 479.25],
  [2048, 512.55],
  [1024, 267],
  [412, 412],
  [360, 300],
])('clusters do not depend on marker order (all 120 orders, %ix%i)', (w, h) => {
  const size = { w, h };
  const want = layoutLabels(seedMarkers, HOME, spanFor(25), size).map(ids).map(String).sort();
  for (const p of permutations(seedMarkers)) {
    const out = layoutLabels(p, HOME, spanFor(25), size);
    expect(out.map(ids).map(String).sort()).toEqual(want);
    expectTransitive(p, out, size, spanFor(25));
  }
});

test('single-linkage on random pins: any dot within the radius of a member joins; drawn dots stay apart', () => {
  let seed = 209;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const span = spanFor(5);
  for (let run = 0; run < 40; run++) {
    const size = { w: 200 + Math.floor(rnd() * 1800), h: 200 + Math.floor(rnd() * 400) };
    const ms = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, ...fromFraction(0.3 + rnd() * 0.4, 0.3 + rnd() * 0.4, center, span) }));
    const out = layoutLabels(ms, center, span, size);
    expectTransitive(ms as never, out, size, span, center);
    expect(clusterIndices(ms.map((m) => ({ id: m.id, ...toFraction(m, center, span) })), size).flat().sort((a, b) => a - b)).toEqual(ms.map((_, i) => i));
  }
});

test("QA's 02b layout: the list avoids every dot even when all four centred sides are blocked", () => {
  // the drawn state of 02b (px): "2 places" dot, Lodhi just below-right, upcoming match to the left
  const size = QA_MAP;
  const g = (key: string, x: number, y: number, n = 1): Laid => ({ key, members: Array.from({ length: n }, (_, i) => ({ id: `${key}${i}`, title: key, lat: 0, lng: 0 })), fx: x / size.w, fy: y / size.h, cx: x / size.w, cy: y / size.h, text: key, label: null });
  const open = g('cluster', 981, 232, 2);
  const out = [open, g('lodhi', 1006, 262), g('upcoming', 875, 208), g('dda', 567, 207)];
  const box = { w: 240, h: calloutHeight(open.members, 240) };
  const place = calloutPlacement(open, out, size, box, [{ x: 960, y: 239.6, d: 16 }]);
  expect(place.mode).toBe('float');
  if (place.mode !== 'float') return;
  expectNoDotCovered(out, size, { l: place.l, t: place.t, ...box });
});

test('no free spot beside the dot -> bottom sheet; a list taller than the map -> bottom sheet', () => {
  const size = { w: 412, h: 200 };
  const g = (key: string, x: number, y: number, n = 1): Laid => ({ key, members: Array.from({ length: n }, (_, i) => ({ id: `${key}${i}`, title: key, lat: 0, lng: 0 })), fx: x / size.w, fy: y / size.h, cx: x / size.w, cy: y / size.h, text: key, label: null });
  const open = g('c', 206, 100, 3);
  // a ring of pins all round it, and in every corner
  const ring = [[60, 30], [150, 30], [260, 30], [350, 30], [60, 170], [150, 170], [260, 170], [350, 170], [20, 100], [390, 100], [110, 100], [300, 100], [20, 20], [392, 20], [20, 180], [392, 180]].map(([x, y], i) => g('r' + i, x, y));
  expect(calloutPlacement(open, [open, ...ring], size, { w: 240, h: 100 }).mode).toBe('sheet');
  expect(calloutPlacement(open, [open], size, { w: 240, h: 230 }).mode).toBe('sheet');
  const corner = g('k', 60, 40, 3);
  expect(calloutPlacement(corner, [corner], size, { w: 240, h: 100 }).mode).toBe('float');
});

test('list rows: long titles get two lines; the list scrolls with a max height', () => {
  const short = { title: 'Lodhi', subtitle: 'Lodhi Garden' };
  const long = { title: 'दिल्ली स्मैशर्स बनाम यमुना ब्लॉकर्स बनाम कोई और', subtitle: 'तालकटोरा' };
  expect(calloutRowHeight(long, 240)).toBeGreaterThan(calloutRowHeight(short, 240));
  const many = Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, title: 'Place ' + i, subtitle: 'Area', lat: 0, lng: 0 }));
  expect(calloutHeight(many, 240)).toBe(CALLOUT_MAX_H);
});

async function mapWith(markers = seedMarkers, onMarkerPress = jest.fn(), size: { w: number; h: number } = { w: 412, h: 412 }, c = HOME, radiusKm = 25, user?: GeoPoint) {
  await render(<PreviewMap center={c} radiusKm={radiusKm} markers={markers} onMarkerPress={onMarkerPress} showsUser={!!user} userLocation={user ?? null} />);
  await act(async () => screen.getByTestId('preview-map').props.onLayout({ nativeEvent: { layout: { width: size.w, height: size.h } } }));
  return onMarkerPress;
}

// Load-safe (fix re-test 214 #2): render the map once up front – a pin, the cluster list, a row and the
// bottom sheet (RN's lazily required Modal) – so module loading on a cold cache isn't timed inside the
// first render test. Then every test gets a tight timeout (a real slowdown still fails); WARM_T is
// only the warm-up's backstop.
const WARM_T = 15_000;
jest.setTimeout(5_000);
beforeAll(async () => {
  void require('react-native').Modal;
  await mapWith();
  await fireEvent.press(screen.getByTestId('marker-court:c2'));
  await fireEvent.press(screen.getByTestId('marker-cluster-match:match_live'));
  await fireEvent.press(screen.getByTestId('map-callout-court:c1'));
  await screen.unmount();
  const many = Array.from({ length: 7 }, (_, i) => ({ id: 'court:k' + i, title: 'Court ' + i, subtitle: 'Area ' + i, lat: HOME.lat + 0.001 * i, lng: HOME.lng + 0.001 }));
  await mapWith(many, jest.fn(), { w: 360, h: 200 });
  await fireEvent.press(screen.getByTestId('marker-cluster-court:k0'));
  await fireEvent.press(screen.getByTestId('map-sheet-backdrop'));
  await screen.unmount();
}, WARM_T);

test('one tap on a single pin opens it (even with a shortened label)', async () => {
  const onMarkerPress = await mapWith();
  await fireEvent.press(screen.getByTestId('marker-court:c2'));
  expect(onMarkerPress).toHaveBeenCalledWith('court:c2');
  expect(screen.queryByTestId('map-callout')).toBeNull();
});

test('a cluster lists its places; picking a row opens it (courts too)', async () => {
  const onMarkerPress = await mapWith();
  expect(screen.getByTestId('map-reveal-hint')).toBeTruthy();
  expect(screen.getByTestId('preview-map').props.accessibilityState?.disabled ?? false).toBe(false);
  const cluster = screen.getByTestId('marker-cluster-match:match_live');
  expect(cluster.props.accessibilityLabel).toContain('Monsoon Cup 2026');
  await fireEvent.press(cluster);
  expect(screen.getByTestId('map-callout')).toBeTruthy();
  expect(onMarkerPress).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('map-callout-court:c1'));
  expect(onMarkerPress).toHaveBeenCalledWith('court:c1');
  expect(screen.queryByTestId('map-callout')).toBeNull();
});

test('the list closes on a map tap, and another pin\'s tap closes it and opens that pin', async () => {
  const onMarkerPress = await mapWith();
  await fireEvent.press(screen.getByTestId('marker-cluster-match:match_live'));
  await fireEvent.press(screen.getByTestId('preview-map'));
  expect(screen.queryByTestId('map-callout')).toBeNull();
  await fireEvent.press(screen.getByTestId('marker-cluster-match:match_live'));
  expect(screen.getByTestId('map-callout')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('marker-court:c2'));
  expect(screen.queryByTestId('map-callout')).toBeNull();
  expect(onMarkerPress).toHaveBeenCalledWith('court:c2');
});

const flat = (st: unknown): Record<string, number> => (Array.isArray(st) ? Object.assign({}, ...st.map(flat)) : (st as Record<string, number>) ?? {});

test("rendered at QA's 1920 px map: one '3 places' dot, and the open list covers no dot", async () => {
  await mapWith(seedMarkers, jest.fn(), QA_MAP);
  expect(screen.queryByTestId('marker-court:c1')).toBeNull(); // Lodhi is in the cluster now
  await fireEvent.press(screen.getByTestId('marker-cluster-match:match_live'));
  const callout = screen.getByTestId('map-callout');
  const st = flat(callout.props.style);
  const h = calloutHeight(seedMarkers.slice(0, 3), st.width);
  const out = layoutLabels(seedMarkers, HOME, spanFor(25), QA_MAP);
  expectNoDotCovered(out, QA_MAP, { l: st.left, t: st.top, w: st.width, h });
  // its measured height is used once it has rendered
  await act(async () => callout.props.onLayout({ nativeEvent: { layout: { width: st.width, height: h + 30 } } }));
  const st2 = flat(screen.getByTestId('map-callout').props.style);
  expectNoDotCovered(out, QA_MAP, { l: st2.left, t: st2.top, w: st2.width, h: h + 30 });
  expect(screen.getByTestId('map-callout-scroll')).toBeTruthy();
  const rowTitle = screen.getAllByText('Delhi Smashers vs Yamuna Blockers').find((n) => n.props.numberOfLines !== 1);
  expect(rowTitle?.props.numberOfLines).toBe(2);
});

test('a big cluster on a small map opens as a bottom sheet; rows open places, backdrop closes', async () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: 'court:k' + i, title: 'Court ' + i, subtitle: 'Area ' + i, lat: HOME.lat + 0.001 * i, lng: HOME.lng + 0.001 }));
  const onMarkerPress = await mapWith(many, jest.fn(), { w: 360, h: 200 });
  await fireEvent.press(screen.getByTestId('marker-cluster-court:k0'));
  expect(screen.queryByTestId('map-callout')).toBeNull();
  expect(screen.getByTestId('map-sheet')).toBeTruthy();
  expect(screen.getAllByText('7 places').length).toBeGreaterThanOrEqual(1); // sheet title (and the dot's label)
  await fireEvent.press(screen.getByTestId('map-sheet-backdrop'));
  expect(screen.queryByTestId('map-sheet')).toBeNull();
  await fireEvent.press(screen.getByTestId('marker-cluster-court:k0'));
  await fireEvent.press(screen.getByTestId('map-callout-court:k5'));
  expect(onMarkerPress).toHaveBeenCalledWith('court:k5');
  expect(screen.queryByTestId('map-sheet')).toBeNull();
});


// ---- Fix re-test 210: QA's window sizes ------------------------------------------------------
// QA's viewport ~1280x743 and windows ~1010/710/626 px wide: the Nearby map measured (browser)
// 1280x312, 1008x305, 708x305 and 626x306. At 708/626 the cluster's centre fell 4 px from the
// "you are here" dot, and the list opened detached in a corner (corner candidates won because they
// "covered fewer labels" than any spot beside the dot).
const QA210 = [
  [1280, 312],
  [1008, 305],
  [708, 305],
  [626, 306],
] as const;
const WIDTHS = [260, 208, 168];
const markersAt = (radiusKm: number) => ({ span: spanFor(radiusKm), radiusKm });
const MUMBAI = { id: 'court:c3', title: '🏐 Marine Drive Courts', subtitle: 'Mumbai', lat: 18.9432, lng: 72.8236 }; // seed court c3

function expectAnchored(place: { l: number; t: number; w: number; h: number }, dot: Laid, size: { w: number; h: number }) {
  const [x, y] = pxOf(dot, size);
  // gap from the dot's centre to the nearest point of the list: right next to it, never detached
  const gx = Math.max(place.l - x, 0, x - (place.l + place.w));
  const gy = Math.max(place.t - y, 0, y - (place.t + place.h));
  expect(Math.hypot(gx, gy)).toBeLessThanOrEqual(DOTR + 8);
}

describe.each(QA210)("QA's %ix%i map", (w, h) => {
  const size = { w, h };
  test.each([25, 100, 3000])('at %i km the "you are here" dot is never under another dot or label', (km) => {
    const markers = km === 3000 ? [...seedMarkers, MUMBAI] : seedMarkers;
    const radius = km === 3000 ? fitRadiusKm(HOME, markers) : km;
    const out = layoutLabels(markers, HOME, spanFor(radius), size, undefined, HOME); // location known: dot drawn at HOME
    for (const g of out) {
      const [x, y] = pxOf(g, size);
      expect(Math.hypot(x - w / 2, y - h / 2)).toBeGreaterThanOrEqual(USER_CLEAR - 0.01);
      if (g.label) {
        const r = { l: g.label.l, t: g.label.t, r: g.label.l + g.label.w, b: g.label.t + 18 };
        expect(r.l < w / 2 + USER_DOT / 2 && w / 2 - USER_DOT / 2 < r.r && r.t < h / 2 + USER_DOT / 2 && h / 2 - USER_DOT / 2 < r.b).toBe(false);
      }
    }
    if (km === 3000) expect(out.flatMap((g) => g.members.map((m) => m.id))).toContain('court:c3'); // Mumbai on the map
  });
  test('the cluster list opens right next to its dot covering no dot, or as a bottom sheet', () => {
    const out = layoutLabels(seedMarkers, HOME, spanFor(25), size, undefined, HOME);
    const cl = out.find(needsReveal)!;
    const place = calloutPlacement(cl, out, size, WIDTHS.map((bw) => ({ w: bw, h: calloutHeight(cl.members, bw) })), [{ x: w / 2, y: h / 2, d: USER_DOT }]);
    if (place.mode === 'sheet') return;
    expectAnchored(place, cl, size);
    expectNoDotCovered(out, size, place);
  });
});

test('a list that would only fit in a far corner becomes a bottom sheet (no detached list)', () => {
  const size = { w: 626, h: 306 };
  const g = (key: string, x: number, y: number, n = 1): Laid => ({ key, members: Array.from({ length: n }, (_, i) => ({ id: `${key}${i}`, title: key, lat: 0, lng: 0 })), fx: x / size.w, fy: y / size.h, cx: x / size.w, cy: y / size.h, text: key, label: null });
  const open = g('c', 313, 129, 4);
  // pins left and right of the dot; only the top-left corner of the map is free
  const others = [g('l', 160, 150), g('r', 470, 150), g('r2', 560, 60), g('b', 313, 260), g('t', 313, 30)];
  expect(calloutPlacement(open, [open, ...others], size, { w: 260, h: 178 }).mode).toBe('sheet');
});

test('"Anywhere" fits the map to every listed place (Mumbai from Delhi); near places keep 100 km', () => {
  const r = fitRadiusKm(HOME, [...seedMarkers, MUMBAI]);
  const f = toFraction(MUMBAI, HOME, spanFor(r));
  expect(f.fx).toBeGreaterThan(0.05);
  expect(f.fy).toBeLessThan(0.95);
  expect(fitRadiusKm(HOME, seedMarkers)).toBe(100);
});

describe('web: Esc closes the cluster list and focuses its dot again', () => {
  const restoreOS = Platform.OS;
  afterEach(() => {
    (Platform as { OS: string }).OS = restoreOS;
    delete (global as { document?: unknown }).document;
    jest.useRealTimers();
  });
  test('Esc', async () => {
    jest.useFakeTimers();
    (Platform as { OS: string }).OS = 'web';
    const handlers: Record<string, (e: unknown) => void> = {};
    const dotEl = { focus: jest.fn() };
    const asked: string[] = [];
    (global as { document?: unknown }).document = {
      addEventListener: (t: string, h: (e: unknown) => void) => (handlers[t] = h),
      removeEventListener: (t: string) => delete handlers[t],
      querySelector: (sel: string) => (asked.push(sel), dotEl),
    };
    await mapWith(seedMarkers, jest.fn(), { w: 708, h: 305 });
    await fireEvent.press(screen.getByTestId('marker-cluster-match:match_live'));
    expect(screen.queryByTestId('map-callout') ?? screen.queryByTestId('map-sheet')).toBeTruthy();
    const e = { key: 'Escape', preventDefault: jest.fn(), stopPropagation: jest.fn() };
    await act(async () => handlers.keydown(e));
    expect(screen.queryByTestId('map-callout')).toBeNull();
    expect(screen.queryByTestId('map-sheet')).toBeNull();
    await act(async () => jest.runOnlyPendingTimers());
    expect(asked).toContain('[data-testid="marker-cluster-match:match_live"]');
    expect(dotEl.focus).toHaveBeenCalled();
    expect(handlers.keydown).toBeUndefined(); // listener removed once closed
  });
});

test('rendered at 626 px: the list sits next to its dot (or a sheet), and its own label is hidden', async () => {
  await mapWith(seedMarkers, jest.fn(), { w: 626, h: 306 }, HOME, 25, HOME); // QA's Nearby map with a real location
  expect(screen.getByTestId('marker-label-match:match_live')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('marker-cluster-match:match_live'));
  expect(screen.queryByTestId('marker-label-match:match_live')).toBeNull();
  const callout = screen.queryByTestId('map-callout');
  if (!callout) return expect(screen.getByTestId('map-sheet')).toBeTruthy();
  const st = flat(callout.props.style);
  const out = layoutLabels(seedMarkers, HOME, spanFor(25), { w: 626, h: 306 }, undefined, HOME);
  const cl = out.find(needsReveal)!;
  const h = calloutHeight(cl.members, st.width);
  expectAnchored({ l: st.left, t: st.top, w: st.width, h }, cl, { w: 626, h: 306 });
  expectNoDotCovered(out, { w: 626, h: 306 }, { l: st.left, t: st.top, w: st.width, h });
});

test('tapping picks the tapped point and the map does not move', async () => {
  (Platform as { OS: string }).OS = 'android';
  const onMapPress = jest.fn();
  await render(<PreviewMap center={center} radiusKm={3} onMapPress={onMapPress} />);
  const map = screen.getByTestId('preview-map');
  await fireEvent(map, 'layout', { nativeEvent: { layout: { width: 200, height: 200 } } });
  await fireEvent.press(map, { nativeEvent: { locationX: 50, locationY: 150 } });
  const p = onMapPress.mock.calls[0][0];
  const f = toFraction(p, center, spanFor(3));
  expect(f.fx).toBeCloseTo(0.25);
  expect(f.fy).toBeCloseTo(0.75);
  (Platform as { OS: string }).OS = 'ios';
});

test('Android uses the native map only with a Google Maps key; iOS always can', () => {
  expect(canUseNativeMap('android', { hasGoogleMapsKey: false })).toBe(false);
  expect(canUseNativeMap('android', undefined)).toBe(false);
  expect(canUseNativeMap('android', { hasGoogleMapsKey: true })).toBe(true);
  expect(canUseNativeMap('ios', {})).toBe(true);
});
