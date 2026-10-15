/**
 * Live match v2 photo sheet (design-spec §11.5): the header photo button opens a bottom sheet with
 * two 128 dp tiles – Camera (phones only; PRD PHOTO-01) and Gallery (multi-select, up to
 * MAX_GALLERY_PICK) – a "Match photos (n)" strip and Cancel. Every photo goes through the same
 * checks and queue as before (useAddPhoto). Scoring stays live underneath; closing never loses a point.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Modal } from './AppModal'; // 1.4.0 (V139-7): holds the review prompt while open
import type { MatchPhoto } from '../core/types';
import { hasCameraButton } from '../services/camera';
import { backend } from '../services/backend';
import { haptic } from '../services/haptics';
import { useWatch } from '../state/hooks';
import { colors, currentTheme, elevation, themed, tokens } from '../theme';
const T = () => tokens[currentTheme()];
const DAY = () => currentTheme() === 'day';
import { UploadChip, useAddPhoto } from './MatchCamera';
import { useInsets } from './SafeFooter';
import { Button } from './ui';

/** Camera + Gallery buttons for match pages, the finished-match Photos tab and Memories. */
export function AddPhotoButtons({ matchId, uid, testIDPrefix = 'add-photo', galleryTestID, photoCount }: { matchId: string; uid: string; testIDPrefix?: string; galleryTestID?: string; /** 1.3.4: shows "n of 50 photos · m left" */ photoCount?: number }) {
  const { t } = useTranslation();
  const add = useAddPhoto(matchId, uid, photoCount);
  return (
    <View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title={t('camera.useGallery')} icon="images" onPress={add.gallery} style={{ flex: 1 }} testID={galleryTestID ?? `${testIDPrefix}-gallery`} />
        {hasCameraButton() && <Button title={t('match.camera')} icon="camera" variant="dark" onPress={add.camera} style={{ flex: 1 }} testID={`${testIDPrefix}-camera`} />}
      </View>
      <UploadChip matchId={matchId} tone="light" />
      {add.element}
    </View>
  );
}

export function PhotoSheet({ matchId, uid, visible, onClose, onOpenPhotos }: { matchId: string; uid: string; visible: boolean; onClose: () => void; onOpenPhotos?: () => void }) {
  const { t } = useTranslation();
  const insets = useInsets();
  const watched = useWatch<MatchPhoto[]>(visible ? (cb) => backend.watchPhotos(matchId, cb) : null, [matchId, visible]);
  const photos = watched ?? [];
  // 1.3.4 D133-2: remaining slots under the tiles once the photo list has loaded
  const add = useAddPhoto(matchId, uid, watched ? watched.length : undefined);
  const tile = (kind: 'camera' | 'gallery') => (
    <Pressable
      key={kind}
      onPress={() => {
        haptic('select');
        void (kind === 'camera' ? add.camera() : add.gallery());
      }}
      accessibilityRole="button"
      style={({ pressed }) => [s.tile, kind === 'camera' && s.tileCamera, pressed && { opacity: 0.85 }]}
      testID={`photo-sheet-${kind}`}
    >
      <View style={[s.icon, kind === 'camera' ? { backgroundColor: colors.primary } : { backgroundColor: colors.tint }]}>
        <Ionicons name={kind === 'camera' ? 'camera' : 'images'} size={30} color={colors.text} />
      </View>
      <Text style={s.tileTitle}>{kind === 'camera' ? t('match.camera') : t('liveV2.gallery')}</Text>
      <Text style={s.tileSub} numberOfLines={2}>
        {kind === 'camera' ? t('liveV2.cameraSub') : t('liveV2.gallerySub')}
      </Text>
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} accessibilityLabel={t('common.close')} />
      <View style={[s.sheet, { paddingBottom: 16 + Math.max(16, insets.bottom) }]} testID="photo-sheet" accessibilityViewIsModal>
        <View style={s.grab} />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={s.title} accessibilityRole="header">
            {t('match.addPhoto')}
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.close')} style={s.close} testID="photo-sheet-close">
            <Ionicons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <Text style={s.note}>{t('liveV2.photoSheetNote')}</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>{[...(hasCameraButton() ? (['camera'] as const) : []), 'gallery' as const].map(tile)}</View>
        <UploadChip matchId={matchId} tone="light" />
        {add.element}
        {photos.length > 0 && (
          <>
            <Pressable onPress={onOpenPhotos} accessibilityRole="button" style={s.stripHead} testID="photo-sheet-all">
              <Text style={s.stripTitle}>{`${t('photos.matchPhotos')} (${photos.length})`}</Text>
              <Ionicons name="chevron-forward" size={18} color={colors.text} />
            </Pressable>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {photos.slice(0, 10).map((p) => (
                <Image key={p.id} source={{ uri: p.url }} style={s.thumb} contentFit="cover" accessibilityIgnoresInvertColors />
              ))}
            </ScrollView>
          </>
        )}
        <Button title={t('common.cancel')} variant="secondary" onPress={onClose} style={{ marginTop: 16 }} testID="photo-sheet-cancel" />
      </View>
    </Modal>
  );
}

/** 48×48 glass photo button in the navy header with the match-photo count badge (§11.1). */
export function PhotoHeaderButton({ matchId, uid, onOpenPhotos }: { matchId: string; uid: string; onOpenPhotos?: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const photos = useWatch<MatchPhoto[]>((cb) => backend.watchPhotos(matchId, cb), [matchId]) ?? [];
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('liveV2.photoButton', { count: photos.length })}
        style={({ pressed }) => [s.headerBtn, pressed && { opacity: 0.8 }]}
        testID="photo-button"
      >
        <Ionicons name="camera" size={22} color={T().text} />
        {photos.length > 0 && (
          <View style={s.badge}>
            <Text style={s.badgeText}>{photos.length > 99 ? '99+' : photos.length}</Text>
          </View>
        )}
      </Pressable>
      <PhotoSheet matchId={matchId} uid={uid} visible={open} onClose={() => setOpen(false)} onOpenPhotos={onOpenPhotos ? () => { setOpen(false); onOpenPhotos(); } : undefined} />
    </>
  );
}

const s = themed(() => StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: colors.scrim /* 1.4.21: per-theme sheet scrim (spec v2) */ },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10, ...elevation.e3 },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 10 },
  title: { flex: 1, color: colors.text, fontWeight: '800', fontSize: 20 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: -12 },
  note: { color: colors.muted, fontWeight: '600' },
  tile: { flex: 1, minHeight: 128, borderRadius: 18, borderWidth: 1.5, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center', padding: 12 },
  tileCamera: { backgroundColor: colors.tint, borderColor: colors.primary },
  icon: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  tileTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  tileSub: { color: colors.muted, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 2 },
  stripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginTop: 8 },
  stripTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  thumb: { width: 64, height: 64, borderRadius: 12, backgroundColor: colors.bg },
  headerBtn: { width: 48, height: 48, borderRadius: DAY() ? 24 : 16, backgroundColor: T().surface, borderWidth: DAY() ? 2 : 1, borderColor: DAY() ? T().outline : T().surface2, alignItems: 'center', justifyContent: 'center' }, // 1.4.22 icon button (spec §3)
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1.5, borderColor: colors.ink },
  badgeText: { color: colors.onPrimary, fontWeight: '900', fontSize: 11 },
}));
