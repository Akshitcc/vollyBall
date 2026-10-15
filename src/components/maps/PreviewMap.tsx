// Key-less map: the web build (react-native-maps has no web support) and Android builds without
// a Google Maps API key (react-native-maps crashes there without one; see AppMap.tsx) use this
// stylised mini-map with relative pin positions. Tapping picks a point (LocationPicker).
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { Modal } from '../AppModal'; // 1.4.0 (V139-7): holds the review prompt while open
import type { GeoPoint } from '../../core/geo';
import { colors, swatchRing } from '../../theme';
import type { AppMapProps, MapMarker } from './types';

/** Degrees of latitude/longitude shown edge to edge for a radius (1° ≈ 111 km). */
export const spanFor = (radiusKm: number) => (radiusKm / 111) * 2;

/** Map fraction (0..1 from the top-left corner) for a point. */
export function toFraction(p: GeoPoint, center: GeoPoint, span: number) {
  return { fx: 0.5 + (p.lng - center.lng) / span, fy: 0.5 - (p.lat - center.lat) / span };
}
/** Point for a map fraction (inverse of toFraction). */
export function fromFraction(fx: number, fy: number, center: GeoPoint, span: number): GeoPoint {
  return { lat: center.lat - (fy - 0.5) * span, lng: center.lng + (fx - 0.5) * span };
}

/**
 * Where the tap landed inside the map, in pixels from its top-left corner.
 * Web: page coordinates minus the map's own box. `offsetX`/`locationX` are relative to whichever
 * child element was hit (a grid line, the "you are here" dot…), which put pins in the wrong place
 * (QA bug C). Native: locationX/Y are relative to the touched view; the decoration layer has
 * pointerEvents="none", so that is the map itself.
 */
export function tapOffset(e: GestureResponderEvent, node: unknown): { x: number; y: number } | null {
  const ne = e.nativeEvent as GestureResponderEvent['nativeEvent'] & { clientX?: number; clientY?: number };
  const el = node as { getBoundingClientRect?: () => { left: number; top: number } } | null;
  if (Platform.OS === 'web' && el?.getBoundingClientRect) {
    const r = el.getBoundingClientRect();
    const sx = typeof window !== 'undefined' ? window.scrollX : 0;
    const sy = typeof window !== 'undefined' ? window.scrollY : 0;
    const cx = ne.clientX ?? ne.pageX - sx;
    const cy = ne.clientY ?? ne.pageY - sy;
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
    return { x: cx - r.left, y: cy - r.top };
  }
  if (!Number.isFinite(ne.locationX) || !Number.isFinite(ne.locationY)) return null;
  return { x: ne.locationX, y: ne.locationY };
}

const LABEL_MAX_W = 220;
const LABEL_MIN_W = 56;
const LABEL_H = 18;
const DOT = 24;
/**
 * Dots closer than this (px, centre to centre) become one numbered cluster dot: a dot plus the room
 * a label needs beside it. Closer than that, two places can't both be drawn and labelled without
 * covering each other (fix re-test 204 #2: 20 px was smaller than the 24 px dot itself).
 */
export const CLUSTER_PX = DOT + LABEL_H + 2;
/** The "you are here" dot at the map centre, and how far (centre to centre) other dots keep off it. */
export const USER_DOT = 16;
export const USER_CLEAR = DOT / 2 + USER_DOT / 2 + 4;
/** Widest label for a map width: wider maps show whole names ("Delhi Smashers vs Yamuna Blockers"). */
export const maxLabelWidth = (mapW: number) => Math.round(Math.max(120, Math.min(LABEL_MAX_W, mapW * 0.4)));

type Rect = { l: number; t: number; r: number; b: number };
const hits = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const dotRect = (x: number, y: number, d = DOT, pad = 2): Rect => ({ l: x - d / 2 - pad, t: y - d / 2 - pad, r: x + d / 2 + pad, b: y + d / 2 + pad });
/** Horizontal alignment of a label near the map edges, so it isn't cut off. */
export const labelAlign = (fx: number) => (fx < 0.2 ? 'left' : fx > 0.8 ? 'right' : 'center');
/** Rough width of a 10px bold label (no text measuring on a pure layout pass). */
const rawLabelWidth = (text: string) => Math.ceil([...text].length * 6) + 10;
export const labelWidth = (text: string, max = 120) => Math.min(max, rawLabelWidth(text));

export type LabelPos = 'below' | 'above' | 'right' | 'left';
export type LaidOut = {
  /** First member's id for a single marker, `cluster:<ids>` for a cluster. */
  key: string;
  members: MapMarker[];
  fx: number;
  fy: number;
  /** Label text: the place's name, or "3 places" for a cluster. */
  text: string;
  /** Where the dot would be (members' average) before it was moved off the "you are here" dot. */
  cx: number;
  cy: number;
  /** Label box in px inside the map, or null when there is no room. */
  label: null | { pos: LabelPos; l: number; t: number; w: number; truncated: boolean };
};

const defaultClusterText = (n: number) => `${n} places`;

/** Centre-to-centre distance in px between two map fractions. */
const pxDist = (a: { fx: number; fy: number }, b: { fx: number; fy: number }, size: { w: number; h: number }) =>
  Math.hypot((a.fx - b.fx) * size.w, (a.fy - b.fy) * size.h);

/**
 * Groups points that can't be drawn apart (fix re-test 209 A). Deterministic and transitive:
 * 1. single-linkage: any point within CLUSTER_PX of *any* member of a group joins it (the old greedy
 *    pass only compared against a group's first member, so at QA's 1920 px map Lodhi Garden – 28 px
 *    from Monsoon Cup but 56 px from Talkatora – stayed a separate pin under the "2 places" dot);
 * 2. re-checked after merging: a group's dot is drawn at its members' average, so while any two
 *    drawn dots are closer than CLUSTER_PX the closest pair is merged too.
 * The points are sorted by id first, so the result never depends on the order they come in.
 * Returns groups of indices into `pts`, members in their original order.
 */
export function clusterIndices(pts: readonly { id: string; fx: number; fy: number }[], size: { w: number; h: number }): number[][] {
  const order = pts.map((_, i) => i).sort((a, b) => (pts[a].id < pts[b].id ? -1 : pts[a].id > pts[b].id ? 1 : a - b));
  if (!size.w || !size.h) return order.map((i) => [i]);
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };
  for (let i = 0; i < pts.length; i++)
    for (let j = i + 1; j < pts.length; j++) if (pxDist(pts[i], pts[j], size) < CLUSTER_PX) union(i, j);
  const groupsNow = () => {
    const by = new Map<number, number[]>();
    for (const i of order) {
      const r = find(i);
      by.set(r, [...(by.get(r) ?? []), i]);
    }
    return [...by.values()].map((idx) => ({
      idx,
      fx: idx.reduce((a, i) => a + pts[i].fx, 0) / idx.length,
      fy: idx.reduce((a, i) => a + pts[i].fy, 0) / idx.length,
    }));
  };
  for (;;) {
    const gs = groupsNow();
    let best: [number, number, number] | null = null;
    for (let a = 0; a < gs.length; a++)
      for (let b = a + 1; b < gs.length; b++) {
        const d = pxDist(gs[a], gs[b], size);
        if (d < CLUSTER_PX && (!best || d < best[2])) best = [a, b, d];
      }
    if (!best) return gs.map((g) => [...g.idx].sort((x, y) => x - y));
    union(gs[best[0]].idx[0], gs[best[1]].idx[0]);
  }
}

/**
 * Pin layout for the key-less map (QA bug G, fix re-tests #3, 204 #2 and 209 A):
 * 1. dots closer than CLUSTER_PX become one numbered cluster dot (clusterIndices);
 * 2. each dot's label tries below, above, right, left – at its full width (up to maxLabelWidth),
 *    then shortened with an ellipsis – and may not cover another label, another dot or the edge;
 * 3. a single dot opens its place on one tap; a cluster dot lists its places (see PreviewMap).
 * Markers outside the map are left out.
 */
export function layoutLabels(
  markers: readonly MapMarker[],
  center: GeoPoint,
  span: number,
  size: { w: number; h: number },
  clusterText: (n: number) => string = defaultClusterText,
  /** The user's real location when the "you are here" dot is drawn; null/undefined: no dot. */
  user?: GeoPoint | null,
): LaidOut[] {
  const pts = markers
    .map((m) => ({ m, id: m.id, ...toFraction(m, center, span) }))
    .filter((p) => p.fx >= 0 && p.fx <= 1 && p.fy >= 0 && p.fy <= 1);
  // 1. cluster; groups are shown in the order of their first member (the list's order)
  const groups = clusterIndices(pts, size)
    .sort((a, b) => a[0] - b[0])
    .map((idx) => ({ members: idx.map((i) => pts[i]) }));
  const laid: LaidOut[] = groups.map(({ members }) => ({
    key: members.length === 1 ? members[0].m.id : `cluster:${members.map((x) => x.m.id).sort().join(',')}`,
    members: members.map((x) => x.m),
    fx: members.reduce((a, x) => a + x.fx, 0) / members.length,
    fy: members.reduce((a, x) => a + x.fy, 0) / members.length,
    text: members.length === 1 ? members[0].m.title : clusterText(members.length),
    cx: 0,
    cy: 0,
    label: null,
  }));
  laid.forEach((g) => {
    g.cx = g.fx;
    g.cy = g.fy;
  });
  if (!size.w || !size.h) return laid;
  // 1b. The "you are here" dot is a fixed obstacle (fix re-test 210 #2/#3): a dot that would sit on
  // it is drawn USER_CLEAR px away from it instead, so both stay visible. Only when that dot is
  // actually drawn (a real location is known; fix re-test 211): otherwise nothing moves.
  const u = user ? toFraction(user, center, span) : null;
  if (u) {
    for (const g of laid) {
      const dx = (g.fx - u.fx) * size.w, dy = (g.fy - u.fy) * size.h;
      const d = Math.hypot(dx, dy);
      if (d >= USER_CLEAR) continue;
      const [ux, uy] = d < 0.5 ? [0, -1] : [dx / d, dy / d];
      g.fx = u.fx + (ux * USER_CLEAR) / size.w;
      g.fy = u.fy + (uy * USER_CLEAR) / size.h;
    }
  }
  const maxW = maxLabelWidth(size.w);
  const dots: Rect[] = laid.map((g) => {
    const x = g.fx * size.w, y = g.fy * size.h;
    return { l: x - DOT / 2, t: y - DOT / 2, r: x + DOT / 2, b: y + DOT / 2 };
  });
  // labels don't cover the "you are here" dot either
  if (u) dots.push(dotRect(u.fx * size.w, u.fy * size.h, USER_DOT, 2));
  // 2. labels
  const placed: Rect[] = [];
  const clampX = (l: number, w: number) => Math.max(0, Math.min(size.w - w, l));
  laid.forEach((g, i) => {
    const x = g.fx * size.w, y = g.fy * size.h;
    const full = labelWidth(g.text, maxW);
    const widths = full > LABEL_MIN_W ? [full, LABEL_MIN_W] : [full];
    for (const w of widths) {
      const spots: [LabelPos, number, number][] = [
        ['below', clampX(x - w / 2, w), y + DOT / 2 + 2],
        ['above', clampX(x - w / 2, w), y - DOT / 2 - 2 - LABEL_H],
        ['right', x + DOT / 2 + 3, y - LABEL_H / 2],
        ['left', x - DOT / 2 - 3 - w, y - LABEL_H / 2],
      ];
      for (const [pos, l, t] of spots) {
        const rect = { l, t, r: l + w, b: t + LABEL_H };
        if (rect.l < 0 || rect.t < 0 || rect.r > size.w || rect.b > size.h) continue;
        if (placed.some((q) => hits(rect, q)) || dots.some((d, j) => j !== i && hits(rect, d))) continue;
        placed.push(rect);
        g.label = { pos, l, t, w, truncated: w < rawLabelWidth(g.text) };
        return;
      }
    }
  });
  return laid;
}

/** Only a cluster is ambiguous: a single dot opens its place on the first tap. */
export const needsReveal = (g: LaidOut) => g.members.length > 1;

export type CalloutPlace =
  | { mode: 'float'; side: LabelPos; l: number; t: number; w: number; h: number; covered: 0; labelsCovered: number }
  | { mode: 'sheet' };

/**
 * Where a cluster's list of places goes (fix re-tests 204 #3 and 209 B). It must stay inside the map
 * and cover no dot at all – every other pin or cluster, its own dot and the "you are here" dot
 * (`extraDots`, px) – in the state actually drawn (`box` is the list's measured size once it has
 * rendered). `boxes` are the list's sizes to try, widest first (narrower lists wrap to more lines).
 * Candidates are always anchored to the dot: beside it on each side, slid along that side. Among the
 * ones covering no dot, the one covering the fewest *other* labels wins, then the nearest. (Build 210
 * also tried the map's corners; with the cluster's own label counted, a far corner "covered fewer
 * labels" than any spot beside the dot, so at 1280/1010/710/626 px the list opened detached in a
 * corner and the sheet never showed. The open cluster's own label is now hidden instead.)
 * When nothing is free (crowded or small map, long list) it returns `sheet`: the list is shown as a
 * bottom sheet over the screen instead of over the pins.
 */
export function calloutPlacement(
  open: LaidOut,
  laid: readonly LaidOut[],
  size: { w: number; h: number },
  boxes: { w: number; h: number } | readonly { w: number; h: number }[],
  extraDots: readonly { x: number; y: number; d: number }[] = [],
): CalloutPlace {
  for (const box of Array.isArray(boxes) ? boxes : [boxes]) {
    const p = placeBox(open, laid, size, box as { w: number; h: number }, extraDots);
    if (p) return p;
  }
  return { mode: 'sheet' };
}

function placeBox(
  open: LaidOut,
  laid: readonly LaidOut[],
  size: { w: number; h: number },
  box: { w: number; h: number },
  extraDots: readonly { x: number; y: number; d: number }[],
): CalloutPlace | null {
  const M = 4;
  if (box.w > size.w - 2 * M || box.h > size.h - 2 * M) return null;
  const x = open.fx * size.w, y = open.fy * size.h;
  const gap = DOT / 2 + 6;
  const dots = [...laid.map((g) => dotRect(g.fx * size.w, g.fy * size.h)), ...extraDots.map((e) => dotRect(e.x, e.y, e.d))];
  const labels = laid.filter((g) => g.label && g !== open).map((g) => ({ l: g.label!.l, t: g.label!.t, r: g.label!.l + g.label!.w, b: g.label!.t + LABEL_H }));
  // offsets along a side, nearest to centred first
  const slide = (from: number, to: number, mid: number) => {
    const out: number[] = [];
    for (let v = from; v <= to; v += 8) out.push(v);
    out.push(to);
    return out.sort((p, q) => Math.abs(p - mid) - Math.abs(q - mid));
  };
  const cands: { side: LabelPos; l: number; t: number }[] = [];
  const ls = slide(x - box.w + DOT / 2, x - DOT / 2, x - box.w / 2);
  const ts = slide(y - box.h + DOT / 2, y - DOT / 2, y - box.h / 2);
  ls.forEach((l) => cands.push({ side: 'below', l, t: y + gap }));
  ls.forEach((l) => cands.push({ side: 'above', l, t: y - gap - box.h }));
  ts.forEach((t) => cands.push({ side: 'right', l: x + gap, t }));
  ts.forEach((t) => cands.push({ side: 'left', l: x - gap - box.w, t }));
  let best: { side: LabelPos; l: number; t: number; labelsCovered: number } | null = null;
  for (const c of cands) {
    const r = { l: c.l, t: c.t, r: c.l + box.w, b: c.t + box.h };
    if (r.l < M || r.t < M || r.r > size.w - M || r.b > size.h - M) continue;
    if (dots.some((d) => hits(r, d))) continue;
    const labelsCovered = labels.filter((q) => hits(r, q)).length;
    if (!best || labelsCovered < best.labelsCovered) best = { ...c, labelsCovered };
    if (best.labelsCovered === 0) break;
  }
  if (!best) return null;
  return { mode: 'float', side: best.side, l: Math.round(best.l), t: Math.round(best.t), w: box.w, h: box.h, covered: 0, labelsCovered: best.labelsCovered };
}

const CALLOUT_W_MAX = 260;
const CALLOUT_W_MIN = 168;
/** The list shows about 4½ rows, then scrolls (fix re-test 209: 5+ places were cut off). */
export const CALLOUT_MAX_H = 230;
/** Estimated height of one list row; titles may wrap to two lines (Hindi names, fix re-test 209). */
export function calloutRowHeight(m: Pick<MapMarker, 'title' | 'subtitle'>, calloutW: number) {
  const textW = calloutW - 12 - 8 - 18; // padding, colour dot, gaps
  const titleLines = [...m.title].length * 7 > textW ? 2 : 1;
  return 10 + titleLines * 16 + (m.subtitle ? 15 : 0);
}
export const calloutHeight = (members: readonly MapMarker[], calloutW: number) =>
  Math.min(CALLOUT_MAX_H, 12 + members.reduce((a, m) => a + calloutRowHeight(m, calloutW), 0));


/** One place in a cluster's list (floating list or bottom sheet). Titles wrap to two lines. */
function CalloutRow({ m, onPress, clickable }: { m: MapMarker; onPress: () => void; clickable: boolean }) {
  return (
    <Pressable
      testID={`map-callout-${m.id}`}
      accessibilityRole={clickable ? 'button' : 'text'}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5, paddingHorizontal: 4 }}
    >
      <View style={[{ width: 10, height: 10, borderRadius: 5, backgroundColor: m.color ?? colors.primary, marginRight: 8 }, swatchRing(m.color ?? colors.primary, 1.5)]} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={2} style={{ fontSize: 12, lineHeight: 16, fontWeight: '800', color: colors.text }}>{m.title}</Text>
        {m.subtitle ? <Text numberOfLines={1} style={{ fontSize: 11, lineHeight: 15, color: colors.muted }}>{m.subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

/** The key-less map's ground colour (also the picker's placeholder before it paints). */
export const MAP_BG = colors.mapBg;

/** User input that ends a pending focus restore (fix re-test 213 #1). */
const USER_EVENTS = ['pointerdown', 'focusin', 'keydown', 'click'] as const;
/** The pending restore, if any: a new close replaces it. */
let cancelPendingRestore: (() => void) | null = null;

/**
 * Web: puts keyboard focus back on the cluster dot after its list closes (fix re-test 212 #1).
 * The dot is looked up fresh on every try (by any of its places' ids), because closing re-renders
 * it and can remount it or re-cluster it under another first id; an element captured before the
 * close may be detached. It retries for about half a second (RN Web's Modal hands focus back late
 * after the sheet unmounts) and re-focuses while focus is lost – nothing, the page body, a detached
 * node, the map itself or the closed list – but never takes it from something the user moved to.
 *
 * The user always wins (fix re-test 213 #1): any pointerdown, focusin, keydown or click after the
 * close (document level, capture phase) cancels the retries at once and removes the listeners, so a
 * quick click on a blank area leaves focus where the browser put it. Not counted as user input:
 * our own focus() call, focus landing on the dot itself or on "nowhere" (e.g. the map focusing
 * under the click that closed the popup), and – when the close came from a press
 * (`fromPress`) – the click that completes that same press. The closing event itself never cancels:
 * listeners added while it is being dispatched aren't called for it.
 */
export function restoreDotFocus(ids: readonly string[], mapEl?: Element | null, opts: { fromPress?: boolean } = {}) {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || !ids.length) return;
  cancelPendingRestore?.();
  type El = Element & { focus?: () => void };
  const find = (): El | null => {
    for (const id of ids) {
      const el = (document.querySelector?.(`[data-testid="marker-cluster-${id}"]`) ?? document.querySelector?.(`[data-testid="marker-${id}"]`)) as El | null;
      if (el) return el;
    }
    return null;
  };
  const lost = (a: Element | null | undefined) =>
    !a || a === document.body || (a as { isConnected?: boolean }).isConnected === false || a === mapEl || !!a.closest?.('[data-testid="map-sheet"], [data-testid="map-callout"], [data-testid="map-sheet-backdrop"]');
  let tries = 0;
  let held = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let focusing = false; // inside our own el.focus(): its focusin isn't the user
  let pressClick = !!opts.fromPress; // the click that ends the closing press is still to come
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    for (const type of USER_EVENTS) document.removeEventListener?.(type, onUser, true);
    if (cancelPendingRestore === stop) cancelPendingRestore = null;
  };
  const onUser = (ev: Event) => {
    // focus moving to the dot, or to "nowhere" (the map, the closed list…) as the closing press lands,
    // isn't the user choosing a target; a real new action also brings a pointerdown or keydown
    if (ev.type === 'focusin' && (focusing || (ev.target && ev.target === find()) || lost(ev.target as Element | null))) return;
    if (ev.type === 'click' && pressClick) {
      pressClick = false;
      return;
    }
    stop();
  };
  for (const type of USER_EVENTS) document.addEventListener?.(type, onUser, true);
  cancelPendingRestore = stop;
  const tick = () => {
    if (stopped) return;
    const el = find();
    const active = document.activeElement as Element | null | undefined;
    if (el && active === el) {
      if (++held >= 4) return stop(); // stayed put for a few frames: done
    } else if (lost(active) || (active as { dataset?: { testid?: string } } | null)?.dataset?.testid?.startsWith('marker-cluster-')) {
      held = 0;
      focusing = true;
      try {
        el?.focus?.();
      } finally {
        focusing = false;
      }
    } else return stop(); // the user moved focus somewhere on purpose
    if (++tries < 30) timer = setTimeout(tick, 16);
    else stop();
  };
  timer = setTimeout(tick, 0);
}

export default function PreviewMap({ center, radiusKm = 15, markers = [], selected, showsUser = false, userLocation, onMarkerPress, onMapPress, style }: AppMapProps) {
  /** "You are here" only with a real location and when the screen asks for it (fix re-test 211). */
  const user = showsUser && userLocation ? userLocation : null;
  const { t } = useTranslation();
  const ref = useRef<View>(null);
  const calloutRef = useRef<View>(null);
  const sheetRef = useRef<View>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [revealed, setRevealed] = useState<string | null>(null);
  /**
   * The open list's rendered height per width tried, so placement checks what is really drawn. All
   * widths are remembered (not just the last), so placement can't flip between two widths forever.
   */
  const [measured, setMeasured] = useState<{ key: string; byW: Record<number, number> } | null>(null);
  const span = spanFor(radiusKm);
  const pct = (p: GeoPoint) => {
    const { fx, fy } = toFraction(p, center, span);
    return { left: `${fx * 100}%` as const, top: `${fy * 100}%` as const };
  };
  const at = (fx: number, fy: number) => ({ left: `${fx * 100}%` as const, top: `${fy * 100}%` as const });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  };
  const onPress = (e: GestureResponderEvent) => {
    if (revealed) return closeList(true);
    if (!onMapPress || !size.w || !size.h) return;
    const off = tapOffset(e, ref.current);
    if (!off) return;
    const fx = Math.min(1, Math.max(0, off.x / size.w));
    const fy = Math.min(1, Math.max(0, off.y / size.h));
    onMapPress(fromFraction(fx, fy, center, span));
  };
  const laid = layoutLabels(markers, center, span, size, (n) => t('map.clusterLabel', { count: n }), user);
  const userFrac = user ? toFraction(user, center, span) : null;
  const userPx = userFrac && size.w ? { x: userFrac.fx * size.w, y: userFrac.fy * size.h } : null;
  const open = laid.find((g) => g.key === revealed) ?? null;

  /**
   * Closes the list. With focusDot (every close path but picking a row: Esc, ✕, backdrop, a tap
   * outside the popup) keyboard focus goes back to the cluster dot that opened it – see
   * restoreDotFocus.
   */
  const closeList = (focusDot = false, fromPress = false) => {
    const key = revealed;
    setRevealed(null);
    const g = key ? laid.find((x) => x.key === key) : undefined;
    if (focusDot && g) restoreDotFocus(g.members.map((m) => m.id), ref.current as unknown as Element | null, { fromPress });
  };
  const closeRef = useRef(closeList);
  closeRef.current = closeList;

  // Web: any tap outside the list (anywhere on the page) closes it; taps on dots are handled by
  // the dots themselves (another dot's tap switches to it). Esc closes it too (fix re-test 210 #1).
  useEffect(() => {
    if (!revealed || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      closeRef.current(true);
    };
    document.addEventListener('keydown', onKey, true);
    const onDown = (ev: Event) => {
      const target = ev.target as Element | null;
      for (const r of [calloutRef, sheetRef]) {
        const box = r.current as unknown as Element | null;
        if (box && target && box.contains?.(target)) return;
      }
      if (target?.closest?.('[data-testid^="marker-"]')) return;
      // Backdrop or anywhere outside: close and give focus back to the dot (fix re-test 212 #1).
      // Before, this closed without it – and the sheet was gone before the backdrop's own onPress.
      closeRef.current(true, true); // its click is still to come: not a new user action
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [revealed]);
  // The list goes away if its cluster does (zoom or filter change).
  useEffect(() => {
    if (revealed && !open) setRevealed(null);
  }, [revealed, open]);

  const pressDot = (g: LaidOut) => {
    if (needsReveal(g)) setRevealed(revealed === g.key ? null : g.key);
    else {
      setRevealed(null);
      onMarkerPress?.(g.members[0].id);
    }
  };
  const choose = (id: string) => {
    setRevealed(null);
    onMarkerPress?.(id);
  };
  const someClustered = laid.some(needsReveal);
  const calloutW = Math.min(CALLOUT_W_MAX, Math.max(CALLOUT_W_MIN, size.w - 16));
  const widths = [calloutW, 208, CALLOUT_W_MIN].filter((w, i, a) => w <= calloutW && a.indexOf(w) === i);
  const boxes = open
    ? widths.map((w) => ({ w, h: (measured?.key === open.key ? measured.byW[w] : undefined) ?? calloutHeight(open.members, w) }))
    : [];
  const place = open && size.w ? calloutPlacement(open, laid, size, boxes, userPx ? [{ ...userPx, d: USER_DOT }] : []) : null;
  const sheetOpen = !!open && place?.mode === 'sheet';
  // Web, bottom sheet (fix re-test 211 #4): keyboard focus moves into it (its first row), Tab and
  // Shift+Tab stay inside (rows and ✕), Esc closes it and focus returns to the dot (closeList).
  useEffect(() => {
    if (!sheetOpen || Platform.OS !== 'web' || typeof document === 'undefined') return;
    // rows first (the first one gets focus on open), then ✕ – not DOM order, where ✕ comes first
    const all = (sel: string) => Array.from(document.querySelectorAll?.(sel) ?? []) as unknown as { focus?: () => void }[];
    const focusables = () => {
      const rows = all('[data-testid="map-sheet"] [data-testid^="map-callout-"]');
      return rows.length ? [...rows, ...all('[data-testid="map-sheet-close"]')] : [];
    };
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // the Modal's portal mounts a commit later, so look again until the rows are there
    const focusFirst = () => {
      const list = focusables();
      if (list[0]) list[0].focus?.();
      else if (tries++ < 30) timer = setTimeout(focusFirst, 16);
    };
    timer = setTimeout(focusFirst, 0);
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      ev.preventDefault();
      const at = list.findIndex((el) => el === (document.activeElement as unknown));
      const next = at < 0 ? (ev.shiftKey ? list.length - 1 : 0) : (at + (ev.shiftKey ? -1 : 1) + list.length) % list.length;
      list[next].focus?.();
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [sheetOpen, revealed]);
  const rows = open ? open.members.map((m) => <CalloutRow key={m.id} m={m} clickable={!!onMarkerPress} onPress={() => choose(m.id)} />) : null;
  return (
    <Pressable
      ref={ref}
      testID="preview-map"
      onLayout={onLayout}
      onPress={onPress}
      // Never `disabled`: on web that marks the whole map aria-disabled, which disabled the dots and
      // the list inside it too. Without onMapPress a tap only closes the list.
      accessible={!!onMapPress}
      accessibilityLabel={onMapPress ? t('location.tapHint') : undefined}
      style={[{ flex: 1, backgroundColor: MAP_BG, overflow: 'hidden', minHeight: 200 }, style]}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
        {[20, 40, 60, 80].map((p) => (
          <View key={'h' + p} style={{ position: 'absolute', top: `${p}%`, left: 0, right: 0, height: 2, backgroundColor: colors.mapRoad }} />
        ))}
        {[25, 50, 75].map((p) => (
          <View key={'v' + p} style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, width: 3, backgroundColor: colors.mapRoadMajor }} />
        ))}
        {selected && (
          <View testID="preview-map-pin" style={{ position: 'absolute', ...pct(selected), width: 22, height: 22, marginLeft: -11, marginTop: -11, borderRadius: 11, backgroundColor: colors.primary, borderWidth: 3, borderColor: colors.ink }} />
        )}
      </View>
      {laid.map((g) => {
        const many = g.members.length > 1;
        const names = g.members.map((m) => (m.subtitle ? `${m.title}, ${m.subtitle}` : m.title)).join('; ');
        return (
          <Pressable
            key={g.key}
            onPress={() => pressDot(g)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={many ? t('map.clusterA11y', { count: g.members.length, names }) : names}
            accessibilityState={many ? { expanded: revealed === g.key } : undefined}
            testID={many ? `marker-cluster-${g.members[0].id}` : `marker-${g.members[0].id}`}
            style={{ position: 'absolute', ...at(g.fx, g.fy), width: DOT, height: DOT, marginLeft: -DOT / 2, marginTop: -DOT / 2, borderRadius: DOT / 2, backgroundColor: many ? colors.ink : (g.members[0].color ?? colors.primary), borderWidth: 3, borderColor: 'white', alignItems: 'center', justifyContent: 'center' }}
          >
            {many && <Text style={{ color: 'white', fontSize: 11, fontWeight: '900', lineHeight: 13 }}>{g.members.length}</Text>}
          </Pressable>
        );
      })}
      {/* "You are here", drawn above the place dots with a white ring and halo so it always shows. */}
      {user && (
        <View
          pointerEvents="none"
          testID="you-are-here"
          style={{ position: 'absolute', ...pct(user), width: USER_DOT + 8, height: USER_DOT + 8, marginLeft: -(USER_DOT + 8) / 2, marginTop: -(USER_DOT + 8) / 2, borderRadius: (USER_DOT + 8) / 2, backgroundColor: colors.userHalo, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: USER_DOT, height: USER_DOT, borderRadius: USER_DOT / 2, backgroundColor: colors.userDot, borderWidth: 3, borderColor: 'white' }} />
        </View>
      )}
      {/* Labels sit above every dot; they are decoration (the dot carries the accessibility label). */}
      {laid.map((g) =>
        g.label && g !== open ? (
          <View key={'l' + g.key} pointerEvents="none" style={{ position: 'absolute', left: g.label.l, top: g.label.t, width: g.label.w, height: LABEL_H, alignItems: g.label.pos === 'left' ? 'flex-end' : g.label.pos === 'right' ? 'flex-start' : 'center' }}>
            <Text numberOfLines={1} testID={`marker-label-${g.members[0].id}`} style={{ fontSize: 10, lineHeight: LABEL_H - 2, fontWeight: '800', backgroundColor: 'white', paddingHorizontal: 4, borderRadius: 4, maxWidth: g.label.w, color: '#1B1340' /* fixed: the label is always on white (V1422-4) */ }}>
              {g.text}
            </Text>
          </View>
        ) : null,
      )}
      {someClustered && !open && (
        <Text pointerEvents="none" testID="map-reveal-hint" style={{ position: 'absolute', top: 6, left: 8, fontSize: 10, fontWeight: '700', color: colors.text, backgroundColor: colors.card, paddingHorizontal: 4, borderRadius: 4 }}>
          {t('map.tapToReveal')}
        </Text>
      )}
      {open && place?.mode === 'float' && (
        <View
          ref={calloutRef}
          testID="map-callout"
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            const known = measured?.key === open.key ? measured.byW[place.w] : undefined;
            if (h > 0 && (known === undefined || Math.abs(known - h) > 1))
              setMeasured((m) => ({ key: open.key, byW: { ...(m?.key === open.key ? m.byW : {}), [place.w]: h } }));
          }}
          style={{ position: 'absolute', width: place.w, maxHeight: CALLOUT_MAX_H, left: place.l, top: place.t, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, elevation: 4, overflow: 'hidden' }}
        >
          <ScrollView testID="map-callout-scroll" style={{ maxHeight: CALLOUT_MAX_H - 2 }} contentContainerStyle={{ padding: 6 }}>
            {rows}
          </ScrollView>
        </View>
      )}
      {open && place?.mode === 'sheet' && (
        // No free spot beside the dot: a bottom sheet over the screen, so no pin is covered.
        <Modal visible transparent animationType="slide" onRequestClose={() => closeList(true)}>
          <Pressable testID="map-sheet-backdrop" onPress={() => closeList(true)} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.scrimLight }}>
            <Pressable
              ref={sheetRef}
              testID="map-sheet"
              onPress={() => {}}
              style={{ backgroundColor: colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 18, maxHeight: '60%', width: '100%', maxWidth: 640, alignSelf: 'center' }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ flex: 1, fontSize: 15, fontWeight: '900', color: colors.text }}>{open.text}</Text>
                <Pressable testID="map-sheet-close" accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={() => closeList(true)} hitSlop={8} style={{ padding: 6 }}>
                  <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>✕</Text>
                </Pressable>
              </View>
              <ScrollView>{rows}</ScrollView>
            </Pressable>
          </Pressable>
        </Modal>
      )}
      <Text pointerEvents="none" testID="map-preview-label" style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 10, fontWeight: '700', color: colors.text, backgroundColor: colors.card, paddingHorizontal: 4, borderRadius: 4 }}>{t('map.preview')}</Text>
    </Pressable>
  );
}
