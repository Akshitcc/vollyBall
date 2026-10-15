/**
 * Build a match side from registered players, one mobile number at a time.
 * As soon as the typed number is complete it is looked up (backend.findUserByPhone):
 * a registered user shows as a card (name + photo, never their number) with an Add button;
 * an unregistered number shows the register-first message and nothing is added.
 */
import { Ionicons } from '@expo/vector-icons';
import { LIMITS } from '../core/limits';
import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, TextInput, View } from 'react-native';
import { toE164 } from '../core/phone';
import { MAX_PLAYERS, MIN_PLAYERS } from '../core/roster';
import { PhoneInput } from './PhoneInput';
import { TEAM_COLORS, type MatchPlayer, type UserProfile } from '../core/types';
import { swatchLabel, translateError } from '../i18n/format';
import { backend } from '../services/backend';
import { colors, contrast, radius, swatchRing } from '../theme';
import { Avatar, Button, Field, Row, styles as ui } from './ui';
import { REVEAL_BELOW, RevealOnShow, ScrollRevealContext, useFocusReveal } from './KeyboardAwareScreen';

export interface BuiltTeam {
  kind: 'build';
  name: string;
  color: string;
  players: MatchPlayer[];
}

type Lookup =
  | { state: 'idle' }
  | { state: 'looking' }
  | { state: 'found'; user: Pick<UserProfile, 'id' | 'name' | 'photoURL'> }
  | { state: 'notRegistered' }
  | { state: 'error'; message: string };

/** 1.4.20: the number a queued rejection was for, as typed (spaced after five digits). */
export const formatQueuedNumber = (d: string) => d.replace(/\D/g, '').replace(/^(\d{5})(\d)/, '$1 $2');

export function TeamBuilder({
  value,
  onChange,
  otherPlayerIds,
  otherColor,
  testID = 'team-builder',
  max = MAX_PLAYERS,
}: {
  /** 1.3.6: most players for the chosen team size (Exact 6 → 6, Custom → 12). */
  max?: number;
  /** The other side's colour: swatches under 3:1 against it are disabled (design-spec §8 05). */
  otherColor?: string | null;
  value: BuiltTeam;
  onChange: (v: BuiltTeam) => void;
  /** Players already on the other side (a player can't be on both teams). */
  otherPlayerIds: string[];
  testID?: string;
}) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const seq = useRef(0);
  // 1.4.19: one lookup per number (the typing lookup and a queued Enter share it)
  const cache = useRef(new Map<string, Promise<UserProfile | null>>());
  const lookupOnce = (n: string) => {
    let p = cache.current.get(n);
    if (!p) {
      p = backend.findUserByPhone(n);
      cache.current.set(n, p);
      p.catch(() => cache.current.delete(n));
    }
    return p;
  };
  const full = value.players.length >= max;

  useEffect(() => {
    const n = toE164(phone);
    const mine = ++seq.current;
    if (!n) return setLookup({ state: 'idle' });
    setLookup({ state: 'looking' });
    const timer = setTimeout(() => {
      lookupOnce(n)
        .then((u) => {
          if (mine !== seq.current) return; // a newer number was typed meanwhile
          // Only what the card needs: no phone number of other users is kept or shown.
          setLookup(u ? { state: 'found', user: { id: u.id, name: u.name, photoURL: u.photoURL ?? null } } : { state: 'notRegistered' });
        })
        .catch((e) => mine === seq.current && setLookup({ state: 'error', message: translateError(e) }));
    }, 350);
    return () => clearTimeout(timer);
  }, [phone]);

  const found = lookup.state === 'found' ? lookup.user : null;
  // 1.4.7 (QA V146-12): the found-player card (and its Add button) scrolls fully into view above the keyboard / the
  // sticky footer when it appears (web: measured against the visual viewport, V146-6)
  const reveal = useContext(ScrollRevealContext);
  const foundRef = useRef<View>(null);
  const foundId = found?.id ?? null;
  useEffect(() => {
    if (!foundId) return;
    const tm = setTimeout(() => reveal(foundRef.current, 24), 60);
    return () => clearTimeout(tm);
  }, [foundId, reveal]);
  const problem = !found
    ? null
    : value.players.some((p) => p.id === found.id)
      ? t('newMatch.alreadyAdded', { name: found.name })
      : otherPlayerIds.includes(found.id)
        ? t('newMatch.onOtherTeam', { name: found.name })
        : full
          ? t('newMatch.teamFull', { max })
          : null;

  // 1.4.17 (QA V1416-3): the name and phone fields scroll clear of the sticky footer / keyboard when focused
  const nameReveal = useFocusReveal();
  const phoneReveal = useFocusReveal();
  const phoneInput = useRef<TextInput>(null);
  // 1.4.17 (QA V1416-4): after an add the builder keeps at least its height until the next number is typed, so what's
  // below (the captain control) doesn't move up under the finger when the found card goes; focus goes back to the
  // phone field for the next number.
  const height = useRef(0);
  const [hold, setHold] = useState(0);
  // 1.4.19 (QA V1416-3 / V1418-2): the +91 field is revealed (scrolled clear of the sticky footer) when "by number"
  // opens – without needing focus – and again after every add and whenever the "N more" line / its spacer changes.
  const revealTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const revealPhone = useCallback(() => {
    revealTimers.current.forEach(clearTimeout);
    revealTimers.current = [60, 400, 900].map((ms) => setTimeout(() => reveal(phoneReveal.ref.current, REVEAL_BELOW), ms));
  }, [reveal, phoneReveal.ref]);
  useEffect(() => () => revealTimers.current.forEach(clearTimeout), []);
  // latest roster for queued adds (several can run before the parent re-renders)
  const valueRef = useRef(value);
  valueRef.current = value;
  const commit = (u: MatchPlayer) => {
    const v = valueRef.current;
    setHold(height.current);
    if (v.players.length + 1 >= max) setTimeout(() => setHold(0), 1200);
    const next = { ...v, players: [...v.players, u] };
    valueRef.current = next;
    onChange(next);
  };
  const refusal = (u: { id: string; name: string }): string | null => {
    const v = valueRef.current;
    return v.players.some((p) => p.id === u.id) ? t('newMatch.alreadyAdded', { name: u.name })
      : otherPlayerIds.includes(u.id) ? t('newMatch.onOtherTeam', { name: u.name })
        : v.players.length >= max ? t('newMatch.teamFull', { max }) : null;
  };
  /**
   * 1.4.19 (QA V1417-3): the field is cleared ONCE, in the same step that takes the number (a snapshot), and nothing
   * writes to it afterwards – the add / lookup runs on the snapshot. Rapid Enters queue their numbers and are added in
   * order; a later lookup can never overwrite what is being typed.
   */
  const takeNumber = (): string | null => {
    const n = phone;
    phoneInput.current?.clear?.();
    setPhone('');
    setLookup({ state: 'idle' });
    phoneInput.current?.focus?.();
    return n || null;
  };
  // 1.4.21 (QA V1420-5): every number taken by Enter is LISTED until it is resolved – "checking…" while its lookup
  // runs (so a fast Enter never makes it vanish), then removed when added, or kept with its reason and a Dismiss
  // button when refused (not registered, invalid, already added…). A later add or typing never removes a row.
  type Pending = { key: number; digits: string; status: 'checking' | 'refused'; reason?: string };
  const [pending, setPending] = useState<Pending[]>([]);
  const errSeq = useRef(0);
  const refuse = (key: number, reason: string) => setPending((l) => l.map((x) => (x.key === key ? { ...x, status: 'refused', reason } : x)));
  const listRefused = (digits: string, reason: string) =>
    setPending((l) => (l.some((x) => x.status === 'refused' && x.digits === digits) ? l : [...l, { key: ++errSeq.current, digits, status: 'refused' as const, reason }]).slice(-6));
  const dismiss = (key: number) => setPending((l) => l.filter((x) => x.key !== key));
  const queue = useRef<{ key: number; digits: string }[]>([]);
  const running = useRef(false);
  const runQueue = async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length) {
        const { key, digits } = queue.current.shift()!;
        const e164 = toE164(digits);
        if (!e164) { refuse(key, t('errors.invalidPhone')); continue; }
        try {
          const u = await lookupOnce(e164);
          if (!u) { refuse(key, t('errors.notRegistered')); continue; }
          const why = refusal(u);
          if (why) { refuse(key, why); continue; }
          commit({ id: u.id, name: u.name, photoURL: u.photoURL ?? null });
          dismiss(key);
          revealPhone();
        } catch (err) {
          refuse(key, translateError(err));
        }
      }
    } finally {
      running.current = false;
    }
  };
  const submit = () => {
    if (!toE164(phone)) return; // incomplete number: Enter does nothing (the field keeps it)
    // 1.4.20 (V1419-3) + 1.4.21 (V1420-5): a number already shown as not registered stays in the field to be corrected,
    // and is listed with its reason + Dismiss
    if (lookup.state === 'notRegistered' && !queue.current.length && !running.current) return listRefused(phone, t('errors.notRegistered'));
    if (found && !queue.current.length && !running.current) return add(); // already looked up: add now
    // lookup still running (or a queue in progress): the number is listed as "checking…" and queued – never lost
    const n = takeNumber();
    if (!n) return;
    const key = ++errSeq.current;
    setPending((l) => [...l, { key, digits: n, status: 'checking' as const }]);
    queue.current.push({ key, digits: n });
    void runQueue();
  };
  // the found card's Add button: the shown player, same single clear
  const add = () => {
    if (!found || problem) return;
    takeNumber();
    commit(found);
    revealPhone();
  };
  const typePhone = (n: string) => {
    if (n) setHold(0);
    setPhone(n);
  };
  // 1.4.18 (QA V1417-2): the "N more players" line keeps its space once it goes (at the 6th player), so the phone
  // field and the captain card below don't jump up
  const [needH, setNeedH] = useState(0);
  const remove = (id: string) => {
    setHold(0);
    onChange({ ...value, players: value.players.filter((p) => p.id !== id) });
  };
  const missing = Math.max(0, MIN_PLAYERS - value.players.length);
  useEffect(() => { if (!full) revealPhone(); }, [missing > 0, needH, full, value.players.length, revealPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1.4.21: the inline line is not repeated when the same number is already listed (refused) above
  const showNotRegistered = lookup.state === 'notRegistered' && !pending.some((x) => x.status === 'refused' && x.digits === phone);
  return (
    <View testID={testID} style={hold ? { minHeight: hold } : undefined} onLayout={(e) => { if (!hold) height.current = e.nativeEvent.layout.height; }}>
      <Text style={[ui.hint, { marginBottom: 8 }]}>{t('newMatch.buildHint')}</Text>
      <View ref={nameReveal.ref} collapsable={false}>
        <Field label={t('newMatch.teamName')} value={value.name} onChangeText={(name) => onChange({ ...value, name })} placeholder={t('newMatch.teamNamePlaceholder')} maxLength={LIMITS.sideName.max} testID={`${testID}-name`} onFocus={nameReveal.onFocus} />
      </View>
      <Text style={ui.label}>{t('newMatch.colour')}</Text>
      <Row style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        {TEAM_COLORS.map((c) => {
          const on = value.color === c;
          const clash = !!otherColor && !on && contrast(c, otherColor) < 3;
          return (
            <Pressable
              key={c}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: clash }}
              accessibilityLabel={swatchLabel(c, t)}
              disabled={clash}
              onPress={() => onChange({ ...value, color: c })}
              testID={`swatch-${testID}-${c.slice(1)}`}
              hitSlop={4}
              style={{ width: 40, height: 40, borderRadius: 20, marginRight: 6, marginBottom: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: on ? colors.primaryText : 'transparent', opacity: clash ? 0.3 : 1 }}
            >
              <View style={[{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: 1, borderColor: colors.hairline }, swatchRing(c)]}>
                {clash && <View style={{ position: 'absolute', left: 14, top: -2, width: 2, height: 34, backgroundColor: colors.ink, transform: [{ rotate: '45deg' }] }} />}
              </View>
            </Pressable>
          );
        })}
      </Row>

      <Text style={ui.label}>
        {t('newMatch.playerCount', { count: value.players.length, max })}
      </Text>
      {value.players.map((p, i) => (
        <Row key={p.id} style={{ paddingVertical: 4 }}>
          <Text style={{ width: 22, fontWeight: '900', color: colors.muted }}>{i + 1}.</Text>
          <Avatar name={p.name} uri={p.photoURL} size={30} color={value.color} />
          <Text style={{ flex: 1, marginLeft: 8, fontWeight: '800', color: colors.text }} numberOfLines={1}>
            {p.name}
          </Text>
          <Pressable onPress={() => remove(p.id)} accessibilityRole="button" accessibilityLabel={t('newMatch.removePlayer', { name: p.name })} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={colors.danger} />
          </Pressable>
        </Row>
      ))}
      {missing > 0 ? (
        <Text style={{ color: colors.danger, fontWeight: '700', marginVertical: 4 }} testID={`${testID}-need`} onLayout={(e) => setNeedH(e.nativeEvent.layout.height)}>
          {t('newMatch.needMore', { count: missing, min: MIN_PLAYERS })}
        </Text>
      ) : needH > 0 && !full ? (
        <View style={{ height: needH, marginVertical: 4 }} testID={`${testID}-need-space`} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
      ) : null}

      {full && (
        <Text style={{ color: colors.muted, fontWeight: '700', marginVertical: 4 }} testID={`${testID}-full`}>
          {t('newMatch.fullHint', { max })}
        </Text>
      )}
      {!full && (
        <>
          <View style={{ marginTop: 8 }} ref={phoneReveal.ref} collapsable={false} testID={`${testID}-phone-wrap`}>
            {/* 1.4.17 (QA V1416-4): Enter / the keyboard's Done adds the found player (and keeps the keyboard up) */}
            <PhoneInput ref={phoneInput} digitsOnly label={t('newMatch.addPlayer')} value={phone} onChangeText={typePhone} testID={`${testID}-phone`} onFocus={phoneReveal.onFocus} onSubmitEditing={submit} blurOnSubmit={false} />
          </View>
        </>
      )}
      {lookup.state === 'looking' && <Text style={ui.hint}>{t('newMatch.lookingUp')}</Text>}
      {/* 1.4.9 (QA V148-7) / 1.4.21 (QA V1420-5): the queued / refused numbers, each with its reason and Dismiss */}
      <RevealOnShow show={pending.length > 0} dep={pending.map((x) => `${x.key}${x.status}`).join(',')}>
        <View testID={`${testID}-pending`}>
          {pending.map((x) => (
            <Row key={x.key} style={{ marginBottom: 6, alignItems: 'flex-start' }} testID={`${testID}-pending-${x.status}`}>
              <Text style={{ flex: 1, color: x.status === 'refused' ? colors.danger : colors.muted, fontWeight: '700' }} accessibilityRole={x.status === 'refused' ? 'alert' : undefined}>
                {formatQueuedNumber(x.digits)}: {x.status === 'refused' ? x.reason : t('newMatch.checkingNumber')}
              </Text>
              {x.status === 'refused' ? (
                <Pressable onPress={() => dismiss(x.key)} accessibilityRole="button" accessibilityLabel={`${t('common.dismiss')} ${formatQueuedNumber(x.digits)}`} hitSlop={8} testID={`${testID}-dismiss-${x.digits.replace(/\D/g, '')}`} style={{ marginLeft: 8 }}>
                  <Text style={{ color: colors.primaryText, fontWeight: '800' }}>{t('common.dismiss')}</Text>
                </Pressable>
              ) : null}
            </Row>
          ))}
        </View>
      </RevealOnShow>
      <RevealOnShow show={showNotRegistered}>
        <Text style={{ color: colors.danger, fontWeight: '700', marginBottom: 8 }} testID={`${testID}-not-registered`}>
          {t('errors.notRegistered')}
        </Text>
      </RevealOnShow>
      <RevealOnShow show={lookup.state === 'error'} dep={lookup.state === 'error' ? lookup.message : null}>
        <Text style={{ color: colors.danger, fontWeight: '700' }} testID={`${testID}-lookup-error`}>
          {lookup.state === 'error' ? lookup.message : ''}
        </Text>
      </RevealOnShow>
      {found && (
        <View
          ref={foundRef}
          testID={`${testID}-found`}
          style={{ borderWidth: 2, borderColor: colors.border, borderRadius: radius.md, padding: 10, marginBottom: 10, backgroundColor: colors.card }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar name={found.name} uri={found.photoURL} size={44} color={value.color} />
            <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
              <Text style={{ fontWeight: '900', fontSize: 16, color: colors.text }} numberOfLines={1}>
                {found.name}
              </Text>
              {!problem && <Text style={{ color: colors.muted, fontWeight: '700', fontSize: 12 }}>{t('newMatch.foundUser')}</Text>}
            </View>
            <Button title={t('newMatch.add')} icon="person-add" onPress={add} disabled={!!problem} testID={`${testID}-add`} />
          </View>
          {/* QA B5: the reason gets its own full-width line and wraps instead of being cut off. */}
          {/* 1.4.9 (QA V148-7, 48_04): the refusal line itself is revealed (the keyboard's reveal used to hide it) */}
          <RevealOnShow show={!!problem} dep={problem} below={16}>
            <Text style={{ color: colors.danger, fontWeight: '700', fontSize: 13, marginTop: 8, flexShrink: 1 }} accessibilityRole="alert" testID={`${testID}-problem`}>
              {problem}
            </Text>
          </RevealOnShow>
        </View>
      )}
    </View>
  );
}
