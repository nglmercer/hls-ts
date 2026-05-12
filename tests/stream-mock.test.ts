import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Hls } from '../src/core/Hls';
import { LevelController, StreamController } from '../src/controller/stream-controller';
import { AbrController } from '../src/controller/abr-controller';
import { Events, ErrorTypes, type HlsError } from '../src/types';

describe('LevelController - load level callbacks', () => {
  it('should trigger onError callback via mocked playlist loader', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    // Replace playlist loader with mock that calls onError
    (lc as unknown as { _playlistLoader: any })._playlistLoader = {
      load: (_ctx: any, callbacks: { onError: Function }) => {
        callbacks.onError({ code: 500, text: 'Server Error' }, _ctx);
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false },
      abort: () => {},
    };

    let errorTriggered = false;
    hls.on(Events.ERROR, (err: HlsError) => {
      if (err.details === 'levelLoadError') errorTriggered = true;
    });

    // Trigger loading via manifest parsed
    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [{ url: 'http://test.com/playlist.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 }],
      audioTracks: [], subtitleTracks: [], url: 'http://test.com/master.m3u8',
    });

    expect(errorTriggered).toBe(true);
    lc.destroy();
  });

  it('should trigger onTimeout callback via mocked playlist loader', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    (lc as unknown as { _playlistLoader: any })._playlistLoader = {
      load: (_ctx: any, callbacks: { onTimeout: Function }) => {
        callbacks.onTimeout({ loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false }, _ctx);
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false },
      abort: () => {},
    };

    let timeoutTriggered = false;
    hls.on(Events.ERROR, (err: HlsError) => {
      if (err.details === 'levelLoadTimeout') timeoutTriggered = true;
    });

    (lc as any)._onManifestParsed({
      levels: [{ url: 'http://test.com/playlist.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 }],
      audioTracks: [], subtitleTracks: [], url: 'http://test.com/master.m3u8',
    });

    expect(timeoutTriggered).toBe(true);
    lc.destroy();
  });

  it('should trigger onSuccess callback via mocked playlist loader', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    (lc as unknown as { _playlistLoader: any })._playlistLoader = {
      load: (_ctx: any, callbacks: { onSuccess: Function }) => {
        callbacks.onSuccess(
          { url: 'http://test.com/playlist.m3u8', data: '#EXTM3U\n#EXTINF:10,\nseg.ts\n#EXT-X-ENDLIST', stats: {} },
          { loaded: 100, total: 100, trequest: 0, tfirst: 1, tload: 50 },
          _ctx,
        );
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false },
      abort: () => {},
    };

    let levelLoaded = false;
    hls.on(Events.LEVEL_LOADED, () => { levelLoaded = true; });

    (lc as any)._onManifestParsed({
      levels: [{ url: 'http://test.com/playlist.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 }],
      audioTracks: [], subtitleTracks: [], url: 'http://test.com/master.m3u8',
    });

    expect(levelLoaded).toBe(true);
    lc.destroy();
  });
});

describe('StreamController - _doLoad callbacks', () => {
  it('should trigger onError callback from fragment loader', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    // Queue a fragment and replace fragment loader with mock
    (sc as unknown as { _fragQueue: any[] })._fragQueue = [{ url: 'http://test.com/seg.ts', sn: 0, level: 0, duration: 10, start: 0 }];
    (sc as unknown as { _fragmentLoader: any })._fragmentLoader = {
      load: (_ctx: any, callbacks: { onError: Function }) => {
        callbacks.onError({ code: 500, text: 'Server Error' }, _ctx);
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false, loading: false },
      abort: () => {},
    };

    let errorFired = false;
    hls.on(Events.ERROR, (err: HlsError) => {
      if (err.details === 'fragLoadError') errorFired = true;
    });

    (sc as any)._doLoad();

    expect(errorFired).toBe(true);
    sc.destroy();
  });

  it('should trigger onTimeout callback from fragment loader', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    (sc as unknown as { _fragQueue: any[] })._fragQueue = [{ url: 'http://test.com/seg.ts', sn: 0, level: 0, duration: 10, start: 0 }];
    (sc as unknown as { _fragmentLoader: any })._fragmentLoader = {
      load: (_ctx: any, callbacks: { onTimeout: Function }) => {
        callbacks.onTimeout(
          { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 100, aborted: false, loading: false },
          _ctx,
        );
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false, loading: false },
      abort: () => {},
    };

    let timeoutFired = false;
    hls.on(Events.ERROR, (err: HlsError) => {
      if (err.details === 'fragLoadTimeout') timeoutFired = true;
    });

    (sc as any)._doLoad();

    expect(timeoutFired).toBe(true);
    sc.destroy();
  });

  it('should trigger onSuccess callback from fragment loader', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    (sc as unknown as { _fragQueue: any[] })._fragQueue = [{ url: 'http://test.com/seg.ts', sn: 0, level: 0, duration: 10, start: 0 }];
    (sc as unknown as { _fragmentLoader: any })._fragmentLoader = {
      load: (_ctx: any, callbacks: { onSuccess: Function }) => {
        callbacks.onSuccess(
          { url: 'http://test.com/seg.ts', data: new ArrayBuffer(10), stats: { loaded: 10, total: 10, trequest: 0, tfirst: 1, tload: 50, aborted: false, loading: false } },
          { loaded: 10, total: 10, trequest: 0, tfirst: 1, tload: 50, aborted: false, loading: false },
          _ctx,
        );
      },
      stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false, loading: false },
      abort: () => {},
    };

    let fragLoaded = false;
    hls.on(Events.FRAG_LOADED, () => { fragLoaded = true; });

    (sc as any)._doLoad();

    expect(fragLoaded).toBe(true);
    expect((sc as unknown as { _pendingData: any })._pendingData).not.toBeNull();
    sc.destroy();
  });

  it('should handle empty frag queue in _doLoad', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    (sc as unknown as { _fragQueue: any[] })._fragQueue = [];
    (sc as unknown as { _doLoad: () => void })._doLoad();

    expect((sc as unknown as { _loading: boolean })._loading).toBe(false);
    sc.destroy();
  });
});
