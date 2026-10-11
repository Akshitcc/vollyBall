/**
 * Loads the app's demo data (src/services/backend/demoSeed.ts) into MySQL.
 * Every row is written through the same domain functions as the API, acting as
 * the owning user, so the seed itself passes the ported security rules
 * (e.g. players join teams by invite + accept, the scorer writes the score).
 */
import { DEMO_QA_ADMIN, makeSeed } from '../../../src/services/backend/demoSeed';
import type { Services } from '../context';
import type { Identity } from '../auth/verifier';
import * as users from '../domain/users';
import * as teams from '../domain/teams';
import * as matches from '../domain/matches';
import * as tournaments from '../domain/tournaments';
import * as courts from '../domain/courts';

export async function seedDemo(s: Services, now = Date.now()) {
  const db = makeSeed(now);
  const as = (uid: string): Identity => ({ uid, phone: db.users[uid]?.phone ?? null });

  for (const u of Object.values(db.users)) {
    // 1.3.5 (QA E134-2): the app-only "Demo admin" seed never reaches the server (real admins: ADMIN_UIDS)
    if (u.id === DEMO_QA_ADMIN.id) continue;
    // 1.3.7 (R136 retest): seed accounts are complete (registration fields from the demo seed)
    await users.saveProfile(s, as(u.id), {
      id: u.id, name: u.name, phone: u.phone, photoURL: u.photoURL ?? null, position: u.position, city: u.city ?? null,
      firstName: u.firstName, lastName: u.lastName, dob: u.dob, email: u.email ?? null, pincode: u.pincode,
    });
  }
  for (const t of Object.values(db.teams)) {
    const cap = as(t.captainId);
    await teams.createTeam(s, cap, { name: t.name, color: t.color, captainId: t.captainId, memberIds: [t.captainId], subIds: [], pendingPhones: [], city: t.city }, t.id);
    for (const m of t.memberIds.filter((x) => x !== t.captainId)) {
      await teams.patchTeam(s, cap, t.id, { pendingPhones: [db.users[m].phone] });
      await teams.acceptInvite(s, as(m), t.id);
    }
    if (t.subIds.length) await teams.patchTeam(s, cap, t.id, { subIds: t.subIds });
  }
  for (const m of Object.values(db.matches)) {
    const { id, summary: _s, createdAt: _c, updatedAt: _u, ...doc } = m;
    await matches.createMatch(s, as(m.createdBy), { ...doc, interestedIds: doc.interestedIds ?? [], lineups: doc.lineups ?? null }, id);
    // Seed history: the auto-picked Player of the Match of old finished matches (outside the 24 h
    // confirm window, so written directly rather than through PUT /player-of-match).
    if (m.playerOfMatchId) await s.db('matches').where({ id }).update({ player_of_match_id: m.playerOfMatchId });
  }
  // Demo photos are built-in illustrations for demo mode only; the server seeds none (real uploads only).
  for (const t of Object.values(db.tournaments)) {
    const { id, createdAt: _c, ...doc } = t;
    await tournaments.createTournament(s, as(t.organizerId), doc, id);
  }
  for (const c of Object.values(db.courts)) {
    const { id, createdAt: _c, ...doc } = c;
    await courts.addCourt(s, as(c.addedBy), doc, id);
  }
  return {
    users: Object.keys(db.users).length,
    teams: Object.keys(db.teams).length,
    matches: Object.keys(db.matches).length,
    tournaments: Object.keys(db.tournaments).length,
    courts: Object.keys(db.courts).length,
  };
}
