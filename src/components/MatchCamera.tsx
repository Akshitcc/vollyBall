/**
 * Match photo capture: the live camera button, the upload progress chip and the camera permission
 * explanation / denied message. Photos go through the offline queue (services/photoQueue), so the
 * scorer never leaves the scoring screen and nothing is lost without a connection.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Modal } from './AppModal'; // 1.4.0 (V139-7): holds the review prompt while open
import { PHOTO_ERROR_CODES, photoSizeProblem } from '../core/photos';
import { MAX_PHOTOS_PER_MATCH, photoSlots } from '../core/limits';
import type { MatchPhoto } from '../core/types';
import { backend } from '../services/backend';
import { getOnce } from '../services/matchFactory';
import { photoErrorMessage } from '../i18n/format';
import { photoError, readPhoto } from '../services/photoFile';
import { cameraAccess, hasCameraButton, isPhone, MAX_GALLERY_PICK, openSettings, pickPhotos, requestCamera, takePhoto, type PickedPhoto } from '../services/camera';
import { queuePickedPhotos } from '../services/photoPick';
import { photoQueue } from '../services/photoQueue';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useReduceMotion } from '../hooks/useReduceMotion';
import { usePhotoQueue } from '../state/usePhotoQueue';
import { colors } from '../theme';
import { Button } from './ui';

type Panel = null | 'explain' | 'denied' | { error: string; title?: string };

export { photoSlots };

/** Camera + gallery actions with the permission flow; the result is queued for upload. */
export function useAddPhoto(matchId: string, uid: string, photoCount?: number) {
  const [panel, setPanel] = useState<Panel>(null);
  // 1.3.4 D133-2: per-match cap (MAX_PHOTOS_PER_MATCH, counting photos still in the upload queue).
  // Screens that already watch the match photos pass their count (shown as "n of 50 · m left");
  // otherwise it is read once when a photo is added. Every backend enforces the cap again.
  const q = usePhotoQueue(matchId);
  const slots = photoCount == null ? null : photoSlots(photoCount, q.pending);
  const slotsNow = async () => {
    if (slots) return slots;
    const n = await getOnce<MatchPhoto[]>((cb) => backend.watchPhotos(matchId, cb))
      .then((l) => l?.length ?? 0)
      .catch(() => 0);
    return photoSlots(n, photoQueue.view(matchId).pending);
  };
  const limitMessage = () => photoErrorMessage(photoError('photo_limit'));

  const queue = async (p: PickedPhoto | null) => {
    if (!p) return;
    if ((await slotsNow()).left <= 0) return setPanel({ error: limitMessage() });
    // QA G10: size checked before uploading, never a silent failure.
    const size = photoSizeProblem(p.fileSize);
    if (size) return setPanel({ error: photoErrorMessage(photoError(size === 'empty' ? 'photo_empty' : 'photo_too_large')) });
    // 1.1.0 browser pass: every backend (demo too) checks the type allow-list, the magic bytes and
    // the size before the photo is queued, with the translated error.
    await readPhoto(p.uri, p.mimeType ?? null);
    await photoQueue.add(matchId, uid, p.uri);
  };
  // 1.3.2: "Choose from gallery" picks up to MAX_GALLERY_PICK photos; each one is checked and queued.
  const [added, setAdded] = useState<number | null>(null);
  const gallery = async () => {
    setPanel(null);
    setAdded(null);
    try {
      const now = await slotsNow();
      if (now.left <= 0) return setPanel({ error: limitMessage() });
      const limit = Math.min(MAX_GALLERY_PICK, now.left);
      const r = await queuePickedPhotos(await pickPhotos(limit), matchId, uid, { limit });
      if (r.queued) setAdded(r.queued);
      const notes: string[] = [];
      if (r.failed.length) {
        const reason = photoErrorMessage(r.failed[0].error);
        notes.push(r.queued || r.failed.length > 1 || r.dropped ? i18n.t('photos.someSkipped', { count: r.failed.length, reason }) : reason);
      }
      // "4 not added: limit 10 per upload" / "… this match can have 50 photos"
      if (r.dropped)
        notes.push(
          limit < MAX_GALLERY_PICK
            ? i18n.t('photos.notAddedMatchLimit', { count: r.dropped, max: MAX_PHOTOS_PER_MATCH })
            : i18n.t('photos.notAddedBatchLimit', { count: r.dropped, max: MAX_GALLERY_PICK }),
        );
      // 1.3.5 (QA E134-5): a partial add says so in the title ("10 added, 2 skipped"), not "Photo not added".
      const skipped = r.failed.length + r.dropped;
      const title = r.queued > 0 && skipped > 0 ? i18n.t('photos.partialTitle', { added: r.queued, skipped }) : undefined;
      if (notes.length) setPanel({ error: notes.join('\n'), title });
    } catch (e) {
      setPanel({ error: photoErrorMessage(e) });
    }
  };
  const openCamera = async () => {
    try {
      await queue(await takePhoto());
    } catch (e) {
      setPanel({ error: photoErrorMessage(e) });
    }
  };
  const camera = async () => {
    if (!hasCameraButton()) return gallery(); // PRD PHOTO-01: web has the file picker only
    const access = await cameraAccess().catch(() => 'granted' as const);
    if (access === 'granted') return openCamera();
    setPanel(access === 'ask' ? 'explain' : 'denied');
  };
  const allow = async () => {
    setPanel(null);
    if (await requestCamera().catch(() => false)) return openCamera();
    setPanel('denied');
  };

  const element = (
    <>
      <CameraPanel panel={panel} onAllow={allow} onGallery={gallery} onClose={() => setPanel(null)} />
      {slots ? (
        <Text style={[s.slots, slots.left <= 0 && { color: colors.danger }]} testID="photo-slots">
          {slots.left > 0 ? i18n.t('photos.slotsLeft', { count: slots.left, used: slots.used, max: MAX_PHOTOS_PER_MATCH }) : i18n.t('photos.slotsFull', { max: MAX_PHOTOS_PER_MATCH })}
        </Text>
      ) : null}
      {/* 1.3.5 (QA E134-5): an upload the backend refused (e.g. the same photo again) is said inline,
          in words, instead of a stale "1 photo added – uploading" next to "Photo not added · tap". */}
      {q.error ? (
        <Text style={s.refused} testID="photo-refused" accessibilityRole="alert" accessibilityLiveRegion="assertive">
          {i18n.t('photos.refusedInline', { reason: photoErrorMessage(q.error.err) })}
        </Text>
      ) : added != null && !panel ? (
        <Text style={s.added} testID="photos-added" accessibilityLiveRegion="polite">
          {i18n.t('photos.addedCount', { count: added })}
        </Text>
      ) : null}
    </>
  );
  return { camera, gallery, element, panel, added, slots };
}

/** Soft red ring around the LIVE pill: scales 1 → 1.15 and fades, 1600 ms loop (off with Reduce Motion). */
function PulseRing() {
  const reduce = useReduceMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    v.value = withRepeat(withTiming(1, { duration: 1600 }), -1, false);
  }, [reduce, v]);
  const st = useAnimatedStyle(() => ({ opacity: 0.6 * (1 - v.value), transform: [{ scaleX: 1 + 0.15 * v.value }, { scaleY: 1 + 0.3 * v.value }] }));
  if (reduce) return null;
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, s.pulse, st]} />;
}

export function CameraPanel({ panel, onAllow, onGallery, onClose }: { panel: Panel; onAllow: () => void; onGallery: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  if (!panel) return null;
  const phone = isPhone();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.bg}>
        <View style={s.card} testID={typeof panel === 'string' ? `camera-${panel}` : 'camera-error'} accessibilityViewIsModal>
          {panel === 'explain' && (
            <>
              <Ionicons name="camera" size={36} color={colors.ink} style={{ alignSelf: 'center' }} />
              <Text style={s.title} accessibilityRole="header">{t('camera.explainTitle')}</Text>
              <Text style={s.text}>{t('camera.explainText')}</Text>
              <Button title={t('camera.continue')} icon="camera" onPress={onAllow} testID="camera-explain-continue" />
              <Button title={t('camera.notNow')} variant="ghost" onPress={onClose} testID="camera-explain-cancel" />
            </>
          )}
          {panel === 'denied' && (
            <>
              <Ionicons name="camera-outline" size={36} color={colors.danger} style={{ alignSelf: 'center' }} />
              <Text style={s.title} accessibilityRole="header">{t('camera.deniedTitle')}</Text>
              <Text style={s.text}>{t(phone ? 'camera.deniedText' : 'camera.deniedTextWeb')}</Text>
              {phone && <Button title={t('camera.openSettings')} icon="settings" onPress={() => { onClose(); openSettings(); }} testID="camera-open-settings" />}
              <Button title={t('camera.useGallery')} icon="images" variant="secondary" onPress={onGallery} testID="camera-use-gallery" />
              <Button title={t('common.close')} variant="ghost" onPress={onClose} testID="camera-denied-close" />
            </>
          )}
          {typeof panel === 'object' && (
            <>
              <Text style={s.title} accessibilityRole="header" testID="camera-error-title">{panel.title ?? t('camera.notAdded')}</Text>
              <Text style={s.text}>{panel.error.startsWith('photo_') ? t(`errors.codes.${panel.error}`) : panel.error}</Text>
              <Button title={t('common.ok')} onPress={onClose} testID="camera-error-ok" />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/**
 * The round camera button for the live screens. Tap: camera (web: the browser's picker);
 * long-press: gallery. Small (44 px) so it fits in the score screen's top bar.
 */
export function LiveCameraButton({ matchId, uid, tone = 'dark', label, pill }: { matchId: string; uid: string; tone?: 'dark' | 'light'; label?: boolean; pill?: boolean }) {
  const { t } = useTranslation();
  const add = useAddPhoto(matchId, uid);
  const fg = tone === 'dark' ? colors.white : colors.ink;
  const native = hasCameraButton(); // PRD PHOTO-01: web gets the file picker, not a camera button
  if (pill)
    return (
      <>
        <Pressable
          testID="live-camera"
          onPress={add.camera}
          onLongPress={native ? add.gallery : undefined}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={native ? t('camera.addLive') : t('camera.addPhotoWeb')}
          accessibilityHint={native ? t('camera.hint') : t('camera.hintWeb')}
          style={({ pressed }) => [native ? s.livePill : s.webPill, { opacity: pressed ? 0.8 : 1 }]}
        >
          {native && <PulseRing />}
          {native && <View style={s.liveDot} />}
          <Text style={s.livePillText} numberOfLines={1}>
            {native ? t('score.liveCam') : t('camera.addPhotoWeb')}
          </Text>
          <Ionicons name={native ? 'videocam' : 'images-outline'} size={16} color={colors.white} />
        </Pressable>
        {add.element}
      </>
    );
  return (
    <>
      <Pressable
        testID="live-camera"
        onPress={add.camera}
        onLongPress={native ? add.gallery : undefined}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={native ? t('camera.addLive') : t('camera.addPhotoWeb')}
        accessibilityHint={native ? t('camera.hint') : t('camera.hintWeb')}
        style={({ pressed }) => [
          label ? s.labelled : s.round,
          tone === 'light' && { backgroundColor: colors.ink },
          { opacity: pressed ? 0.75 : 1 },
        ]}
      >
        <Ionicons name={native ? 'camera' : 'images'} size={22} color={tone === 'light' ? colors.white : fg} />
        {label && (
          <Text style={s.labelText} numberOfLines={1}>
            {native ? t('camera.addLive') : t('camera.addPhotoWeb')}
          </Text>
        )}
      </Pressable>
      {add.element}
    </>
  );
}

/**
 * Upload progress chip: "Uploading 40%", "Waiting for network (2)", "Photo added", or a failure
 * (tap for details). Renders nothing when idle. One line, ~22 px high.
 */
export function UploadChip({ matchId, tone = 'dark' }: { matchId: string; tone?: 'dark' | 'light' }) {
  const { t } = useTranslation();
  const v = usePhotoQueue(matchId);
  const [, tick] = useState(0);
  const [details, setDetails] = useState(false);
  const recentlyDone = !!v.doneAt && Date.now() - v.doneAt < 3000;
  useEffect(() => {
    if (!recentlyDone) return;
    const id = setTimeout(() => tick((x) => x + 1), 3000 - (Date.now() - v.doneAt!) + 50);
    return () => clearTimeout(id);
  }, [recentlyDone, v.doneAt]);

  let icon: keyof typeof Ionicons.glyphMap | null = null;
  let text = '';
  let onPress: (() => void) | undefined;
  let tint: string = tone === 'dark' ? colors.ink2 : colors.surface;
  let fg: string = tone === 'dark' ? colors.white : colors.ink;
  if (v.error) {
    icon = 'alert-circle';
    // 1.3.5 (QA E134-5): the same photo again says so on the chip too
    text = (v.error.err as { code?: string } | null)?.code === PHOTO_ERROR_CODES.duplicate ? t('camera.chipDuplicate') : t('camera.chipFailed');
    tint = colors.warnBg;
    fg = colors.ink;
    onPress = () => setDetails(true);
  } else if (v.uploading) {
    text = v.progress != null ? t('camera.chipUploadingPct', { pct: Math.round(v.progress * 100) }) : t('camera.chipUploading');
    if (v.pending > 1) text += ` (${v.pending})`;
  } else if (v.pending > 0) {
    icon = 'cloud-offline';
    text = t('camera.chipWaiting', { count: v.pending });
    onPress = () => photoQueue.retryNow();
  } else if (recentlyDone) {
    icon = 'checkmark-circle';
    text = t('camera.chipDone');
  } else return null;

  return (
    <>
      <Pressable
        testID="upload-chip"
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLiveRegion="polite"
        style={[s.chip, { backgroundColor: tint }]}
        hitSlop={6}
      >
        {v.uploading && !v.error ? <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.7 }] }} /> : icon && <Ionicons name={icon} size={14} color={icon === 'checkmark-circle' ? (tone === 'dark' ? colors.primary : colors.success) : fg} />}
        <Text style={[s.chipText, { color: fg }]} numberOfLines={1} testID="upload-chip-text">
          {text}
        </Text>
      </Pressable>
      {details && v.error && (
        <CameraPanel
          panel={{ error: photoErrorMessage(v.error.err) }}
          onAllow={() => {}}
          onGallery={() => {}}
          onClose={() => {
            setDetails(false);
            photoQueue.dismissError(matchId);
          }}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  added: { color: colors.successStrong, fontWeight: '700', marginTop: 6 },
  refused: { color: colors.danger, fontWeight: '700', marginTop: 6 },
  slots: { color: colors.muted, fontWeight: '600', fontSize: 12, marginTop: 6 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, minWidth: 44, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.live, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)' },
  webPill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, minWidth: 44, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1.5, borderColor: colors.onInkMuted },
  livePillText: { color: colors.white, fontWeight: '900', fontSize: 13 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.white },
  pulse: { borderRadius: 999, borderWidth: 3, borderColor: 'rgba(198,40,40,0.35)', margin: -4 },
  bg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 20 },
  card: { backgroundColor: colors.white, borderRadius: 20, padding: 20, maxWidth: 420, width: '100%', alignSelf: 'center' },
  title: { fontSize: 20, fontWeight: '900', color: colors.ink, textAlign: 'center', marginTop: 8, marginBottom: 8 },
  text: { fontSize: 15, color: colors.ink, lineHeight: 22, marginBottom: 12, textAlign: 'center' },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink2 },
  labelled: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 14, paddingHorizontal: 14, gap: 8 },
  labelText: { color: colors.white, fontWeight: '800', fontSize: 15, flexShrink: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', borderRadius: 11, paddingHorizontal: 8, height: 22, marginTop: 2, gap: 4, maxWidth: '100%' },
  chipText: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
});
