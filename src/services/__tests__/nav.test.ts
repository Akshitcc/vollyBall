/** QA bug D: going "back" from a screen opened directly (no history) must land somewhere, not throw GO_BACK. */
const mockRouter = { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  get router() {
    return mockRouter;
  },
}));
import { goBackOr } from '../nav';

beforeEach(() => jest.clearAllMocks());

test('goes back when there is history', () => {
  mockRouter.canGoBack.mockReturnValue(true);
  goBackOr('/team/t1');
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).not.toHaveBeenCalled();
});

test('replaces with the fallback when there is no history (fresh tab / deep link)', () => {
  mockRouter.canGoBack.mockReturnValue(false);
  goBackOr('/team/t1');
  expect(mockRouter.back).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith('/team/t1');
});

test('defaults to home', () => {
  mockRouter.canGoBack.mockReturnValue(false);
  goBackOr();
  expect(mockRouter.replace).toHaveBeenCalledWith('/');
});
