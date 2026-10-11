/**
 * Match photos: a thumbnail grid and a full-screen viewer (swipe or arrows between photos, close
 * button, "2 of 5", who added it and when; labels in EN/HI).
 *
 * 1.1.0 browser pass: a photo that fails to load keeps its place as a broken-image placeholder, so
 * the grid and the "Photo 2 of 6" counter always agree. PRD PHOTO-03: the uploader can delete their
 * own photo from the grid or the viewer after a confirm dialog (EN/HI).
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { MatchPhoto } from '../core/types';
import { colors } from '../theme';

/** An image that shows a broken-photo placeholder in its place when it can't be loaded. */
export function PhotoImage({ uri, style, contentFit, label, dark, testID }: { uri: string; style: object; contentFit: 'cover' | 'contain'; label?: string; dark?: boolean; testID?: string }) {
  const { t } = useTranslation();
  // Remember which URL failed (a new URL gets a fresh try).
  const [brokenUri, setBrokenUri] = useState<string | null>(null);
  if (brokenUri === uri)
    return (
      <View style={[style, s.broken, dark && s.brokenDark]} testID={testID ? `${testID}-broken` : 'photo-broken'} accessibilityRole="image" accessibilityLabel={label ? `${label}. ${t('photos.broken')}` : t('photos.broken')}>
        <Ionicons name="image-outline" size={dark ? 48 : 26} color={dark ? colors.onInkMuted : colors.muted} />
        <Ionicons name="close-circle" size={dark ? 20 : 14} color={dark ? colors.onInkMuted : colors.muted} style={{ marginTop: -10, marginLeft: dark ? 34 : 20 }} />
        {dark && <Text style={s.brokenText}>{t('photos.broken')}</Text>}
      </View>
    );
  return <Image source={{ uri }} style={style} contentFit={contentFit} accessibilityLabel={label} onError={() => setBrokenUri(uri)} testID={testID} />;
}

/** "Delete this photo?" with Cancel / Delete (EN/HI). */
export function DeletePhotoDialog({ photo, onCancel, onDelete }: { photo: MatchPhoto | null; onCancel: () => void; onDelete: (p: MatchPhoto) => Promise<void> }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [photo]);
  if (!photo) return null;
  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onDelete(photo);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.dlgBg}>
        <View style={s.dlg} testID="photo-delete-dialog" accessibilityViewIsModal>
          <Text style={s.dlgTitle} accessibilityRole="header">{t('photos.deleteTitle')}</Text>
          <Text style={s.dlgText}>{t('photos.deleteText')}</Text>
          {failed && <Text style={[s.dlgText, { color: colors.danger }]} testID="photo-delete-failed">{t('photos.deleteFailed')}</Text>}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
            <Pressable onPress={onCancel} style={[s.dlgBtn, s.dlgCancel]} testID="photo-delete-cancel" accessibilityRole="button">
              <Text style={s.dlgCancelText}>{t('photos.cancel')}</Text>
            </Pressable>
            <Pressable onPress={confirm} disabled={busy} style={[s.dlgBtn, s.dlgDelete]} testID="photo-delete-confirm" accessibilityRole="button" accessibilityState={{ busy }}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={s.dlgDeleteText}>{t('photos.deleteConfirm')}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function PhotoGrid({
  photos,
  onOpen,
  max,
  columns = 3,
  testID = 'photo-grid',
  canDelete,
  onDelete,
}: {
  photos: MatchPhoto[];
  onOpen: (index: number) => void;
  max?: number;
  columns?: 2 | 3 | 4;
  testID?: string;
  /** Show the delete button on photos this returns true for (your own). */
  canDelete?: (p: MatchPhoto) => boolean;
  onDelete?: (p: MatchPhoto) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState<MatchPhoto | null>(null);
  const shown = max ? photos.slice(0, max) : photos;
  const w = columns === 4 ? '23.2%' : columns === 2 ? '48.2%' : '31.5%';
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 }} testID={testID}>
      {shown.map((p, i) => (
        <Pressable
          key={p.id}
          onPress={() => onOpen(i)}
          testID={`${testID}-${i}`}
          accessibilityRole="imagebutton"
          accessibilityLabel={t('photos.open', { n: i + 1, total: photos.length })}
          style={{ width: w, aspectRatio: 1, margin: '0.9%' }}
        >
          <PhotoImage uri={p.url} style={{ width: '100%', height: '100%', borderRadius: 10, backgroundColor: colors.surface }} contentFit="cover" testID={`${testID}-${i}-img`} />
          {onDelete && canDelete?.(p) && (
            <Pressable
              onPress={() => setAsking(p)}
              style={s.thumbDelete}
              hitSlop={8}
              testID={`${testID}-${i}-delete`}
              accessibilityRole="button"
              accessibilityLabel={`${t('photos.delete')} (${t('photos.photoN', { n: i + 1, total: photos.length })})`}
            >
              <Ionicons name="trash" size={16} color={colors.white} />
            </Pressable>
          )}
        </Pressable>
      ))}
      {onDelete && (
        <DeletePhotoDialog
          photo={asking}
          onCancel={() => setAsking(null)}
          onDelete={async (p) => {
            await onDelete(p);
            setAsking(null);
          }}
        />
      )}
    </View>
  );
}

export function PhotoViewer({
  photos,
  index,
  onClose,
  nameOf,
  canDelete,
  onDelete,
}: {
  photos: MatchPhoto[];
  /** Photo to open at; null = closed. */
  index: number | null;
  onClose: () => void;
  /** Uploader's display name. */
  nameOf?: (uid: string) => string | undefined;
  canDelete?: (p: MatchPhoto) => boolean;
  onDelete?: (p: MatchPhoto) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [asking, setAsking] = useState<MatchPhoto | null>(null);
  const { width, height } = useWindowDimensions();
  const list = useRef<FlatList<MatchPhoto>>(null);
  const [at, setAt] = useState(index ?? 0);
  useEffect(() => {
    if (index != null) setAt(index);
  }, [index]);
  if (index == null || !photos.length) return null;
  const cur = Math.min(at, photos.length - 1);
  const go = (i: number) => {
    const n = Math.max(0, Math.min(photos.length - 1, i));
    setAt(n);
    list.current?.scrollToIndex({ index: n, animated: true });
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const n = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (n !== cur && n >= 0 && n < photos.length) setAt(n);
  };
  const p = photos[cur];
  const who = nameOf?.(p.uploadedBy);
  const when = new Date(p.createdAt).toLocaleString(i18n.language === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={s.root} testID="photo-viewer" accessibilityViewIsModal>
        <FlatList
          ref={list}
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={cur}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          showsHorizontalScrollIndicator={false}
          keyExtractor={(x) => x.id}
          onMomentumScrollEnd={onScroll}
          onScroll={onScroll}
          scrollEventThrottle={64}
          renderItem={({ item, index: i }) => (
            <View style={{ width, height, justifyContent: 'center' }}>
              <PhotoImage
                uri={item.url}
                style={{ width, height: height * 0.8, alignItems: 'center', justifyContent: 'center' }}
                contentFit="contain"
                dark
                testID={`viewer-photo-${i}`}
                label={t('photos.photoN', { n: i + 1, total: photos.length })}
              />
            </View>
          )}
        />
        <View style={s.top} pointerEvents="box-none">
          <Text style={s.counter} testID="viewer-counter" accessibilityLiveRegion="polite">
            {t('photos.counter', { n: cur + 1, total: photos.length })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {onDelete && canDelete?.(p) && (
              <Pressable onPress={() => setAsking(p)} style={s.close} testID="viewer-delete" accessibilityRole="button" accessibilityLabel={t('photos.delete')} hitSlop={8}>
                <Ionicons name="trash" size={24} color={colors.white} />
              </Pressable>
            )}
            <Pressable onPress={onClose} style={s.close} testID="viewer-close" accessibilityRole="button" accessibilityLabel={t('photos.close')} hitSlop={8}>
              <Ionicons name="close" size={28} color={colors.white} />
            </Pressable>
          </View>
        </View>
        {cur > 0 && (
          <Pressable onPress={() => go(cur - 1)} style={[s.arrow, { left: 8 }]} testID="viewer-prev" accessibilityRole="button" accessibilityLabel={t('photos.previous')}>
            <Ionicons name="chevron-back" size={28} color={colors.white} />
          </Pressable>
        )}
        {cur < photos.length - 1 && (
          <Pressable onPress={() => go(cur + 1)} style={[s.arrow, { right: 8 }]} testID="viewer-next" accessibilityRole="button" accessibilityLabel={t('photos.next')}>
            <Ionicons name="chevron-forward" size={28} color={colors.white} />
          </Pressable>
        )}
        <View style={s.bottom} pointerEvents="none">
          <Text style={s.caption} numberOfLines={2} testID="viewer-caption">
            {who ? t('photos.addedBy', { name: who, when }) : when}
          </Text>
          {photos.length > 1 && <Text style={s.hint}>{t('photos.swipeHint')}</Text>}
        </View>
        {onDelete && (
          <DeletePhotoDialog
            photo={asking}
            onCancel={() => setAsking(null)}
            onDelete={async (x) => {
              await onDelete(x);
              setAsking(null);
              if (photos.length <= 1) onClose();
              else if (cur >= photos.length - 1) setAt(cur - 1);
            }}
          />
        )}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  broken: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  brokenDark: { backgroundColor: '#111', borderColor: '#444' },
  brokenText: { color: colors.onInkMuted, marginTop: 10, fontWeight: '700' },
  thumbDelete: { position: 'absolute', top: 4, right: 4, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  dlgBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dlg: { backgroundColor: colors.white, borderRadius: 16, padding: 20, width: '100%', maxWidth: 380, gap: 10 },
  dlgTitle: { fontSize: 18, fontWeight: '900', color: colors.ink },
  dlgText: { fontSize: 15, color: colors.text, lineHeight: 21 },
  dlgBtn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dlgCancel: { borderWidth: 1, borderColor: colors.border },
  dlgCancelText: { color: colors.ink, fontWeight: '800', fontSize: 16 },
  dlgDelete: { backgroundColor: colors.danger },
  dlgDeleteText: { color: colors.white, fontWeight: '800', fontSize: 16 },
  root: { flex: 1, backgroundColor: '#000' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 36, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  counter: { color: colors.white, fontWeight: '900', fontSize: 16, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, overflow: 'hidden' },
  close: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)' },
  arrow: { position: 'absolute', top: '50%', marginTop: -24, width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, paddingBottom: 28, backgroundColor: 'rgba(0,0,0,0.6)' },
  caption: { color: colors.white, fontWeight: '700', fontSize: 15, textAlign: 'center' },
  hint: { color: colors.onInkMuted, fontSize: 12, textAlign: 'center', marginTop: 4 },
});
