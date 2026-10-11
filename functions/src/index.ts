// Firebase-direct mode only. With the API server these pushes are sent from server/src/domain
// (see server/README.md, "Push"), so these functions don't need to be deployed.
/**
 * VolleyLive Cloud Functions – push notifications.
 * Requires the Firebase Blaze (pay-as-you-go) plan to deploy.
 *
 * Pushes are sent through the Expo Push API (which delivers via FCM on
 * Android and APNs on iOS) using the Expo push token each device stores in
 * pushTokens/{uid}.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';

initializeApp();
const db = getFirestore();

async function tokenFor(uid: string): Promise<string | null> {
  const snap = await db.doc(`pushTokens/${uid}`).get();
  return (snap.get('token') as string | undefined) ?? null;
}

async function push(uids: string[], title: string, body: string, data: Record<string, string>) {
  const tokens = (await Promise.all([...new Set(uids)].map(tokenFor))).filter((t): t is string => !!t);
  if (!tokens.length) return;
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(tokens.map((to) => ({ to, title, body, data, sound: 'default', channelId: 'default' }))),
  });
  if (!res.ok) logger.warn('Expo push failed', res.status, await res.text());
}

/** New challenge -> notify the challenged captain. */
export const onChallengeCreated = onDocumentCreated('challenges/{id}', async (event) => {
  const c = event.data?.data();
  if (!c) return;
  await push([c.toCaptainId], '⚡ New challenge!', `${c.fromTeamName} challenged ${c.toTeamName}. Tap to accept or decline.`, {
    type: 'challenge',
    challengeId: event.params.id,
  });
});

/** Challenge answered -> notify the challenger. */
export const onChallengeUpdated = onDocumentUpdated('challenges/{id}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === after.status) return;
  if (after.status === 'accepted' || after.status === 'declined') {
    await push(
      [after.fromCaptainId],
      after.status === 'accepted' ? '✅ Challenge accepted' : 'Challenge declined',
      `${after.toTeamName} ${after.status} your challenge.`,
      { type: 'challenge', challengeId: event.params.id, matchId: String(after.matchId ?? '') },
    );
  }
});

/** New pending phone on a team -> notify that player if registered. */
export const onTeamInvite = onDocumentUpdated('teams/{id}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  const added: string[] = (after.pendingPhones ?? []).filter((p: string) => !(before.pendingPhones ?? []).includes(p));
  for (const phone of added) {
    const idx = await db.doc(`phoneIndex/${phone}`).get();
    const uid = idx.get('uid') as string | undefined;
    if (uid) await push([uid], '🏐 Team invite', `You've been invited to join ${after.name}.`, { type: 'teamInvite', teamId: event.params.id });
  }
});

/** Match created already live (quick start) -> notify players. */
export const onMatchCreatedLive = onDocumentCreated('matches/{id}', async (event) => {
  const m = event.data?.data();
  if (!m || m.status !== 'live') return;
  const uids = (m.participantIds as string[]).filter((u) => u !== m.scorerId);
  await push(uids, '🔴 Your match is live', `${m.teamA.name} vs ${m.teamB.name} – follow the score now.`, {
    type: 'match',
    matchId: event.params.id,
  });
});

/** Match goes live -> notify players in it (except the scorer). */
export const onMatchLive = onDocumentUpdated('matches/{id}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after || before.status === 'live' || after.status !== 'live') return;
  const uids = (after.participantIds as string[]).filter((u) => u !== after.scorerId);
  await push(uids, '🔴 Your match is live', `${after.teamA.name} vs ${after.teamB.name} – follow the score now.`, {
    type: 'match',
    matchId: event.params.id,
  });
});
