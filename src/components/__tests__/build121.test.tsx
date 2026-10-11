/**
 * Build 1.2.1 UI fixes from Tester's 1.1.0 retest / browser pass:
 *  - NB-U1: Send OTP is disabled whenever the phone field shows invalid text;
 *  - PHOTO-03: delete your own photo from the grid and the viewer after a confirm dialog (EN/HI);
 *  - a photo that fails to load keeps its place as a broken-image placeholder ("2 / 3" still exists);
 *  - PHOTO-01: the camera button exists on phones only.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Platform } from 'react-native';
import i18n from '../../i18n';
import type { MatchPhoto } from '../../core/types';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null, MaterialCommunityIcons: () => null }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({}) }));
jest.mock('expo-image', () => {
  const { View } = require('react-native');
  // A test image: url containing "broken" fails to load.
  return {
    Image: (p: { source: { uri: string }; onError?: () => void; testID?: string }) => {
      const React = require('react');
      React.useEffect(() => {
        if (p.source.uri.includes('broken')) p.onError?.();
      }, [p.source.uri]);
      return <View testID={p.testID} />;
    },
  };
});
const mockSendOtp = jest.fn(async () => ({ confirm: jest.fn(async () => undefined) }));
jest.mock('../../services/backend', () => ({ backend: { sendOtp: () => mockSendOtp() } }));

beforeEach(async () => {
  await AsyncStorage.clear();
  await i18n.changeLanguage('en');
  jest.clearAllMocks();
});
afterAll(async () => {
  await i18n.changeLanguage('en');
});

describe('NB-U1: Send OTP while the field shows invalid text', () => {
  const Login = require('../../app/login').default;
  it('1.3.8 (V137-10): a typed letter is dropped as you type (digits-only note), Send stays enabled', async () => {
    await render(<Login />);
    const input = screen.getByTestId('phone-input');
    await fireEvent.changeText(input, '9876543210');
    expect(screen.getByTestId('send-otp').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.changeText(input, '9876543210a');
    expect(input.props.value).toBe('9876543210');
    expect(screen.getByText(/^Digits only/)).toBeTruthy();
    expect(screen.getByTestId('send-otp').props.accessibilityState).toMatchObject({ disabled: false });
    await fireEvent.changeText(input, '98a76');
    expect(input.props.value).toBe('9876');
  });
  it('text that still is not an Indian mobile after filtering (another country code) shows the error and disables Send', async () => {
    await render(<Login />);
    const input = screen.getByTestId('phone-input');
    await fireEvent.changeText(input, '+44 7911 123456');
    expect(screen.getByTestId('send-otp').props.accessibilityState).toMatchObject({ disabled: true });
    await act(async () => {
      fireEvent.press(screen.getByTestId('send-otp'));
    });
    expect(mockSendOtp).not.toHaveBeenCalled();
    await fireEvent.changeText(input, '9876543210');
    expect(screen.getByTestId('send-otp').props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('PHOTO-03 delete + broken photos', () => {
  const { PhotoGrid, PhotoViewer } = require('../PhotoGallery');
  const make = (): MatchPhoto[] => [
    { id: 'p1', matchId: 'm1', url: 'https://x/1.jpg', uploadedBy: 'a1', createdAt: 1_700_000_000_000 },
    { id: 'p2', matchId: 'm1', url: 'https://x/broken.jpg', uploadedBy: 'a2', createdAt: 1_700_000_000_000 },
    { id: 'p3', matchId: 'm1', url: 'https://x/3.jpg', uploadedBy: 'a1', createdAt: 1_700_000_000_000 },
  ];
  function Harness({ onDelete }: { onDelete: (p: MatchPhoto) => Promise<void> }) {
    const [photos, setPhotos] = React.useState(make());
    const [at, setAt] = React.useState<number | null>(null);
    const del = async (p: MatchPhoto) => {
      await onDelete(p);
      setPhotos((xs) => xs.filter((x) => x.id !== p.id));
    };
    const mine = (p: MatchPhoto) => p.uploadedBy === 'a1';
    return (
      <>
        <PhotoGrid photos={photos} onOpen={setAt} testID="t" canDelete={mine} onDelete={del} />
        <PhotoViewer photos={photos} index={at} onClose={() => setAt(null)} canDelete={mine} onDelete={del} />
      </>
    );
  }

  it('a photo that fails to load is a placeholder in place: the grid and "2 / 3" keep it', async () => {
    await render(<Harness onDelete={async () => {}} />);
    expect(screen.getByTestId('t-1-img-broken')).toBeTruthy();
    expect(screen.getByLabelText('This photo couldn’t be loaded')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('t-1'));
    expect(screen.getByTestId('viewer-counter').props.children).toBe('2 / 3');
    expect(screen.getByTestId('viewer-photo-1-broken')).toBeTruthy();
    expect(screen.getByTestId('viewer-photo-0')).toBeTruthy();
  });

  it('only your own photos have Delete; confirm dialog (EN/HI); cancel keeps it; delete removes it', async () => {
    const onDelete = jest.fn(async () => {});
    await render(<Harness onDelete={onDelete} />);
    expect(screen.getByTestId('t-0-delete')).toBeTruthy();
    expect(screen.queryByTestId('t-1-delete')).toBeNull(); // someone else's
    await fireEvent.press(screen.getByTestId('t-0-delete'));
    expect(screen.getByText('Delete this photo?')).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByText('यह फ़ोटो हटाएँ?')).toBeTruthy();
    expect(screen.getByText('रद्द करें')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('photo-delete-cancel'));
    expect(screen.queryByTestId('photo-delete-dialog')).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('t-0-delete'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('photo-delete-confirm'));
    });
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    expect(screen.queryByTestId('photo-delete-dialog')).toBeNull();
    expect(screen.queryByTestId('t-2')).toBeNull(); // 2 photos left
  });

  it('viewer: Delete on your own photo only; a failed delete says so and keeps the photo', async () => {
    const onDelete = jest.fn(async () => {
      throw new Error('offline');
    });
    await render(<Harness onDelete={onDelete} />);
    await fireEvent.press(screen.getByTestId('t-1'));
    expect(screen.queryByTestId('viewer-delete')).toBeNull();
    await fireEvent.press(screen.getByTestId('viewer-next'));
    expect(screen.getByTestId('viewer-delete')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('viewer-delete'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('photo-delete-confirm'));
    });
    expect(screen.getByTestId('photo-delete-failed').props.children).toBe('Couldn’t delete the photo. Try again.');
    expect(screen.getByTestId('viewer-counter').props.children).toBe('3 / 3');
  });
});

describe('PHOTO-01: camera button on phones only', () => {
  const { hasCameraButton } = require('../../services/camera');
  const realOS = Platform.OS;
  afterEach(() => Object.defineProperty(Platform, 'OS', { get: () => realOS, configurable: true }));
  it.each([
    ['android', true],
    ['ios', true],
    ['web', false],
  ])('%s → %p', (os, want) => {
    Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
    expect(hasCameraButton()).toBe(want);
  });
});
