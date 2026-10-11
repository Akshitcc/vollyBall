/**
 * Memories (home quick action): photos from all my matches, opening the shared viewer.
 * QA B121-9: "Add photo" here too: pick one of my finished matches, then pick the photo; it goes
 * through the same queue and checks (type, magic bytes, size, canAddMatchPhoto) as the match page.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { EmptyCard } from '../components/Hero';
import { UploadChip, useAddPhoto } from '../components/MatchCamera';
import { PhotoGrid, PhotoViewer } from '../components/PhotoGallery';
import { Button, Card, TeamDot } from '../components/ui';
import { canAddMatchPhoto } from '../core/photos';
import type { Match } from '../core/types';
import { backend } from '../services/backend';
import { useMe } from '../state/AuthContext';
import { useWatch } from '../state/hooks';
import { useMemories } from '../state/useMemories';
import { colors, font, type } from '../theme';

/** Finished matches the user may add a photo to, newest first (QA B121-9). */
export function photoTargets(matches: readonly Match[], uid: string): Match[] {
  return matches
    .filter((m) => m.status === 'finished' && canAddMatchPhoto(m, uid))
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
}

function AddToMatch({ match, uid, onDone }: { match: Match; uid: string; onDone: () => void }) {
  const { t } = useTranslation();
  const add = useAddPhoto(match.id, uid);
  return (
    <Card><View testID="memories-add-target">
      <Text style={[font.h3, { marginBottom: 8 }]} numberOfLines={2}>
        {t('memoriesScreen.addTo', { a: match.teamA.name, b: match.teamB.name })}
      </Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={t('match.addPhoto')} icon="images" onPress={add.gallery} style={{ flex: 1 }} testID="memories-choose-photo" />
        <Button title={t('common.cancel')} variant="ghost" onPress={onDone} testID="memories-add-cancel" />
      </View>
      <UploadChip matchId={match.id} tone="light" />
      {add.element}
      </View>
    </Card>
  );
}

export default function MemoriesScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const matches = useWatch<Match[]>((cb) => backend.watchMyMatches(me.id, cb), [me.id]) ?? [];
  const memories = useMemories(me.id, matches.map((m) => `${m.id}:${m.updatedAt}`).join(','));
  const [viewer, setViewer] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const targets = useMemo(() => photoTargets(matches, me.id), [matches, me.id]);
  const chosen = targets.find((m) => m.id === target) ?? null;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }} testID="memories-screen">
      <Text style={[type.body, { color: colors.muted, marginBottom: 12 }]}>{t('memoriesScreen.intro')}</Text>
      {chosen ? (
        <AddToMatch key={chosen.id} match={chosen} uid={me.id} onDone={() => setTarget(null)} />
      ) : picking ? (
        <Card><View testID="memories-pick-match">
          <Text style={[font.h3, { marginBottom: 6 }]}>{t('memoriesScreen.pickMatch')}</Text>
          {targets.length === 0 ? (
            <Text style={[type.body, { color: colors.muted }]} testID="memories-no-targets">{t('memoriesScreen.noTargets')}</Text>
          ) : (
            targets.slice(0, 20).map((m) => (
              <Pressable
                key={m.id}
                onPress={() => {
                  setTarget(m.id);
                  setPicking(false);
                }}
                accessibilityRole="button"
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderColor: colors.hairline }}
                testID={`memories-pick-${m.id}`}
              >
                <TeamDot color={m.teamA.color} size={12} style={{ marginRight: 4 }} />
                <TeamDot color={m.teamB.color} size={12} style={{ marginRight: 8 }} />
                <Text style={{ flex: 1, fontWeight: '700', color: colors.text }} numberOfLines={2}>
                  {m.teamA.name} – {m.teamB.name}
                  {m.finishedAt ? <Text style={{ color: colors.muted, fontWeight: '500' }}>{' · ' + new Date(m.finishedAt).toLocaleDateString()}</Text> : null}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Pressable>
            ))
          )}
          <Button title={t('common.cancel')} variant="ghost" onPress={() => setPicking(false)} testID="memories-pick-cancel" />
          </View>
        </Card>
      ) : (
        <Button title={t('memoriesScreen.addPhoto')} icon="add-circle" onPress={() => setPicking(true)} style={{ marginBottom: 12 }} testID="memories-add-photo" />
      )}
      {memories.length === 0 ? (
        <EmptyCard icon="images-outline" title={t('profile.noMemories')} text={t('profile.noMemoriesText')} />
      ) : (
        <PhotoGrid photos={memories} onOpen={setViewer} testID="memories" />
      )}
      <PhotoViewer photos={memories} index={viewer} onClose={() => setViewer(null)} nameOf={(uid) => (uid === me.id ? me.name : undefined)} />
    </ScrollView>
  );
}
