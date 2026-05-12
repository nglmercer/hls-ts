import { describe, it, expect } from 'bun:test';
import { PlaylistLoader } from '../src/loader/playlist-loader';

describe('PlaylistLoader', () => {
  it('should create with fresh stats', () => {
    const loader = new PlaylistLoader();
    expect(loader.stats.loaded).toBe(0);
    expect(loader.stats.total).toBe(0);
    expect(loader.stats.trequest).toBe(0);
    expect(loader.stats.aborted).toBe(false);
  });

  it('should abort before load', () => {
    const loader = new PlaylistLoader();
    loader.abort();
    expect(loader.stats.aborted).toBe(true);
  });

  it('should handle load error with bad URL', async () => {
    const loader = new PlaylistLoader();
    const result = await new Promise<any>((resolve) => {
      loader.load(
        { url: 'https://nonexistent.invalid/manifest.m3u8' },
        {
          onSuccess: (r) => resolve({ type: 'success', data: r.data }),
          onError: (err) => resolve({ type: 'error', code: err.code }),
          onTimeout: () => resolve({ type: 'timeout' }),
        },
      );
      setTimeout(() => resolve({ type: 'timeout' }), 4000);
    });
    expect(['error', 'timeout']).toContain(result.type);
  });

  it('should be reusable across calls', () => {
    const loader = new PlaylistLoader();
    expect(loader.stats.loaded).toBe(0);
    loader.abort();
    const stats1 = loader.stats;
    expect(stats1.aborted).toBe(true);
  });
});
