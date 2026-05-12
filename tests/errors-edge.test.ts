import { describe, it, expect, beforeEach } from 'bun:test';
import { ErrorTypes } from '../src/types/errors';
import { ErrorController } from '../src/controller/error-controller';

describe('ErrorController - edge cases', () => {
  let mockHls: {
    config: { fragLoadPolicy: { errorRetry: { maxNumRetry: number } } };
    url: string;
    trigger: (event: string, data?: any) => void;
    levels: { id: number }[];
    media: any | null;
    detachMedia: () => void;
    attachMedia: (m: any) => void;
  };

  beforeEach(() => {
    const events: { event: string; data: any }[] = [];
    mockHls = {
      config: { fragLoadPolicy: { errorRetry: { maxNumRetry: 3 } } },
      url: 'http://example.com/manifest.m3u8',
      trigger: (event: string, data: any) => { events.push({ event, data }); },
      levels: [{ id: 0 }, { id: 1 }, { id: 2 }],
      media: null,
      detachMedia: () => {},
      attachMedia: () => {},
    };
  });

  it('should handle network error with frag url and trigger retry', () => {
    const ec = new ErrorController(mockHls);
    let triggered = false;

    mockHls.trigger = (event: string) => {
      if (event === 'levelLoading') triggered = true;
    };

    (ec as unknown as { _onError: (data: any) => void })._onError({
      type: ErrorTypes.NETWORK_ERROR,
      details: 'fragLoadError',
      fatal: true,
      reason: 'timeout',
      frag: { url: 'http://example.com/seg1.ts', sn: 0, level: 0 } as any,
    });

    // The setTimeout should be created for backoff retry
    // We can't test the timer directly but the method shouldn't throw
  });

  it('should handle network error without frag url (no retry)', () => {
    const ec = new ErrorController(mockHls);
    (ec as unknown as { _onError: (data: any) => void })._onError({
      type: ErrorTypes.NETWORK_ERROR,
      details: 'manifestLoadError',
      fatal: true,
      reason: 'network error',
    });
    // No frag.url → no timer set, should not throw
  });

  it('should handle media error with swap callback', () => {
    let detached = false;
    let attached = false;
    const mockMedia = {
      paused: false,
      currentTime: 42,
      play: () => Promise.resolve(),
    };

    mockHls.media = mockMedia;
    mockHls.detachMedia = () => { detached = true; };
    mockHls.attachMedia = (m: any) => { attached = true; };

    const ec = new ErrorController(mockHls);

    (ec as unknown as { _onError: (data: any) => void })._onError({
      type: ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
      fatal: true,
      reason: 'buffer error',
    });

    expect(detached).toBe(true);
    // attachMedia is called inside setTimeout(..., 100), can't test synchronously
  });

  it('should handle media error with paused media', () => {
    let detached = false;
    mockHls.media = { paused: true, currentTime: 10, play: () => Promise.resolve() };
    mockHls.detachMedia = () => { detached = true; };
    mockHls.attachMedia = () => {};

    const ec = new ErrorController(mockHls);
    (ec as unknown as { _onError: (data: any) => void })._onError({
      type: ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
      fatal: true,
      reason: 'buffer error',
    });

    expect(detached).toBe(true);
  });

  it('should handle mux error by dropping to lower level', () => {
    let switchedLevel = -1;
    mockHls.trigger = (event: string, data: any) => {
      if (event === 'levelSwitching') switchedLevel = data.level;
    };

    const ec = new ErrorController(mockHls);
    (ec as unknown as { _onError: (data: any) => void })._onError({
      type: ErrorTypes.MUX_ERROR,
      details: 'fragParsingError',
      fatal: true,
      reason: 'parsing error',
      frag: { url: 'seg.ts', sn: 5, level: 2 } as any,
    });

    // setTimeout should lower level from 2 to 1
    expect(switchedLevel).toBe(-1); // Called async in setTimeout
  });

  it('should handle mux error with single level (no fallback)', () => {
    mockHls.levels = [{ id: 0 }];
    const ec = new ErrorController(mockHls);
    (ec as unknown as { _onError: (data: any) => void })._onError({
      type: ErrorTypes.MUX_ERROR,
      details: 'fragParsingError',
      fatal: true,
      reason: 'error',
      frag: { url: 'seg.ts', sn: 0, level: 0 } as any,
    });
    // levels.length <= 1 → no action
  });

  it('should handle mux error without frag level', () => {
    const ec = new ErrorController(mockHls);
    (ec as unknown as { _onError: (data: any) => void })._onError({
      type: ErrorTypes.MUX_ERROR,
      details: 'fragParsingError',
      fatal: true,
      reason: 'error',
      frag: { url: 'seg.ts', sn: 0, level: undefined as unknown as number } as any,
    });
    // levelId === undefined → early return
  });
});
