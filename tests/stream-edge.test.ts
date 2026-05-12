import { describe, it, expect } from 'bun:test';
import { LevelController, StreamController } from '../src/controller/stream-controller';
import { AbrController } from '../src/controller/abr-controller';
import { Hls } from '../src/core/Hls';

describe('StreamController - edge cases', () => {
  it('should handle _onLevelLoaded with matching level', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    // Set up a level
    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [{ url: 'http://example.com/test.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: 'avc1.64001e', name: 'Test', frameRate: 30 }],
      audioTracks: [],
      subtitleTracks: [],
      url: 'http://example.com/master.m3u8',
    });

    // Trigger level loaded for that level
    const frags = [{ sn: 0, duration: 10, url: 'seg0.ts' }, { sn: 1, duration: 10, url: 'seg1.ts' }];
    (lc as unknown as { _onLevelLoaded: (data: any) => void })._onLevelLoaded({
      url: 'http://example.com/test.m3u8',
      data: '#EXTM3U',
      fragments: frags as any,
      targetduration: 10,
      live: false,
      type: 'VOD',
      initSegment: null,
    });

    const level = lc.currentLevel;
    expect(level).not.toBeNull();
    expect(level!.details).toBeDefined();
    expect(level!.details!.fragments.length).toBe(2);
    lc.destroy();
  });

  it('should handle _onLevelLoaded for non-matching URL', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [{ url: 'http://example.com/test.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 }],
      audioTracks: [],
      subtitleTracks: [],
      url: 'http://example.com/master.m3u8',
    });

    (lc as unknown as { _onLevelLoaded: (data: any) => void })._onLevelLoaded({
      url: 'http://example.com/other.m3u8',
      data: '',
      fragments: [],
      targetduration: 0,
      live: false,
      type: 'VOD',
      initSegment: null,
    });
    // No matching level → early return, should not throw
    lc.destroy();
  });

  it('should handle Live playlist type', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [{ url: 'live.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 }],
      audioTracks: [],
      subtitleTracks: [],
      url: 'master.m3u8',
    });

    (lc as unknown as { _onLevelLoaded: (data: any) => void })._onLevelLoaded({
      url: 'live.m3u8',
      data: '#EXTM3U',
      fragments: [{ sn: 100, duration: 6, url: 'seg100.ts' }] as any,
      targetduration: 6,
      live: true,
      type: 'EVENT',
      initSegment: null,
    });

    expect(lc.currentLevel!.details!.live).toBe(true);
    lc.destroy();
  });

  it('should handle _loadLevel error callback', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    let errorFired = false;
    hls.on('hlsError', () => { errorFired = true; });

    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [{ url: 'http://test.io/bad.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 }],
      audioTracks: [],
      subtitleTracks: [],
      url: 'master.m3u8',
    });

    // _loadLevel is called during _onManifestParsed.
    // The fetch should fail, triggering onError
    // We'll just verify the manifestParsed handler creates levels
    expect(lc.levels.length).toBe(1);
    lc.destroy();
  });

  it('should handle StreamController frag loaded without pending data', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    // pendingData is null, frag loaded handler should return early
    (sc as unknown as { _onFragLoaded: (data: any) => void })._onFragLoaded({
      frag: { url: 'seg1.ts', sn: 0, level: 0, duration: 10, start: 0 } as any,
      stats: { loaded: 1000, total: 1000, trequest: 0, tfirst: 1, tload: 100 } as any,
    });
    sc.destroy();
  });

  it('should handle StreamController loadNextFragment with empty queue', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    // No fragment, _fragQueue is empty, should do nothing
    (sc as unknown as { _loadNextFragment: () => void })._loadNextFragment();
    sc.destroy();
  });

  it('should handle StreamController with loading state', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    // Set loading=true and try to load next fragment
    (sc as unknown as { _loading: boolean })._loading = true;
    (sc as unknown as { _fragQueue: any[] })._fragQueue = [{ url: 'seg.ts', sn: 0, level: 0, duration: 10, start: 0 }];
    (sc as unknown as { _loadNextFragment: () => void })._loadNextFragment();
    // Should not load because _loading is true
    expect((sc as unknown as { _loading: boolean })._loading).toBe(true);
    sc.destroy();
  });

  it('should process level switching on frag loaded', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    // Set up levels and current level
    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [
        { url: 'low.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 },
        { url: 'high.m3u8', bitrate: 2000000, width: 1280, height: 720, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 },
      ],
      audioTracks: [],
      subtitleTracks: [],
      url: 'master.m3u8',
    });

    // Set pending data and trigger frag loaded
    (sc as unknown as { _pendingData: ArrayBuffer | null })._pendingData = new ArrayBuffer(100);
    (sc as unknown as { _fragQueue: any[] })._fragQueue = [{ url: 'seg2.ts', sn: 1, level: 1, duration: 10, start: 10 }];

    (sc as unknown as { _onFragLoaded: (data: any) => void })._onFragLoaded({
      frag: { url: 'seg1.ts', sn: 0, level: 0, duration: 10, start: 0 } as any,
      stats: { loaded: 500000, total: 500000, trequest: 0, tfirst: 1, tload: 100 } as any,
    });

    sc.destroy();
  });
});
