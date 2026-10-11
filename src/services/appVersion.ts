/**
 * 1.3.8 (QA V137-12): the app version for About / feedback. Native builds show the store build number
 * (Android versionCode, iOS buildNumber); the web build has none, so it shows the version only
 * (no "(build –)").
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function appVersionInfo(platform: string = Platform.OS): { version: string; build: string | null } {
  const cfg = Constants.expoConfig;
  const version = cfg?.version ?? '';
  if (platform === 'android') return { version, build: cfg?.android?.versionCode != null ? String(cfg.android.versionCode) : null };
  if (platform === 'ios') return { version, build: cfg?.ios?.buildNumber ? String(cfg.ios.buildNumber) : null };
  return { version, build: null };
}

/** "1.3.8 (14)" on Android, "1.3.8" on web. */
export function appVersionLabel(platform: string = Platform.OS): string {
  const { version, build } = appVersionInfo(platform);
  return build ? `${version} (${build})` : version;
}
