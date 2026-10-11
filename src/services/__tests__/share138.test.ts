/** 1.3.8 (V137-11): Share falls back to the clipboard on web with a "Copied" toast; failures say so. */
import { Share } from 'react-native';
import { shareOrCopy } from '../share';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const mockToast = jest.fn();
jest.mock('../../state/toast', () => ({ showToast: (...a: unknown[]) => mockToast(...a) }));

const g = globalThis as { navigator?: unknown };
const realNav = g.navigator;
afterEach(() => {
  mockToast.mockReset();
  Object.defineProperty(globalThis, 'navigator', { value: realNav, configurable: true, writable: true });
  jest.restoreAllMocks();
});
const setNav = (nav: unknown) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });

describe('shareOrCopy', () => {
  it('web without a share sheet copies to the clipboard and toasts "Copied to clipboard"', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNav({ clipboard: { writeText } });
    await expect(shareOrCopy('hello', 'web')).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(mockToast).toHaveBeenCalledWith('Copied to clipboard');
  });
  it('web share sheet: shared, dismissed (no toast), or refused → clipboard', async () => {
    setNav({ share: jest.fn().mockResolvedValue(undefined) });
    await expect(shareOrCopy('a', 'web')).resolves.toBe('shared');
    setNav({ share: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' })) });
    await expect(shareOrCopy('a', 'web')).resolves.toBe('dismissed');
    expect(mockToast).not.toHaveBeenCalled();
    const writeText = jest.fn().mockResolvedValue(undefined);
    setNav({ share: jest.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' })), clipboard: { writeText } });
    await expect(shareOrCopy('a', 'web')).resolves.toBe('copied');
  });
  it('web with no clipboard either → "Couldn\'t share" toast', async () => {
    setNav({ clipboard: { writeText: jest.fn().mockRejectedValue(new Error('denied')) } });
    await expect(shareOrCopy('a', 'web')).resolves.toBe('failed');
    expect(mockToast).toHaveBeenCalledWith("Couldn't share. Try again.");
  });
  it('native: system sheet; an error shows feedback', async () => {
    jest.spyOn(Share, 'share').mockResolvedValueOnce({ action: Share.sharedAction } as never);
    await expect(shareOrCopy('a', 'android')).resolves.toBe('shared');
    jest.spyOn(Share, 'share').mockRejectedValueOnce(new Error('no activity'));
    await expect(shareOrCopy('a', 'android')).resolves.toBe('failed');
    expect(mockToast).toHaveBeenCalledWith("Couldn't share. Try again.");
  });
});
