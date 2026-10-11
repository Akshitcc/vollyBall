/** QA bug H: "Reset demo data" also signs out, so nobody is stranded on "Create your profile". */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DemoBackend } from '../backend/demoBackend';

jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));

test('reset signs the user out and clears the stored session', async () => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  const b = new DemoBackend();
  const seen: (string | null)[] = [];
  b.onAuthChanged((u) => seen.push(u?.uid ?? null));
  const otp = b.sendOtp('+919000000010');
  await jest.advanceTimersByTimeAsync(500);
  const c = await otp;
  const done = c.confirm('123456');
  await jest.advanceTimersByTimeAsync(500);
  await done;
  expect(seen[seen.length - 1]).not.toBeNull();
  expect(await AsyncStorage.getItem('volleylive-demo-auth-v1')).not.toBeNull();
  await b.reset();
  expect(seen[seen.length - 1]).toBeNull();
  expect(await AsyncStorage.getItem('volleylive-demo-auth-v1')).toBeNull();
  jest.useRealTimers();
});
