import { describe, it, expect, afterAll } from 'bun:test';
import { Hls } from '../src/core/Hls';
import { Events, type HlsError } from '../src/types';
import { type PlaylistLoader } from '../src/loader/playlist-loader';

const originalFetch = globalThis.fetch;

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

describe('Hls core - manifest loading callbacks', () => {
  afterAll(() => {
    restoreFetch();
  });

  it('should trigger MANIFEST_LOADED + MANIFEST_PARSED for master playlist', async () => {
    restoreFetch();

    // Mock playlist loader
    const hls = new Hls();
    const playlistData = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720
http://test.com/high.m3u8`;

    // Replace the playlistLoader's internal fetch behavior
    (hls as unknown as { playlistLoader: Partial<PlaylistLoader> }).playlistLoader = {
      load: (_ctx: { url: string }, callbacks: { onSuccess: Function }) => {
        const baseurl = _ctx.url.substring(0, _ctx.url.lastIndexOf('/') + 1);
        callbacks.onSuccess(
          { url: _ctx.url, data: playlistData, stats: { loaded: playlistData.length, total: playlistData.length, trequest: 0, tfirst: 1, tload: 10 } },
          { loaded: playlistData.length, total: playlistData.length, trequest: 0, tfirst: 1, tload: 10 },
          _ctx,
        );
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false },
      abort: () => {},
    };

    let manifestLoaded = false;
    let manifestParsed = false;
    hls.on(Events.MANIFEST_LOADED, () => { manifestLoaded = true; });
    hls.on(Events.MANIFEST_PARSED, () => { manifestParsed = true; });

    hls.loadSource('http://test.com/master.m3u8');

    // Wait for microtasks
    await new Promise((r) => setTimeout(r, 10));

    expect(manifestLoaded).toBe(true);
    expect(manifestParsed).toBe(true);
    hls.destroy();
  });

  it('should trigger LEVEL_LOADED for media playlist (no STREAM-INF)', async () => {
    restoreFetch();
    const hls = new Hls();
    const playlistData = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
seg0.ts
#EXT-X-ENDLIST`;

    (hls as unknown as { playlistLoader: Partial<PlaylistLoader> }).playlistLoader = {
      load: (_ctx: { url: string }, callbacks: { onSuccess: Function }) => {
        callbacks.onSuccess(
          { url: _ctx.url, data: playlistData, stats: { loaded: playlistData.length, total: playlistData.length, trequest: 0, tfirst: 1, tload: 10 } },
          { loaded: playlistData.length, total: playlistData.length, trequest: 0, tfirst: 1, tload: 10 },
          _ctx,
        );
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false },
      abort: () => {},
    };

    let levelLoaded = false;
    hls.on(Events.LEVEL_LOADED, () => { levelLoaded = true; });

    hls.loadSource('http://test.com/media.m3u8');
    await new Promise((r) => setTimeout(r, 10));

    expect(levelLoaded).toBe(true);
    hls.destroy();
  });

  it('should trigger ERROR on manifest load error', async () => {
    restoreFetch();
    const hls = new Hls();

    (hls as unknown as { playlistLoader: Partial<PlaylistLoader> }).playlistLoader = {
      load: (_ctx: { url: string }, callbacks: { onError: Function }) => {
        callbacks.onError({ code: 500, text: 'Server Error' }, _ctx);
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false },
      abort: () => {},
    };

    let errorFired = false;
    hls.on(Events.ERROR, (err: HlsError) => {
      if (err.details === 'manifestLoadError') errorFired = true;
    });

    hls.loadSource('http://test.com/bad.m3u8');
    await new Promise((r) => setTimeout(r, 10));

    expect(errorFired).toBe(true);
    hls.destroy();
  });

  it('should trigger ERROR on manifest load timeout', async () => {
    restoreFetch();
    const hls = new Hls();

    (hls as unknown as { playlistLoader: Partial<PlaylistLoader> }).playlistLoader = {
      load: (_ctx: { url: string }, callbacks: { onTimeout: Function }) => {
        callbacks.onTimeout(
          { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 100, aborted: false },
          _ctx,
        );
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false },
      abort: () => {},
    };

    let timeoutFired = false;
    hls.on(Events.ERROR, (err: HlsError) => {
      if (err.details === 'manifestLoadTimeout') timeoutFired = true;
    });

    hls.loadSource('http://test.com/slow.m3u8');
    await new Promise((r) => setTimeout(r, 10));

    expect(timeoutFired).toBe(true);
    hls.destroy();
  });

  it('should handle malformed manifest data without error (parsing is lenient)', async () => {
    restoreFetch();
    const hls = new Hls();

    (hls as unknown as { playlistLoader: Partial<PlaylistLoader> }).playlistLoader = {
      load: (_ctx: { url: string }, callbacks: { onSuccess: Function }) => {
        const data = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=abc\n';
        callbacks.onSuccess(
          { url: _ctx.url, data, stats: {} },
          { loaded: data.length, total: data.length, trequest: 0, tfirst: 1, tload: 10 },
          _ctx,
        );
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false },
      abort: () => {},
    };

    // Should not throw - parser is lenient
    hls.loadSource('http://test.com/broken.m3u8');
    await new Promise((r) => setTimeout(r, 10));
    hls.destroy();
  });

  it('should support getters for abr, autoLevelCapping', () => {
    const hls = new Hls();
    expect(hls.abr).toBeDefined();
    expect(hls.autoLevelCapping).toBe(-1);
    hls.autoLevelCapping = 1;
    expect(hls.autoLevelCapping).toBe(1);
    hls.destroy();
  });

  it('should support static MSESupported check', () => {
    // Mock MediaSource
    const origMS = (globalThis as unknown as { MediaSource: any }).MediaSource;
    (globalThis as unknown as { MediaSource: any }).MediaSource = class {
      static isTypeSupported() { return true; }
    };
    expect(Hls.isMSESupported()).toBe(true);
    expect(Hls.isSupported()).toBe(true);
    (globalThis as unknown as { MediaSource: any }).MediaSource = origMS;
  });

  it('should return false for isMSESupported when MediaSource is absent', () => {
    const origMS = (globalThis as unknown as { MediaSource: any }).MediaSource;
    (globalThis as unknown as { MediaSource: any }).MediaSource = undefined;
    expect(Hls.isMSESupported()).toBe(false);
    expect(Hls.isSupported()).toBe(false);
    (globalThis as unknown as { MediaSource: any }).MediaSource = origMS;
  });
});
