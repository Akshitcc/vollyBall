/**
 * REST API. Every route requires a verified Firebase ID token (or the injected
 * verifier in tests). Reads mirror `allow read: if signedIn()`; each write calls
 * the domain function that ports the matching firestore.rules / storage.rules clause.
 */
import express, { Router } from 'express';
import type { Services } from '../context';
import { me } from '../auth/middleware';
import { badRequest, forbidden, HttpError, notFound } from '../errors';
import { checkText } from '../../../src/core/validate';
import * as users from '../domain/users';
import * as teams from '../domain/teams';
import * as matches from '../domain/matches';
import * as photos from '../domain/photos';
import * as challenges from '../domain/challenges';
import * as tournaments from '../domain/tournaments';
import * as courts from '../domain/courts';
import * as rankings from '../domain/rankings';
import * as terms from '../domain/terms';
import * as feedback from '../domain/feedback';
import { isAdmin } from '../context';
import { RATE_LIMITED, RateLimiter } from '../rateLimit';
import crypto from 'node:crypto';
/** 1.3.7 (R136-6): pincode lookups – a person types a few pins; an IP may front several users (NAT). */
/** 1.3.7: feedback (5 per user at once, refilling 1 per 12 min) and admin daily-item writes. */
export const FEEDBACK_RATE = { burst: 5, perMinute: 1 / 12 };
export const DAILY_ADMIN_RATE = { burst: 30, perMinute: 30 };
/** Public GET /api/daily-items, per IP (it is cached by the app; one call per launch is normal). */
export const DAILY_PUBLIC_RATE = { burst: 30, perMinute: 30 };
/** Lookup turned off: format + allocated prefix only (R136-16). */
const demoLikeFormatOnly = (pin: string) =>
  !PINCODE_RE.test(pin) || (!pincodePrefixOk(pin) && !isApsPincode(pin)) ? { status: 'invalid' as const } : { status: 'unknown' as const };
export const PINCODE_RATE = Object.freeze({ user: { burst: 10, perMinute: 6 }, ip: { burst: 40, perMinute: 30 } });
import { TERMS_VERSION } from '../../../src/core/terms';
import { isApsPincode, pincodePrefixOk, PINCODE_RE } from '../../../src/core/registration';
import {
  challengePatchSchema,
  courtPatchSchema,
  matchPatchSchema,
  newChallengeSchema,
  newCourtSchema,
  newMatchSchema,
  newTeamSchema,
  newTournamentSchema,
  parse,
  phoneE164,
  potmSchema,
  profileSchema,
  rejectSchema,
  reviewSchema,
  termsAcceptSchema,
  progressSchema,
  pushTokenSchema,
  teamPatchSchema,
  tournamentPatchSchema,
} from '../domain/schemas';
import { MAX_IMAGE_BYTES } from '../storage/photoStorage';
import { csv, h } from './handler';

const LIVE_STATUSES = ['live', 'scheduled'];

/**
 * 1.3.0: fields only the server writes (points/bonus/wallet are derived and never stored; verification,
 * server times and T&C acceptance have their own actions). A client sending one gets 400 instead of a
 * silent strip, so a forged write is visible (QA AF-46, AF-51, WL-03, TC-08).
 */
const SERVER_ONLY_FIELDS = ['verification', 'startedServerAt', 'finishedServerAt', 'points', 'bonus', 'winBonus', 'wallet', 'balance', 'rankingPoints', 'termsVersion', 'termsAcceptedAt', 'flags', 'isAdmin', 'role'];
function rejectServerFields(body: unknown) {
  if (!body || typeof body !== 'object') return;
  const bad = SERVER_ONLY_FIELDS.filter((k) => k in (body as object));
  if (bad.length) throw new HttpError(400, 'server_field', `These fields are set by the server only: ${bad.join(', ')}`);
}

export function apiRouter(s: Services): Router {
  // QA C130-2: per-user rate limits (in memory) on accept T&C, confirm/reject and every match write.
  const limiter = (s.rateLimiter ??= new RateLimiter());
  const lim = { terms: limiter.middleware('terms'), verify: limiter.middleware('verify'), match: limiter.middleware('matchWrite') };
  const r = Router();
  const raw = express.raw({ type: () => true, limit: MAX_IMAGE_BYTES + 1024 });
  // 1.3.0: every write needs the current T&C accepted (reads stay open so the app can show the gate).
  r.use(terms.requireTerms(s));

  // ---------- me / users ----------
  r.get('/me', h(async (req, res) => {
    const id = me(req);
    await users.ensureSignupRow(s, id); // 1.3.4: a sign-up shows in `users` from the first /me
    const t = await terms.getTerms(s.db, id.uid);
    res.json({
      uid: id.uid,
      phone: id.phone,
      profile: await users.getProfile(s, id, id.uid),
      terms: t,
      currentTermsVersion: TERMS_VERSION,
      termsAccepted: t?.version === TERMS_VERSION,
      isAdmin: isAdmin(s, id.uid),
    });
  }));
  r.post('/me/terms/accept', lim.terms, h(async (req, res) => {
    const b = parse(termsAcceptSchema, req.body);
    res.json(await terms.acceptTerms(s, me(req), b.version));
  }));
  // Points wallet: balance only, derived from counted matches. No redeem/withdraw/transfer routes exist.
  r.get('/me/wallet', h(async (req, res) => {
    const viewer = me(req);
    res.json(await rankings.getWallet(s, viewer.uid, async () => {
      const ids = await matches.listMatchIds(s.db, { participant: viewer.uid, status: ['finished'], limit: 100 });
      return matches.loadMatches(s, s.db, ids, viewer);
    }));
  }));
  r.put('/me/push-tokens', h(async (req, res) => {
    const b = parse(pushTokenSchema, req.body);
    await users.savePushToken(s, me(req), b.token, b.platform);
    res.status(204).end();
  }));
  r.delete('/me/push-tokens/:token', h(async (req, res) => {
    await users.deletePushToken(s, me(req), req.params.token);
    res.status(204).end();
  }));
  r.get('/users', h(async (req, res) => {
    const ids = csv(req.query.ids);
    if (!ids.length) throw badRequest('ids is required'); // no listing of all users
    res.json(await users.getProfiles(s, me(req), ids));
  }));
  r.get('/users/by-phone/:phone', h(async (req, res) => {
    const phone = parse(phoneE164, req.params.phone);
    const p = await users.findByPhone(s, me(req), phone);
    if (!p) throw notFound('No user with that number');
    res.json(p);
  }));
  // 1.3.6: pincode → district/state for the registration form ({ status: ok | invalid | unknown }).
  // 1.3.7 (R136-6): signed-in only (requireAuth on /api; allowed before T&C, the form comes first) and
  // rate limited per user and per IP, so it can't be used to hammer India Post through this server.
  r.get('/pincode/:pin', h(async (req, res) => {
    const ipKey = crypto.createHash('sha256').update(String(req.ip ?? '')).digest('hex').slice(0, 32);
    const wait = Math.max(
      await limiter.takeShared(me(req).uid, 'pincodeUser', PINCODE_RATE.user),
      await limiter.takeShared(ipKey, 'pincodeIp', PINCODE_RATE.ip),
    );
    if (wait) {
      res.setHeader('Retry-After', String(wait));
      throw new HttpError(429, RATE_LIMITED, 'Too many requests. Wait a moment and try again.', { retryAfter: wait });
    }
    const pin = String(req.params.pin);
    res.json(s.pincode ? await s.pincode.lookup(pin) : demoLikeFormatOnly(pin));
  }));
  r.get('/users/:id', h(async (req, res) => {
    const p = await users.getProfile(s, me(req), req.params.id);
    if (!p) throw notFound('Profile not found');
    res.json(p);
  }));
  r.put('/users/:id', h(async (req, res) => {
    rejectServerFields(req.body);
    const p = parse(profileSchema, { ...req.body, id: req.params.id });
    res.json(await users.saveProfile(s, me(req), p));
  }));
  r.delete('/users/:id', h(async () => {
    throw forbidden('users.delete', 'Profiles cannot be deleted from the app');
  }));
  r.post('/users/:id/avatar', raw, h(async (req, res) => {
    res.status(201).json({ url: await photos.uploadAvatar(s, me(req), req.params.id, req.header('content-type'), req.body as Buffer) });
  }));

  // ---------- teams ----------
  r.get('/teams', h(async (req, res) => {
    const viewer = me(req);
    let list;
    if (typeof req.query.member === 'string') list = await teams.teamsForMember(s.db, req.query.member);
    else if (typeof req.query.invitedPhone === 'string') {
      parse(phoneE164, req.query.invitedPhone); // 400 invalid_phone for a malformed number
      // tightened: you can only list invites for your own verified number
      if (req.query.invitedPhone !== viewer.phone) throw forbidden('teams.read.invites', 'You can only see invites for your own number');
      list = await teams.teamsInvitingPhone(s.db, req.query.invitedPhone);
    } else {
      // Same 40-character cap as the search box (LIMITS.teamSearch; 400 text_too_long beyond it).
      const q = checkText('q', typeof req.query.q === 'string' ? req.query.q : '', 'teamSearch') ?? '';
      list = await teams.searchTeams(s.db, q);
    }
    res.json(list.map((t) => teams.viewTeam(t, viewer)));
  }));
  r.post('/teams', h(async (req, res) => {
    const t = parse(newTeamSchema, req.body);
    res.status(201).json({ id: await teams.createTeam(s, me(req), t) });
  }));
  r.get('/teams/:id', h(async (req, res) => {
    const [t] = await teams.loadTeams(s.db, [req.params.id]);
    if (!t) throw notFound('Team not found');
    res.json(teams.viewTeam(t, me(req)));
  }));
  r.patch('/teams/:id', h(async (req, res) => {
    const viewer = me(req);
    const patch = parse(teamPatchSchema, req.body);
    // A non-captain only sees their own pending number; merge the hidden ones back before diffing.
    const { team } = await teams.changeTeam(s, viewer, req.params.id, (t) => {
      const doc = { name: t.name, color: t.color, captainId: t.captainId, memberIds: t.memberIds, subIds: t.subIds, pendingPhones: t.pendingPhones, city: t.city };
      if (patch.pendingPhones && t.captainId !== viewer.uid) {
        const hidden = t.pendingPhones.filter((p) => p !== viewer.phone);
        return { ...doc, ...patch, pendingPhones: [...hidden, ...patch.pendingPhones.filter((p) => !hidden.includes(p))] };
      }
      return { ...doc, ...patch };
    });
    res.json(teams.viewTeam(team, viewer));
  }));
  r.post('/teams/:id/accept', h(async (req, res) => res.json(teams.viewTeam((await teams.acceptInvite(s, me(req), req.params.id)).team, me(req)))));
  r.post('/teams/:id/decline', h(async (req, res) => res.json(teams.viewTeam((await teams.declineInvite(s, me(req), req.params.id)).team, me(req)))));
  r.post('/teams/:id/leave', h(async (req, res) => res.json(teams.viewTeam((await teams.leaveTeam(s, me(req), req.params.id)).team, me(req)))));
  r.delete('/teams/:id', h(async (req, res) => {
    await teams.deleteTeam(s, me(req), req.params.id);
    res.status(204).end();
  }));

  // ---------- matches ----------
  r.get('/matches', h(async (req, res) => {
    const viewer = me(req);
    const q = req.query;
    let ids: string[];
    if (typeof q.participant === 'string') ids = await matches.listMatchIds(s.db, { participant: q.participant, limit: 200 });
    else if (typeof q.tournament === 'string') ids = await matches.listMatchIds(s.db, { tournament: q.tournament, limit: 500 });
    else if (q.public === '1') ids = await matches.listMatchIds(s.db, { status: LIVE_STATUSES, withLocation: true, limit: 200 });
    else {
      const status = csv(q.status).filter((x) => ['scheduled', 'live', 'finished', 'abandoned'].includes(x));
      ids = await matches.listMatchIds(s.db, { status: status.length ? status : LIVE_STATUSES, limit: 50 });
    }
    res.json(await matches.loadMatches(s, s.db, ids, viewer));
  }));
  r.post('/matches', lim.match, h(async (req, res) => {
    rejectServerFields(req.body);
    if (req.body && typeof req.body === 'object' && 'playerOfMatchId' in req.body && req.body.playerOfMatchId != null)
      throw new HttpError(400, 'potm_use_endpoint', 'Set the Player of the Match with PUT /matches/:id/player-of-match');
    const m = parse(newMatchSchema, req.body);
    res.status(201).json({ id: await matches.createMatch(s, me(req), m) });
  }));
  r.get('/matches/:id', h(async (req, res) => {
    const m = await matches.getMatch(s, req.params.id, me(req));
    if (!m) throw notFound('Match not found');
    res.json(m);
  }));
  r.patch('/matches/:id', lim.match, h(async (req, res) => {
    // INFO (retest 1.1.0): the Player of the Match has its own endpoint; don't silently drop it.
    if (req.body && typeof req.body === 'object' && 'playerOfMatchId' in req.body)
      throw new HttpError(400, 'potm_use_endpoint', 'Set the Player of the Match with PUT /matches/:id/player-of-match');
    rejectServerFields(req.body);
    // INFO (retest 1.2.1) / QA N121-3: start and finish times are server time only; a PATCH carrying
    // one is refused (400) instead of being silently ignored, like playerOfMatchId.
    if (req.body && typeof req.body === 'object' && ('startedAt' in req.body || 'finishedAt' in req.body))
      throw new HttpError(400, 'server_time', 'Start and finish times are set by the server');
    const patch = parse(matchPatchSchema, req.body);
    res.json((await matches.patchMatch(s, me(req), req.params.id, patch)).match);
  }));
  r.put('/matches/:id/progress', lim.match, h(async (req, res) => {
    const p = parse(progressSchema, req.body);
    res.json(await matches.saveProgress(s, me(req), req.params.id, p));
  }));
  r.put('/matches/:id/player-of-match', lim.match, h(async (req, res) => {
    const b = parse(potmSchema, req.body);
    res.json(await matches.setPlayerOfMatch(s, me(req), req.params.id, b.playerId));
  }));
  // 1.3.0: the opposing captain confirms or rejects a completed match's result.
  r.post('/matches/:id/confirm', lim.verify, h(async (req, res) => {
    res.json(await matches.verifyResult(s, me(req), req.params.id, 'confirmed'));
  }));
  r.post('/matches/:id/reject', lim.verify, h(async (req, res) => {
    const b = parse(rejectSchema, req.body ?? {});
    res.json(await matches.verifyResult(s, me(req), req.params.id, 'disputed', b.reason));
  }));
  // 1.3.7: Profile > Send feedback (signed in, T&C accepted, rate limited; never rewarded) + admin view.
  const limited = async (key: string, bucket: string, rule: { burst: number; perMinute: number }) => {
    const wait = await limiter.takeShared(key, bucket, rule);
    if (wait) throw new HttpError(429, RATE_LIMITED, 'Too many requests. Wait a moment and try again.', { retryAfter: wait });
  };
  r.post('/feedback', h(async (req, res) => {
    await limited(me(req).uid, 'feedback', FEEDBACK_RATE);
    res.status(201).json(await feedback.sendFeedback(s, me(req), req.body ?? {}));
  }));
  r.get('/admin/feedback', h(async (req, res) => res.json(await feedback.listFeedback(s, me(req)))));
  // 1.3.7: "Fact of the day" admin CRUD (server-side ADMIN_UIDS check in the domain); public read is in app.ts.
  r.get('/admin/daily-items', h(async (req, res) => {
    if (!isAdmin(s, me(req).uid)) throw forbidden('admin_only', 'Admins only');
    res.json(await feedback.listDailyItems(s, me(req).uid));
  }));
  r.post('/admin/daily-items', h(async (req, res) => {
    await limited(me(req).uid, 'dailyAdmin', DAILY_ADMIN_RATE);
    res.status(201).json(await feedback.createDailyItem(s, me(req), req.body ?? {}));
  }));
  r.patch('/admin/daily-items/:id', h(async (req, res) => {
    await limited(me(req).uid, 'dailyAdmin', DAILY_ADMIN_RATE);
    res.json(await feedback.updateDailyItem(s, me(req), req.params.id, req.body ?? {}));
  }));
  r.delete('/admin/daily-items/:id', h(async (req, res) => {
    await limited(me(req).uid, 'dailyAdmin', DAILY_ADMIN_RATE);
    await feedback.deleteDailyItem(s, me(req), req.params.id);
    res.status(204).end();
  }));
  // Admin review (ADMIN_UIDS allow-list).
  r.get('/admin/matches/flagged', h(async (req, res) => res.json(await matches.listFlagged(s, me(req)))));
  r.post('/admin/matches/:id/review', h(async (req, res) => {
    const b = parse(reviewSchema, req.body);
    res.json(await matches.reviewMatch(s, me(req), req.params.id, b.decision));
  }));
  r.delete('/matches/:id', lim.match, h(async (req, res) => {
    await matches.deleteMatch(s, me(req), req.params.id);
    res.status(204).end();
  }));

  // ---------- photos ----------
  r.get('/matches/:id/photos', h(async (req, res) => res.json(await photos.listPhotos(s, req.params.id))));
  r.post('/matches/:id/photos', lim.match, raw, h(async (req, res) => {
    res.status(201).json(await photos.uploadPhoto(s, me(req), req.params.id, req.header('content-type'), req.body as Buffer, req.header('idempotency-key') ?? undefined));
  }));
  r.delete('/matches/:id/photos/:photoId', lim.match, h(async (req, res) => {
    await photos.deletePhoto(s, me(req), req.params.id, req.params.photoId);
    res.status(204).end();
  }));

  r.get('/users/:id/photos', h(async (req, res) => {
    me(req);
    res.json(await photos.listMemories(s, req.params.id));
  }));

  // ---------- rankings ----------
  r.get('/rankings', h(async (req, res) => {
    const viewer = me(req);
    const limit = Number(req.query.limit ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > rankings.RANKINGS_MAX_LIMIT) throw badRequest(`limit must be 1-${rankings.RANKINGS_MAX_LIMIT}`);
    res.json(await rankings.getRankings(s, viewer.uid, limit));
  }));

  // ---------- challenges ----------
  r.get('/challenges', h(async (req, res) => res.json(await challenges.challengesForTeams(s.db, csv(req.query.teams, 30)))));
  r.post('/challenges', h(async (req, res) => {
    const c = parse(newChallengeSchema, req.body);
    res.status(201).json({ id: await challenges.createChallenge(s, me(req), c) });
  }));
  r.patch('/challenges/:id', h(async (req, res) => {
    const p = parse(challengePatchSchema, req.body);
    res.json(await challenges.respondChallenge(s, me(req), req.params.id, p));
  }));
  r.delete('/challenges/:id', h(async () => {
    throw forbidden('challenges.delete', 'Challenges cannot be deleted');
  }));

  // ---------- tournaments ----------
  r.get('/tournaments', h(async (_req, res) => res.json(await tournaments.loadTournaments(s.db, await tournaments.listTournamentIds(s.db)))));
  r.post('/tournaments', h(async (req, res) => {
    const t = parse(newTournamentSchema, req.body);
    res.status(201).json({ id: await tournaments.createTournament(s, me(req), t) });
  }));
  r.get('/tournaments/:id', h(async (req, res) => {
    const [t] = await tournaments.loadTournaments(s.db, [req.params.id]);
    if (!t) throw notFound('Tournament not found');
    res.json(t);
  }));
  r.patch('/tournaments/:id', h(async (req, res) => {
    const p = parse(tournamentPatchSchema, req.body);
    res.json(await tournaments.patchTournament(s, me(req), req.params.id, p));
  }));
  r.delete('/tournaments/:id', h(async (req, res) => {
    await tournaments.deleteTournament(s, me(req), req.params.id);
    res.status(204).end();
  }));

  // ---------- courts ----------
  r.get('/courts', h(async (_req, res) => res.json(await courts.listCourts(s))));
  r.post('/courts', h(async (req, res) => {
    const c = parse(newCourtSchema, req.body);
    res.status(201).json({ id: await courts.addCourt(s, me(req), c) });
  }));
  r.patch('/courts/:id', h(async (req, res) => res.json(await courts.patchCourt(s, me(req), req.params.id, parse(courtPatchSchema, req.body)))));
  r.delete('/courts/:id', h(async (req, res) => {
    await courts.deleteCourt(s, me(req), req.params.id);
    res.status(204).end();
  }));

  return r;
}
