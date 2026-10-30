/** 1.5.8 (Tester F157u-4): Space (and Enter) on a focused star picks it on web; the accessibility action does too. */
import { Platform } from 'react-native';
import { starKeyProps } from '../starKeys';

describe('F157u-4 feedback stars', () => {
  it('web: Space / Enter pick the star, other keys do not', () => {
    const os = Platform.OS;
    (Platform as { OS: string }).OS = 'web';
    try {
      const pick = jest.fn();
      const p = starKeyProps(4, pick) as { onKeyDown: (e: { key: string; preventDefault: () => void }) => void };
      const prevent = jest.fn();
      p.onKeyDown({ key: ' ', preventDefault: prevent });
      p.onKeyDown({ key: 'Enter', preventDefault: prevent });
      p.onKeyDown({ key: 'a', preventDefault: prevent });
      expect(pick.mock.calls).toEqual([[4], [4]]);
      expect(prevent).toHaveBeenCalledTimes(2);
    } finally {
      (Platform as { OS: string }).OS = os;
    }
  });
  it('the accessibility activate action picks the star', () => {
    const pick = jest.fn();
    const p = starKeyProps(2, pick);
    expect(p.accessibilityActions).toEqual([{ name: 'activate' }]);
    p.onAccessibilityAction({ nativeEvent: { actionName: 'activate' } });
    p.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } });
    expect(pick.mock.calls).toEqual([[2]]);
  });
});
