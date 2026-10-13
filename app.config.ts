import type { ExpoConfig, ConfigContext } from 'expo/config';
import { assertProductionBuild, resolveBackendMode } from './src/core/backendMode.js';

/**
 * App config. Secrets / project-specific values come from environment variables
 * (see .env.example). Nothing secret is committed here.
 *
 * EXPO_PUBLIC_* variables are inlined into the JS bundle by Expo and read in
 * src/services/config.ts. Firebase web config values are identifiers, not
 * secrets – your data is protected by firestore.rules / storage.rules.
 */
// 1.3.4 sign-up hardening (a): fail the build loudly when API mode is requested without
// EXPO_PUBLIC_API_URL (same check as src/services/config.ts at start-up). Throws BackendConfigError.
// Launch prep: EAS sets EAS_BUILD_PROFILE; a production build must be a real API build – no demo
// backend, no demo admin list, no dev sign-in – or the build stops here.
const isProductionBuild = process.env.EAS_BUILD_PROFILE === 'production' || process.env.APP_VARIANT === 'production';
const backendMode = () => {
  const mode = resolveBackendMode({
    EXPO_PUBLIC_BACKEND: process.env.EXPO_PUBLIC_BACKEND,
    EXPO_PUBLIC_DEMO_MODE: process.env.EXPO_PUBLIC_DEMO_MODE,
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
    EXPO_PUBLIC_API_DEV_AUTH: process.env.EXPO_PUBLIC_API_DEV_AUTH,
    EXPO_PUBLIC_API_AUTH: process.env.EXPO_PUBLIC_API_AUTH,
    production: isProductionBuild,
    hasFirebase: !!process.env.EXPO_PUBLIC_FIREBASE_API_KEY && !!process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID && !!process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  });
  if (isProductionBuild) assertProductionBuild(mode, process.env);
  return mode;
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'VolleyLive',
  slug: 'volleylive',
  scheme: 'volleylive',
  version: '1.4.19',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  primaryColor: '#002E6E', // theme palette.navy (Android colorPrimary)
  ios: {
    supportsTablet: false,
    bundleIdentifier: process.env.IOS_BUNDLE_ID ?? 'com.volleylive.app',
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'VolleyLive uses your location to show volleyball games and courts near you.',
      NSCameraUsageDescription: 'VolleyLive uses the camera so you can add photos to your matches.',
      NSPhotoLibraryUsageDescription: 'VolleyLive needs access to your photos so you can add them to your matches.',
    },
  },
  android: {
    // EAS production builds use the remote versionCode (eas.json appVersionSource=remote + autoIncrement);
    // this value is only for local gradle builds. ANDROID_VERSION_CODE overrides it (e.g. for a local release AAB).
    versionCode: Number(process.env.ANDROID_VERSION_CODE) || 35,
    package: process.env.ANDROID_PACKAGE ?? 'com.volleylive.app',
    adaptiveIcon: {
      backgroundColor: '#002E6E', // theme palette.navy (checked in src/theme/__tests__/contrast.test.ts)
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA'],
    // Photos only, no video: no microphone. SYSTEM_ALERT_WINDOW is a dev-client/debug addition and
    // must not reach a release manifest (QA retest 217 #10; checked with aapt on the APK).
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW'],
    predictiveBackGestureEnabled: false,
    // Needed for FCM push in Android builds. Download from Firebase console; not committed.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  web: {
    bundler: 'metro',
    output: 'single',
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-status-bar',
    'expo-image',
    [
      'expo-location',
      { locationWhenInUsePermission: 'VolleyLive uses your location to show volleyball games and courts near you.' },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'VolleyLive needs access to your photos so you can add them to your matches.',
        cameraPermission: 'VolleyLive uses the camera so you can add photos to your matches.',
        microphonePermission: false, // photos only (no video recording)
      },
    ],
    ['expo-notifications', { color: '#00BAF2' }], // theme palette.blue
    [
      'react-native-maps',
      // Only needed for Android store/dev builds (Expo Go works without it).
      process.env.GOOGLE_MAPS_ANDROID_API_KEY ? { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY } : {},
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    // Only whether a key is set (never the key itself): AppMap falls back to PreviewMap without one.
    hasGoogleMapsKey: !!process.env.GOOGLE_MAPS_ANDROID_API_KEY,
    // Backend kind only (demo / api / firebase), for build logs and checks; never a URL or key.
    backendKind: backendMode().kind,
    eas: process.env.EAS_PROJECT_ID ? { projectId: process.env.EAS_PROJECT_ID } : undefined,
  },
});
