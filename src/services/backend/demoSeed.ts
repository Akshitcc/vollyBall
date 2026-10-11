/** Sample data for demo mode (no Firebase needed). */
import { pickPlayerOfMatch } from '../../core/potm';
import { BEACH_RULES, INDOOR_RULES } from '../../core/rules';
import { MatchEvent, PointKind, Side, addPoint, computeState, summarize } from '../../core/scoring';
import { defaultLineup } from '../../core/rotation';
import { generateKnockout } from '../../core/tournament';
import type { Court, Match, MatchPlayer, Team, Tournament, UserProfile } from '../../core/types';

export interface DemoDB {
  users: Record<string, UserProfile>;
  teams: Record<string, Team>;
  matches: Record<string, Match>;
  photos: Record<string, import('../../core/types').MatchPhoto>;
  challenges: Record<string, import('../../core/types').Challenge>;
  tournaments: Record<string, Tournament>;
  courts: Record<string, Court>;
  /** T&C acceptances (1.3.0), by user id. */
  terms?: Record<string, import('../../core/terms').TermsAcceptance>;
}

const DAY = 86400000;
const HOME = { lat: 28.6139, lng: 77.209 }; // New Delhi

// Every player in the demo is a registered user (seed1..seed24), phones +919000000010..+919000000033.
const names = [
  'Aarav Sharma', 'Vihaan Gupta', 'Ishaan Verma', 'Kabir Singh', 'Arjun Mehta', 'Rohan Das',
  'Priya Nair', 'Ananya Iyer', 'Sneha Reddy', 'Meera Joshi', 'Kavya Rao', 'Diya Patel',
  'Aditya Kapoor', 'Siddharth Bose', 'Nikhil Jain', 'Rahul Yadav', 'Varun Malhotra', 'Karan Chopra',
  'Pooja Saxena', 'Neha Kulkarni', 'Riya Banerjee', 'Tanvi Shah', 'Isha Menon', 'Simran Kaur',
];
const positions = ['setter', 'outside', 'middle', 'opposite', 'libero', 'outside'] as const;

/**
 * Demo-mode photos: small built-in illustrations (SVG data URIs), so the demo needs no network and
 * no storage. Real modes store real uploads (MySQL server disk / Firebase Storage).
 */
export const DEMO_SCENES = [
  ['#FF6B00', '#111111', 'Spike!', 'स्पाइक!'],
  ['#1B7F3B', '#FFFFFF', 'Block', 'ब्लॉक'],
  ['#2B2B2B', '#FF6B00', 'Team huddle', 'टीम मीटिंग'],
  ['#D93636', '#FFFFFF', 'Ace', 'ऐस'],
  ['#6A1B9A', '#FFFFFF', 'Trophy', 'ट्रॉफ़ी'],
  ['#00695C', '#FFFFFF', 'Warm-up', 'वार्म-अप'],
] as const;
/**
 * QA B121-4: the caption is centred and kept inside the middle 480 px, so a square (cover) crop of the
 * 640×480 picture never cuts its first letters; Hindi captions when the app is in Hindi.
 * QA C130-6 (1.3.1): the caption sits on a dark scrim band (white text, ≥ 4.5:1 on every scene, see
 * contrast.test.ts) and starts lower, so tall Devanagari marks ("स्पाइक!") have room above them.
 */
export const DEMO_CAPTION = { scrim: '#000000', scrimOpacity: 0.62, fg: '#FFFFFF', bandY: 20, bandH: 96, baseline: 84 } as const;
export function demoPhotoUrl(i: number, lang: string = 'en'): string {
  const [bg, fg, en, hi] = DEMO_SCENES[i % DEMO_SCENES.length];
  const label = lang.startsWith('hi') ? hi : en;
  const C = DEMO_CAPTION;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480">` +
    `<rect width="640" height="480" fill="${bg}"/>` +
    `<rect x="40" y="300" width="560" height="140" fill="none" stroke="${fg}" stroke-width="6"/>` +
    `<line x1="320" y1="220" x2="320" y2="440" stroke="${fg}" stroke-width="6"/>` +
    `<line x1="120" y1="230" x2="520" y2="230" stroke="${fg}" stroke-width="4" stroke-dasharray="12 8"/>` +
    `<circle cx="${200 + (i % 3) * 120}" cy="${130 + (i % 2) * 30}" r="42" fill="#FFFFFF" stroke="#111111" stroke-width="5"/>` +
    `<path d="M${200 + (i % 3) * 120 - 42} ${130 + (i % 2) * 30} q42 -28 84 0 M${200 + (i % 3) * 120} ${88 + (i % 2) * 30} q-28 42 0 84" fill="none" stroke="#111111" stroke-width="4"/>` +
    `<rect x="0" y="${C.bandY}" width="640" height="${C.bandH}" fill="${C.scrim}" fill-opacity="${C.scrimOpacity}"/>` +
    `<text x="320" y="${C.baseline}" text-anchor="middle" textLength="${Math.min(400, label.length * 30)}" lengthAdjust="spacingAndGlyphs" font-family="sans-serif" font-size="44" font-weight="900" fill="${C.fg}">${label}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
/** Seed photo id -> its scene, so demo mode can re-draw the caption in the current language. */
export const SEED_PHOTO_SCENES: Record<string, number> = {};

function demoPhotos(now: number, list: [string, string, number][]): DemoDB['photos'] {
  const out: DemoDB['photos'] = {};
  list.forEach(([matchId, by, scene], i) => {
    const id = `ph_seed${i + 1}`;
    SEED_PHOTO_SCENES[id] = scene;
    out[id] = { id, matchId, url: demoPhotoUrl(scene), uploadedBy: by, createdAt: now - (i + 1) * 3600000 };
  });
  return out;
}

export function makeSeed(now = Date.now()): DemoDB {
  const users: Record<string, UserProfile> = {};
  names.forEach((name, i) => {
    const id = `seed${i + 1}`;
    users[id] = {
      id,
      name,
      phone: `+9190000000${String(i + 10).padStart(2, '0')}`,
      position: positions[i % 6],
      city: 'New Delhi',
      photoURL: null,
      createdAt: now - 30 * DAY,
    };
  });
  const ids = Object.keys(users);
  const teamA: Team = {
    id: 'team_smashers',
    name: 'Delhi Smashers',
    nameLower: 'delhi smashers',
    color: '#D93636',
    captainId: 'seed1',
    memberIds: ids.slice(0, 6),
    subIds: [],
    pendingPhones: [],
    city: 'New Delhi',
    createdAt: now - 20 * DAY,
  };
  const teamB: Team = {
    id: 'team_blockers',
    name: 'Yamuna Blockers',
    nameLower: 'yamuna blockers',
    color: '#001F4D',
    captainId: 'seed7',
    memberIds: ids.slice(6, 12),
    subIds: [],
    pendingPhones: [],
    city: 'New Delhi',
    createdAt: now - 18 * DAY,
  };
  const teamC: Team = {
    id: 'team_ninjas',
    name: 'Noida Ninjas',
    nameLower: 'noida ninjas',
    color: '#1B7F3B',
    captainId: 'seed13',
    memberIds: ids.slice(12, 18),
    subIds: [],
    pendingPhones: [],
    city: 'Noida',
    createdAt: now - 16 * DAY,
  };
  const teamD: Team = {
    id: 'team_giants',
    name: 'Gurgaon Giants',
    nameLower: 'gurgaon giants',
    color: '#6A1B9A',
    captainId: 'seed19',
    memberIds: ids.slice(18, 24),
    subIds: [],
    pendingPhones: [],
    city: 'Gurugram',
    createdAt: now - 15 * DAY,
  };
  const teams = { [teamA.id]: teamA, [teamB.id]: teamB, [teamC.id]: teamC, [teamD.id]: teamD };
  const toPlayers = (t: Team): MatchPlayer[] => t.memberIds.map((id) => ({ id, name: users[id].name, photoURL: null }));

  const kinds: PointKind[] = ['kill', 'kill', 'block', 'ace', 'tip'];
  const genEvents = (rules = INDOOR_RULES, pattern: number, count: number, pA: MatchPlayer[], pB: MatchPlayer[]) => {
    let ev: MatchEvent[] = [];
    let seed = pattern;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < count; i++) {
      const side: Side = rnd() < 0.53 ? 'A' : 'B';
      const roster = side === 'A' ? pA : pB;
      const attribute = rnd() < 0.7;
      ev = addPoint(rules, ev, side, {
        at: now - (count - i) * 25000,
        playerId: attribute ? roster[Math.floor(rnd() * roster.length)].id : undefined,
        kind: attribute ? kinds[Math.floor(rnd() * kinds.length)] : undefined,
      });
      if (computeState(rules, ev).finished) break;
    }
    return ev;
  };

  const pA = toPlayers(teamA);
  const pB = toPlayers(teamB);
  const mk = (id: string, rules: typeof INDOOR_RULES, events: MatchEvent[], extra: Partial<Match>): Match => {
    const st = computeState(rules, events, 'A');
    return {
      id,
      teamA: { teamId: teamA.id, name: teamA.name, color: teamA.color, players: pA },
      teamB: { teamId: teamB.id, name: teamB.name, color: teamB.color, players: pB },
      rules,
      firstServe: 'A',
      events,
      summary: summarize(st),
      status: st.finished ? 'finished' : 'live',
      createdBy: 'seed1',
      scorerId: 'seed1',
      participantIds: [...teamA.memberIds, ...teamB.memberIds],
      captains: { A: teamA.captainId, B: teamB.captainId },
      location: { ...HOME, lat: HOME.lat + 0.01, name: 'Talkatora Indoor Stadium' },
      createdAt: now - DAY,
      updatedAt: now - DAY,
      ...extra,
    };
  };
  const live = mk('match_live', INDOOR_RULES, genEvents(INDOOR_RULES, 7, 70, pA, pB), {
    status: 'live',
    startedAt: now - 3600000,
    startedServerAt: now - 3600000,
    updatedAt: now,
    title: 'Sunday league',
    // Explicit starting lineup for set 1 (later sets reuse it until the scorer changes it).
    lineups: { '1': { A: defaultLineup(pA.map((p) => p.id)), B: defaultLineup(pB.map((p) => p.id)) } },
  });
  const old1 = mk('match_old1', INDOOR_RULES, genEvents(INDOOR_RULES, 3, 400, pA, pB), {
    finishedAt: now - 3 * DAY,
    updatedAt: now - 3 * DAY,
    location: { lat: HOME.lat - 0.02, lng: HOME.lng + 0.03, name: 'Siri Fort Sports Complex' },
  });
  // A pick-up match: both sides built from registered players by number (not saved as teams).
  const pC = toPlayers(teamC);
  const pD = toPlayers(teamD);
  const beach = mk('match_beach', BEACH_RULES, genEvents(BEACH_RULES, 11, 300, pC, pD), {
    teamA: { teamId: null, name: 'Sand Kings', color: '#FF6B00', players: pC },
    teamB: { teamId: null, name: 'Wave Riders', color: '#001F4D', players: pD },
    // sides built by number: the creator named the captains (1.3.0)
    captains: { A: pC[0].id, B: pD[0].id },
    createdBy: 'seed13',
    scorerId: 'seed13',
    participantIds: [...teamC.memberIds, ...teamD.memberIds],
    finishedAt: now - 6 * DAY,
    updatedAt: now - 6 * DAY,
    location: { lat: 15.5527, lng: 73.7517, name: 'Calangute Beach, Goa' },
  });
  // Two more finished league matches, so the demo has ranked players (MIN_RANKED_MATCHES = 3).
  const old2 = mk('match_old2', { ...INDOOR_RULES, bestOf: 3 }, genEvents({ ...INDOOR_RULES, bestOf: 3 }, 5, 300, pA, pB), {
    finishedAt: now - 9 * DAY,
    updatedAt: now - 9 * DAY,
    location: { lat: HOME.lat + 0.02, lng: HOME.lng + 0.01, name: 'Thyagraj Stadium' },
  });
  const old3 = mk('match_old3', { ...INDOOR_RULES, bestOf: 3 }, genEvents({ ...INDOOR_RULES, bestOf: 3 }, 13, 300, pA, pB), {
    finishedAt: now - 13 * DAY,
    updatedAt: now - 13 * DAY,
    location: { lat: HOME.lat - 0.01, lng: HOME.lng - 0.02, name: 'Siri Fort Sports Complex' },
  });
  // 1.3.0 anti-fraud: a completed match that waits for the opposing captain (Team B's captain,
  // seed7), and one flagged as too short (8 minutes) until an admin reviews it.
  const awaiting = mk('match_await', INDOOR_RULES, genEvents(INDOOR_RULES, 17, 400, pA, pB), {
    finishedAt: now - DAY / 2,
    updatedAt: now - DAY / 2,
    location: { lat: HOME.lat + 0.015, lng: HOME.lng - 0.01, name: 'Talkatora Indoor Stadium' },
  });
  const flagged = mk('match_flagged', INDOOR_RULES, genEvents(INDOOR_RULES, 19, 400, pA, pB), {
    finishedAt: now - 2 * DAY,
    updatedAt: now - 2 * DAY,
    location: { lat: HOME.lat - 0.015, lng: HOME.lng + 0.02, name: 'Siri Fort Sports Complex' },
  });
  // Player of the Match: the automatic pick (core/potm.ts), as a scorer who accepted it would confirm.
  for (const m of [old1, old2, old3, beach, awaiting, flagged]) if (m.status === 'finished') m.playerOfMatchId = pickPlayerOfMatch(m);
  // Server times and the opposing captain's confirmation (src/core/antifraud.ts): the sample league
  // matches count; 'awaiting' is still pending; 'flagged' lasted 8 minutes (< MIN_MATCH_MINUTES).
  const finishedSample = (m: Match, minutes: number, confirmedBy: string | null) => {
    if (m.status !== 'finished' || m.finishedAt == null) return;
    m.finishedServerAt = m.finishedAt;
    m.startedAt = m.finishedAt - minutes * 60000;
    m.startedServerAt = m.startedAt;
    m.verification = confirmedBy ? { status: 'confirmed', by: confirmedBy, at: m.finishedAt + 3600000 } : { status: 'pending' };
  };
  finishedSample(old1, 75, teamB.captainId);
  finishedSample(old2, 60, teamB.captainId);
  finishedSample(old3, 62, teamB.captainId);
  finishedSample(beach, 40, pD[0].id);
  finishedSample(awaiting, 70, null);
  finishedSample(flagged, 8, null);

  const upcoming: Match = {
    ...mk('match_upcoming', INDOOR_RULES, [], { status: 'scheduled' }),
    status: 'scheduled',
    scheduledAt: now + 2 * DAY,
    location: { lat: HOME.lat + 0.03, lng: HOME.lng - 0.02, name: 'Rajouri Garden Community Court' },
  };

  const tournament: Tournament = {
    id: 'tour_monsoon',
    name: 'Monsoon Cup 2026',
    organizerId: 'seed1',
    format: 'knockout',
    rules: { ...INDOOR_RULES, bestOf: 3 },
    startDate: now + 5 * DAY,
    endDate: now + 7 * DAY,
    location: { lat: HOME.lat + 0.005, lng: HOME.lng + 0.01, name: 'Jawaharlal Nehru Stadium' },
    teams: [
      { id: teamA.id, name: teamA.name, color: teamA.color },
      { id: teamB.id, name: teamB.name, color: teamB.color },
      { id: teamC.id, name: teamC.name, color: teamC.color },
      { id: teamD.id, name: teamD.name, color: teamD.color },
    ],
    fixtures: generateKnockout([teamA.id, teamB.id, teamC.id, teamD.id]),
    status: 'running',
    createdAt: now - 2 * DAY,
  };

  const courts: Record<string, Court> = {
    c1: { id: 'c1', name: 'Lodhi Garden Sand Court', location: { lat: 28.5931, lng: 77.2197, name: 'Lodhi Garden' }, surface: 'beach', addedBy: 'seed2', createdAt: now },
    c2: { id: 'c2', name: 'DDA Sports Complex', location: { lat: 28.6448, lng: 77.1167, name: 'Paschim Vihar' }, surface: 'indoor', addedBy: 'seed3', createdAt: now },
    c3: { id: 'c3', name: 'Marine Drive Courts', location: { lat: 18.9432, lng: 72.8236, name: 'Mumbai' }, surface: 'outdoor', addedBy: 'seed4', createdAt: now },
  };

  return {
    users,
    teams,
    matches: { [live.id]: live, [old1.id]: old1, [old2.id]: old2, [old3.id]: old3, [beach.id]: beach, [awaiting.id]: awaiting, [flagged.id]: flagged, [upcoming.id]: upcoming },
    photos: demoPhotos(now, [
      [old1.id, 'seed1', 0],
      [old1.id, 'seed3', 1],
      [old1.id, 'seed8', 2],
      [old1.id, 'seed2', 3],
      [old1.id, 'seed10', 4],
      [live.id, 'seed1', 5],
      [live.id, 'seed9', 1],
      [beach.id, 'seed13', 2],
    ]),
    challenges: {},
    tournaments: { [tournament.id]: tournament },
    courts,
  };
}

/**
 * True for a blue team colour (hue 190–250°, clearly saturated). Older demo seeds gave Team B a
 * bright blue; the theme's Team B is now a dark navy (QA N121-7), which this deliberately skips.
 */
export function isLegacyBlue(hex: unknown): boolean {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  // Dark navies (max < 0.5, e.g. the 1.2.0 Team B default #001F4D) are theme colours, not the old bright blues.
  if (max < 0.5 || d / max < 0.35 || max !== b) return false;
  const hue = 60 * (4 + (r - g) / d);
  return hue >= 190 && hue <= 250;
}

/**
 * DEMO MODE ONLY: a demo database saved on this device by an older build keeps the old seed's blue
 * Team B. Puts the current seed colour back on the seeded teams, matches and tournaments that still
 * carry a blue; anything the user created or recoloured themselves is left alone. (Real API/Firebase
 * data is never rewritten.)
 */
export function refreshSeedColours(db: DemoDB, seed: DemoDB = makeSeed()): DemoDB {
  for (const [id, t] of Object.entries(seed.teams)) {
    const cur = db.teams?.[id];
    if (cur && isLegacyBlue(cur.color)) cur.color = t.color;
  }
  for (const [id, m] of Object.entries(seed.matches)) {
    const cur = db.matches?.[id];
    if (!cur) continue;
    if (isLegacyBlue(cur.teamA?.color)) cur.teamA.color = m.teamA.color;
    if (isLegacyBlue(cur.teamB?.color)) cur.teamB.color = m.teamB.color;
  }
  for (const [id, tour] of Object.entries(seed.tournaments)) {
    const cur = db.tournaments?.[id];
    if (!cur) continue;
    for (const team of cur.teams ?? []) {
      const fresh = tour.teams.find((x) => x.id === team.id);
      if (fresh && isLegacyBlue(team.color)) team.color = fresh.color;
    }
  }
  return db;
}
