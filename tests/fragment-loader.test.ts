import { describe, it, expect } from 'bun:test';
import { FragmentLoader } from '../src/loader/fragment-loader';

describe('FragmentLoader', () => {
  it('should create with default retry config', () => {
    const loader = new FragmentLoader();
    expect(loader.stats).toBeDefined();
    expect(loader.stats.aborted).toBe(false);
    expect(loader.stats.loading).toBe(false);
  });

  it('should create with custom retry config', () => {
    const loader = new FragmentLoader(
      { maxNumRetry: 3, retryDelayMs: 500, maxRetryDelayMs: 5000, backoff: 'exponential' },
      15000,
    );
    expect(loader.stats).toBeDefined();
  });

  it('should abort without error', () => {
    const loader = new FragmentLoader();
    loader.abort();
    expect(loader.stats.aborted).toBe(true);
  });

  it('should handle aborted state on subsequent calls', () => {
    const loader = new FragmentLoader();
    loader.abort();
    loader.abort();
    expect(loader.stats.aborted).toBe(true);
  });

  it('should trigger onError for non-ok response', async () => {
    const loader = new FragmentLoader(undefined, 5000);
    const url = 'https://httpbin.org/status/404';
    const frag = { url, sn: 0, level: 0, duration: 10, start: 0, cc: 0, byteRangeStart: 0, byteRangeEnd: 0, programDateTime: 0, initSegment: null, tagList: [] as string[][], stats: loader.stats };
    const result: any = await new Promise((resolve) => {
      const callbacks = {
        onSuccess: () => resolve({ type: 'success' }),
        onError: (err: any) => resolve({ type: 'error', code: err.code, text: err.text }),
        onTimeout: () => resolve({ type: 'timeout' }),
      };
      loader.load({ url, frag: frag as any }, callbacks);
    });

    expect(result.type).toBe('error');
  });

  it('should handle network error gracefully', async () => {
    const loader = new FragmentLoader({ maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 }, 1000);
    const url = 'https://nonexistent.example.com/segment.ts';

    const result: any = await new Promise((resolve) => {
      const callbacks = {
        onSuccess: () => resolve({ type: 'success' }),
        onError: (err: any) => resolve({ type: 'error', code: err.code, text: err.text }),
        onTimeout: (_stats: any, ctx: any) => resolve({ type: 'timeout', ctx }),
      };
      loader.load({ url, frag: {} as any }, callbacks);
    });

    expect(['error', 'timeout']).toContain(result.type);
  });
});
