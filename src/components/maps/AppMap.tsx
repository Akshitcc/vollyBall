// Native map (Google Maps on Android, Apple Maps on iOS) via react-native-maps.
import Constants from 'expo-constants';
import React from 'react';
import { Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { colors } from '../../theme';
import PreviewMap from './PreviewMap';
import type { AppMapProps } from './types';

// Google Maps on Android needs an API key; without one MapView crashes the app, so builds made
// without GOOGLE_MAPS_ANDROID_API_KEY (app.config.ts sets extra.hasGoogleMapsKey) use the
// key-less preview map instead. iOS uses Apple Maps and needs no key.
export const canUseNativeMap = (os: string = Platform.OS, extra: Record<string, unknown> | undefined = Constants.expoConfig?.extra) =>
  os !== 'android' || !!extra?.hasGoogleMapsKey;

export const nativeShowsUser = ({ showsUser = false, userLocation }: Pick<AppMapProps, 'showsUser' | 'userLocation'>) => showsUser && !!userLocation;

export default function AppMap(props: AppMapProps) {
  return canUseNativeMap() ? <NativeMap {...props} /> : <PreviewMap {...props} />;
}

function NativeMap({ center, radiusKm = 15, markers = [], selected, showsUser = false, userLocation, onMarkerPress, onMapPress, style }: AppMapProps) {
  const delta = Math.max(0.01, radiusKm / 55);
  return (
    <MapView
      style={[{ flex: 1 }, style]}
      // Same rule as the key-less map (fix re-test 211): the OS "you are here" dot only on screens
      // that ask for it and once the location is known – not on pickers or court pages.
      showsUserLocation={nativeShowsUser({ showsUser, userLocation })}
      region={{ latitude: center.lat, longitude: center.lng, latitudeDelta: delta, longitudeDelta: delta }}
      onPress={(e) => onMapPress?.({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })}
    >
      {markers.map((m) => (
        <Marker
          key={m.id}
          coordinate={{ latitude: m.lat, longitude: m.lng }}
          title={m.title}
          description={m.subtitle}
          pinColor={m.color ?? colors.primary}
          onCalloutPress={() => onMarkerPress?.(m.id)}
        />
      ))}
      {selected && <Marker coordinate={{ latitude: selected.lat, longitude: selected.lng }} pinColor={colors.primary} />}
    </MapView>
  );
}
