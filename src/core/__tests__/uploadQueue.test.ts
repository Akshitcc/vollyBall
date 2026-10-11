import { QUEUE_MAX_AGE_MS, dueItems, enqueue, isPermanentUploadError, markFailed, nextWake, parseQueue, removeItem, retryDelay } from '../uploadQueue';
import { CodedError } from '../codedError';

describe('offline photo queue (pure part)', () => {
  it('retry delays grow and cap at 5 minutes', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 20].map(retryDelay)).toEqual([0, 5000, 15000, 30000, 60000, 120000, 300000, 300000]);
  });
  it('network problems are retried; refusals and bad files are not', () => {
    expect(isPermanentUploadError(new TypeError('Network request failed'))).toBe(false);
    expect(isPermanentUploadError({ status: 503, message: 'busy' })).toBe(false);
    expect(isPermanentUploadError({ status: 429, message: 'slow down' })).toBe(false);
    expect(isPermanentUploadError({ code: 'storage/retry-limit-exceeded', message: 'x' })).toBe(false);
    expect(isPermanentUploadError(new CodedError('photo_not_allowed', 'x'))).toBe(true);
    expect(isPermanentUploadError({ code: 'photo_too_large', status: 413 })).toBe(true);
    expect(isPermanentUploadError({ status: 403, message: 'no' })).toBe(true);
    expect(isPermanentUploadError({ code: 'storage/unauthorized', message: 'x' })).toBe(true);
    expect(isPermanentUploadError(new Error('Match not found'))).toBe(true);
  });
  it('enqueue → fail → wait → due again; remove; expiry; next wake', () => {
    let q = enqueue([], { id: 'a', matchId: 'm', uid: 'u', uri: 'file:///a', addedAt: 1000 });
    q = enqueue(q, { id: 'b', matchId: 'm', uid: 'u', uri: 'file:///b', addedAt: 2000 });
    expect(dueItems(q, 2000).map((x) => x.id)).toEqual(['a', 'b']);
    q = markFailed(q, 'a', 3000);
    expect(q[0]).toMatchObject({ tries: 1, nextAt: 8000 });
    expect(dueItems(q, 3000).map((x) => x.id)).toEqual(['b']);
    expect(nextWake(removeItem(q, 'b'), 3000)).toBe(5000);
    expect(dueItems(q, 1000 + QUEUE_MAX_AGE_MS + 1).map((x) => x.id)).toEqual(['b']); // a expired, b not yet
    expect(dueItems(q, 2000 + QUEUE_MAX_AGE_MS)).toEqual([]);
    expect(nextWake([], 0)).toBeNull();
  });
  it('a stored queue is parsed defensively', () => {
    expect(parseQueue(null)).toEqual([]);
    expect(parseQueue('nope')).toEqual([]);
    expect(parseQueue('{"a":1}')).toEqual([]);
    expect(parseQueue(JSON.stringify([{ id: 'a', matchId: 'm', uid: 'u', uri: 'x', addedAt: 1 }, { id: 2 }]))).toEqual([{ id: 'a', matchId: 'm', uid: 'u', uri: 'x', addedAt: 1, tries: 0, nextAt: 0 }]);
  });
});
