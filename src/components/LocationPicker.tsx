import React, { useEffect, useRef, useState } from 'react';
import { LIMITS } from '../core/limits';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import type { GeoPoint, Place } from '../core/geo';
import { DEFAULT_CENTER, formatCoords, getCurrentLocation, placeName } from '../services/location';
import { colors, radius } from '../theme';
import AppMap from './maps/AppMap';
import { MAP_BG } from './maps/PreviewMap';
import { Button, Field, styles as ui } from './ui';
import { RevealOnShow, useFocusReveal } from './KeyboardAwareScreen';

/** A picked place that can be saved: it has a name (the API and data model require one). */
export const placeReady = (p: Place | null): p is Place => !!p && p.name.trim().length > 0;

/**
 * Pick a place: tap the map or use the current location, then name it.
 * - The map stays where it is when you tap (it only moves for "Use my current location"), so the
 *   pin lands where you tapped (QA bug C).
 * - The name comes from the phone's geocoder when there is one. Otherwise (web) the field is left
 *   empty with a hint to type one; raw coordinates are never used as the name.
 * - A name you typed is never overwritten by a later lookup, and a slow lookup for an earlier tap
 *   can't overwrite the newer one.
 */
export function LocationPicker({ value, onChange }: { value: Place | null; onChange: (p: Place | null) => void }) {
  const { t } = useTranslation();
  const nameReveal = useFocusReveal(); // 1.4.17 (QA V1416-3)
  const [center, setCenter] = useState<GeoPoint>(value ?? DEFAULT_CENTER);
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [noName, setNoName] = useState(false);
  const [noFix, setNoFix] = useState(false);
  const seq = useRef(0);
  const typed = useRef(!!value?.name);
  const latest = useRef(value);
  latest.current = value;
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    // Centre on the user only if location is already allowed: opening the screen never prompts.
    if (!value) getCurrentLocation({ prompt: false }).then((p) => alive.current && p && !latest.current && setCenter(p));
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = async (p: GeoPoint) => {
    const mine = ++seq.current;
    const keep = typed.current && latest.current?.name ? latest.current.name : '';
    onChange({ ...p, name: keep });
    setNoName(false);
    if (keep) return;
    setNaming(true);
    const name = await placeName(p);
    if (!alive.current || mine !== seq.current) return;
    setNaming(false);
    if (typed.current && latest.current?.name) return; // typed while we were looking it up
    if (name) onChange({ ...p, name });
    else setNoName(true);
  };

  const useMine = async () => {
    setBusy(true);
    setNoFix(false);
    const p = await getCurrentLocation({ prompt: true });
    if (!alive.current) return;
    setBusy(false);
    if (!p) return setNoFix(true);
    setCenter(p);
    await pick(p);
  };

  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={ui.label}>{t('location.label')}</Text>
      {/* Map-coloured box, so the space is never blank before the map paints (fix re-test 212 #3). */}
      <View testID="location-map-box" style={{ height: 200, borderRadius: radius.md, overflow: 'hidden', borderWidth: 2, borderColor: colors.border, backgroundColor: MAP_BG }}>
        <AppMap center={center} radiusKm={3} selected={value} onMapPress={pick} />
      </View>
      <Text style={ui.hint}>{t('location.tapHint')}</Text>
      <Button title={t('location.useMine')} icon="locate" variant="secondary" onPress={useMine} loading={busy} testID="use-my-location" />
      {noFix && <Text style={[ui.hint, { color: colors.danger }]} testID="no-fix">{t('location.noFix')}</Text>}
      {value && (
        <>
          {/* 1.4.18 (QA V1416-3): a pin dropped on the map just above the footer makes the place-name field appear
              below it while the footer grows ("Give the place a name.") – the field scrolls into view when it appears */}
          <RevealOnShow show={!!value} dep={`${value.lat},${value.lng}`} below={24}>
          <View ref={nameReveal.ref} collapsable={false}>
          <Field
            onFocus={nameReveal.onFocus}
            label={t('location.placeName')}
            value={value.name}
            onChangeText={(name) => {
              typed.current = name.trim().length > 0;
              onChange({ ...value, name });
            }}
            placeholder={naming ? t('location.locating') : t('location.placePlaceholder')}
            maxLength={LIMITS.placeName.max}
            testID="place-name"
          />
          </View>
          </RevealOnShow>
          {naming && !value.name && <Text style={ui.hint}>{t('location.locating')}</Text>}
          {/* 1.4.18: the "no name found" line arrives after the lookup – it scrolls into view too */}
          <RevealOnShow show={!!noName && !value.name} below={16}>
            {noName && !value.name ? (
              <Text style={[ui.hint, { color: colors.danger }]} testID="place-name-hint">
                {t('location.nameHint', { coords: formatCoords(value) })}
              </Text>
            ) : null}
          </RevealOnShow>
        </>
      )}
    </View>
  );
}
