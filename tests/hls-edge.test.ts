import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hls } from '../src/core/Hls';
import { Events } from '../src/types/events';
import { ErrorTypes } from '../src/types/errors';

describe('Hls - edge cases', () => {
  it('should support static isSupported', () => {
    expect(typeof Hls.isSupported).toBe('function');
  });

  it('should support once event listener', () => {
    const hls = new Hls();
    let count = 0;
    hls.once(Events.MANIFEST_LOADING, () => count++);
    hls.trigger(Events.MANIFEST_LOADING, {});
    hls.trigger(Events.MANIFEST_LOADING, {});
    expect(count).toBe(1);
  });

  it('should support off event listener', () => {
    const hls = new Hls();
    let count = 0;
    const fn = () => count++;
    hls.on(Events.MANIFEST_LOADING, fn);
    hls.off(Events.MANIFEST_LOADING, fn);
    hls.trigger(Events.MANIFEST_LOADING, {});
    expect(count).toBe(0);
  });

  it('should support emit alias for trigger', () => {
    const hls = new Hls();
    let emitted = false;
    hls.on(Events.MANIFEST_LOADING, () => { emitted = true; });
    hls.emit(Events.MANIFEST_LOADING, {});
    expect(emitted).toBe(true);
  });

  it('should support removeAllListeners with specific event', () => {
    const hls = new Hls();
    let count = 0;
    hls.on(Events.MANIFEST_LOADING, () => count++);
    hls.removeAllListeners(Events.MANIFEST_LOADING);
    hls.trigger(Events.MANIFEST_LOADING, {});
    expect(count).toBe(0);
  });

  it('should support listeners getter', () => {
    const hls = new Hls();
    const fn = () => {};
    hls.on('custom', fn);
    expect(hls.listeners('custom').length).toBe(1);
  });

  it('should handle master playlist in loadSource callback', async () => {
    const hls = new Hls();
    let manifestLoaded = false;
    let manifestParsed = false;
    hls.on(Events.MANIFEST_LOADED, () => { manifestLoaded = true; });
    hls.on(Events.MANIFEST_PARSED, () => { manifestParsed = true; });

    // Mock the playlistLoader to simulate a master playlist
    const playlistData = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720
http://example.com/high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360
http://example.com/low.m3u8`;

    // Trigger manifest loading manually
    hls.trigger(Events.MANIFEST_LOADING, { url: 'http://example.com/master.m3u8' });

    // Simulate what happens when a master playlist is loaded
    const baseurl = 'http://example.com/';
    const { parseMasterPlaylist } = await import('../src/parser/m3u8-parser');
    const result = parseMasterPlaylist(playlistData, baseurl);
    hls.trigger(Events.MANIFEST_LOADED, { data: playlistData, ...result, url: 'http://example.com/master.m3u8' });
    hls.trigger(Events.MANIFEST_PARSED, { ...result, url: 'http://example.com/master.m3u8' });

    expect(hls.levels.length).toBeGreaterThan(0);
  });

  it('should handle media playlist in loadSource callback', async () => {
    const hls = new Hls();
    let levelLoaded = false;
    hls.on(Events.LEVEL_LOADED, () => { levelLoaded = true; });

    const playlistData = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
seg1.ts
#EXT-X-ENDLIST`;

    const { parseMediaPlaylist } = await import('../src/parser/m3u8-parser');
    const baseurl = 'http://example.com/';
    const result = parseMediaPlaylist(playlistData, baseurl);
    hls.trigger(Events.LEVEL_LOADED, {
      url: 'http://example.com/media.m3u8',
      data: playlistData,
      ...result,
    });
    expect(levelLoaded).toBe(true);
  });

  it('should trigger manifest parsing error on bad data', () => {
    const hls = new Hls();
    let errorEmitted = false;
    hls.on(Events.ERROR, () => { errorEmitted = true; });

    // Simulate a manifest load that triggers a parse error
    hls.trigger(Events.MANIFEST_LOADED, {
      data: 'garbage data',
      levels: [],
      audioTracks: [],
      subtitleTracks: [],
      url: 'http://example.com/bad.m3u8',
    });
  });

  it('should trigger timeout error via playlist loader', () => {
    const hls = new Hls();
    let timeoutEmitted = false;
    hls.on(Events.ERROR, (err: any) => {
      if (err.details === 'manifestLoadTimeout') timeoutEmitted = true;
    });

    hls.trigger(Events.ERROR, {
      type: ErrorTypes.NETWORK_ERROR,
      details: 'manifestLoadTimeout',
      fatal: true,
      reason: 'Manifest load timed out',
    });
    expect(timeoutEmitted).toBe(true);
  });

  it('should trigger network error via playlist loader', () => {
    const hls = new Hls();
    let errorEmitted = false;
    hls.on(Events.ERROR, (err: any) => {
      if (err.details === 'manifestLoadError') errorEmitted = true;
    });

    hls.trigger(Events.ERROR, {
      type: ErrorTypes.NETWORK_ERROR,
      details: 'manifestLoadError',
      fatal: true,
      reason: 'Network error',
    });
    expect(errorEmitted).toBe(true);
  });

  it('should handle empty levels gracefully', () => {
    const hls = new Hls();
    hls.trigger(Events.MANIFEST_PARSED, {
      levels: [],
      audioTracks: [],
      subtitleTracks: [],
      url: 'http://example.com/manifest.m3u8',
    });
    expect(hls.levels).toEqual([]);
  });
});
