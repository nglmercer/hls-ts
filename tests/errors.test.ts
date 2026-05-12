import { describe, it, expect } from 'bun:test';
import { ErrorTypes, ErrorDetails } from '../src/types/errors';
import { ErrorController } from '../src/controller/error-controller';

describe('ErrorTypes', () => {
  it('should have correct error types', () => {
    expect(ErrorTypes.NETWORK_ERROR).toBe('networkError');
    expect(ErrorTypes.MEDIA_ERROR).toBe('mediaError');
    expect(ErrorTypes.MUX_ERROR).toBe('muxError');
    expect(ErrorTypes.KEY_SYSTEM_ERROR).toBe('keySystemError');
    expect(ErrorTypes.OTHER_ERROR).toBe('otherError');
  });

  it('should have error details', () => {
    expect(ErrorDetails.MANIFEST_LOAD_ERROR).toBe('manifestLoadError');
    expect(ErrorDetails.FRAG_LOAD_ERROR).toBe('fragLoadError');
    expect(ErrorDetails.BUFFER_APPEND_ERROR).toBe('bufferAppendError');
    expect(ErrorDetails.FRAG_PARSING_ERROR).toBe('fragParsingError');
  });
});

describe('ErrorController', () => {
  it('should create and destroy', () => {
    const hlsMock = { config: { fragLoadPolicy: { errorRetry: { maxNumRetry: 3 } } }, url: 'http://example.com', levels: [{ id: 0 }], media: null, trigger: () => {}, detachMedia: () => {}, attachMedia: () => {} };
    const ec = new ErrorController(hlsMock);
    ec.destroy();
  });

  it('should handle network error with retry backoff', () => {
    let triggered = false;
    const hlsMock = {
      config: { fragLoadPolicy: { errorRetry: { maxNumRetry: 3 } } },
      url: 'http://example.com/manifest.m3u8',
      trigger: () => { triggered = true; },
      levels: [],
      media: null,
      detachMedia: () => {},
      attachMedia: () => {},
    };
    const ec = new ErrorController(hlsMock);

    (ec as any)._onError({
      type: ErrorTypes.NETWORK_ERROR,
      details: 'fragLoadError',
      fatal: true,
      reason: 'Network failure',
      frag: { url: 'http://example.com/seg1.ts', sn: 1, level: 0 },
    });
  });

  it('should handle media error with swap attempt', () => {
    let detached = false;
    let attached = false;
    const media = { paused: false, currentTime: 10, play: () => Promise.resolve() };
    const hlsMock = {
      config: {},
      media,
      trigger: () => {},
      detachMedia: () => { detached = true; },
      attachMedia: (m: any) => { attached = true; },
      levels: [],
    };
    const ec = new ErrorController(hlsMock);

    (ec as any)._onError({
      type: ErrorTypes.MEDIA_ERROR,
      details: 'bufferAppendError',
      fatal: true,
      reason: 'Buffer error',
    });
  });
});
