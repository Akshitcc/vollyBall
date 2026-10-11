import type { StyleProp, ViewStyle } from 'react-native';
import type { GeoPoint } from '../../core/geo';

export interface MapMarker extends GeoPoint {
  id: string;
  title: string;
  subtitle?: string;
  color?: string;
}

export interface AppMapProps {
  center: GeoPoint;
  /** Approx. visible radius in km */
  radiusKm?: number;
  markers?: MapMarker[];
  selected?: GeoPoint | null;
  /**
   * Draw the user's "you are here" dot (default false). Only screens about the user's surroundings
   * set it (the Nearby map), and only once a real location is known – not pickers or court pages.
   */
  showsUser?: boolean;
  /** The user's real location (key-less map draws the dot there; native maps use the OS dot). */
  userLocation?: GeoPoint | null;
  onMarkerPress?: (id: string) => void;
  onMapPress?: (p: GeoPoint) => void;
  style?: StyleProp<ViewStyle>;
}
