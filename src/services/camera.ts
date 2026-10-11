/**
 * Camera / gallery access for match photos (expo-image-picker).
 *
 * Phones: before the OS camera prompt the app shows its own translated explanation (EN/HI); once
 * the OS says "denied, don't ask again" the app explains how to turn it on and offers Open settings.
 * Web: there is no OS prompt for the picker; if the browser reports camera access as blocked the
 * same message is shown (without Open settings), otherwise the explanation is shown once.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';
import { PHOTO_ACCEPT } from '../core/photos';

export type CameraAccess = 'granted' | 'ask' | 'denied';
export interface PickedPhoto {
  uri: string;
  fileSize?: number | null;
  /** Declared type from the picker / browser, when known. */
  mimeType?: string | null;
}

const EXPLAINED_KEY = 'volleylive-camera-explained-v1';
const OPTS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.7 };

/** True on Android / iOS (Open settings is offered there only). */
export const isPhone = () => Platform.OS === 'android' || Platform.OS === 'ios';
/** PRD PHOTO-01: the in-app camera button is offered on phones only; web uses the file picker. */
export const hasCameraButton = () => isPhone();

export async function cameraAccess(): Promise<CameraAccess> {
  if (!isPhone()) {
    try {
      const nav = (globalThis as { navigator?: { permissions?: { query: (d: { name: string }) => Promise<{ state: string }> } } }).navigator;
      const st = await nav?.permissions?.query({ name: 'camera' });
      if (st?.state === 'denied') return 'denied';
    } catch {
      // Permissions API missing or 'camera' unsupported: just open the picker
    }
    return (await AsyncStorage.getItem(EXPLAINED_KEY).catch(() => '1')) ? 'granted' : 'ask';
  }
  const p = await ImagePicker.getCameraPermissionsAsync();
  if (p.granted) return 'granted';
  if (p.status === ImagePicker.PermissionStatus.DENIED && !p.canAskAgain) return 'denied';
  return 'ask';
}

/** After the app's explanation: ask the OS (phones). True when the camera may be used. */
export async function requestCamera(): Promise<boolean> {
  await AsyncStorage.setItem(EXPLAINED_KEY, '1').catch(() => {});
  if (!isPhone()) return true;
  const p = await ImagePicker.requestCameraPermissionsAsync();
  return p.granted;
}

const first = (r: ImagePicker.ImagePickerResult): PickedPhoto | null =>
  r.canceled || !r.assets?.length ? null : { uri: r.assets[0].uri, fileSize: r.assets[0].fileSize, mimeType: r.assets[0].mimeType ?? null };

/**
 * Web file picker with the photo allow-list (1.1.0 browser pass: expo-image-picker's web input had
 * accept=",image/*", which let an SVG or a renamed text file through). The file is checked again
 * by its bytes before it is queued (services/photoFile.ts).
 */
export function pickWebFile(doc: Document = document): Promise<PickedPhoto | null> {
  return pickWebFiles(doc, 1).then((l) => l[0] ?? null);
}

/** 1.3.2: up to `limit` photos at once from the gallery / file picker. */
export const MAX_GALLERY_PICK = 10;

/** Web: the same allow-listed file input, with `multiple`; at most `limit` files are kept. */
export function pickWebFiles(doc: Document = document, limit = MAX_GALLERY_PICK): Promise<PickedPhoto[]> {
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = PHOTO_ACCEPT;
    if (limit > 1) input.multiple = true;
    input.style.display = 'none';
    let done = false;
    const finish = (v: PickedPhoto[]) => {
      if (done) return;
      done = true;
      input.remove();
      resolve(v);
    };
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []).slice(0, limit);
      finish(files.map((f) => ({ uri: URL.createObjectURL(f), fileSize: f.size, mimeType: f.type || null })));
    });
    input.addEventListener('cancel', () => finish([]));
    doc.body.appendChild(input);
    input.click();
  });
}

export async function takePhoto(): Promise<PickedPhoto | null> {
  if (Platform.OS === 'web') return pickWebFile();
  return first(await ImagePicker.launchCameraAsync(OPTS));
}
export async function pickPhoto(): Promise<PickedPhoto | null> {
  if (Platform.OS === 'web') return pickWebFile();
  return first(await ImagePicker.launchImageLibraryAsync(OPTS));
}
/**
 * 1.3.2 "Choose from gallery": several photos at once (Android/iOS photo picker with
 * allowsMultipleSelection + selectionLimit; web file input with `multiple`). Never more than `limit`.
 */
export async function pickPhotos(limit = MAX_GALLERY_PICK): Promise<PickedPhoto[]> {
  if (Platform.OS === 'web') return pickWebFiles(document, limit);
  const r = await ImagePicker.launchImageLibraryAsync({ ...OPTS, allowsMultipleSelection: limit > 1, selectionLimit: limit, orderedSelection: true });
  if (r.canceled || !r.assets?.length) return [];
  return r.assets.slice(0, limit).map((a) => ({ uri: a.uri, fileSize: a.fileSize, mimeType: a.mimeType ?? null }));
}
export const openSettings = () => Linking.openSettings().catch(() => {});
