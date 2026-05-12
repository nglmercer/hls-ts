import { describe, it, expect, beforeAll } from 'bun:test';
import { Hls } from '../src/core/Hls';
import { Events } from '../src/types/events';
import { LevelController } from '../src/controller/level-controller';
import { StreamController } from '../src/controller/stream-controller';
import { AbrController } from '../src/controller/abr-controller';

describe('LevelController', () => {
  it('should create with no levels', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    expect(lc.levels).toEqual([]);
    expect(lc.currentLevel).toBeNull();
    lc.destroy();
  });

  it('should handle manifest parsed with levels', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [
        { url: 'http://example.com/low.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: 'avc1.64001e,mp4a.40.2', name: 'Low', frameRate: 30 },
        { url: 'http://example.com/high.m3u8', bitrate: 2000000, width: 1280, height: 720, audioCodec: '', videoCodec: '', codecSet: 'avc1.64001e,mp4a.40.2', name: 'High', frameRate: 30 },
      ],
      audioTracks: [],
      subtitleTracks: [],
      url: 'http://example.com/master.m3u8',
    });

    expect(lc.levels.length).toBe(2);
    expect(lc.currentLevel).not.toBeNull();
    expect(lc.currentLevel!.bitrate).toBe(500000);
    lc.destroy();
  });

  it('should use configured start level', () => {
    const hls = new Hls({ startLevel: 1 });
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [
        { url: 'low.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 },
        { url: 'high.m3u8', bitrate: 2000000, width: 1280, height: 720, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 },
      ],
      audioTracks: [],
      subtitleTracks: [],
      url: 'master.m3u8',
    });

    expect(lc.currentLevel!.bitrate).toBe(2000000);
    lc.destroy();
  });

  it('should handle level loading event', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    (lc as unknown as { _onLevelLoading: (data: any) => void })._onLevelLoading({ url: 'test.m3u8' });
    lc.destroy();
  });

  it('should load a specific level by id', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);

    (lc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [
        { url: 'low.m3u8', bitrate: 500000, width: 640, height: 360, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 },
        { url: 'high.m3u8', bitrate: 2000000, width: 1280, height: 720, audioCodec: '', videoCodec: '', codecSet: '', name: '', frameRate: 0 },
      ],
      audioTracks: [],
      subtitleTracks: [],
      url: 'master.m3u8',
    });

    lc.loadLevel(1);
    expect(lc.currentLevel).not.toBeNull();
    expect(lc.currentLevel!.bitrate).toBe(2000000);
    lc.destroy();
  });
});

describe('StreamController', () => {
  it('should create and destroy', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);
    sc.destroy();
  });

  it('should handle media attach/detach', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    (sc as unknown as { _onMediaAttached: (data: any) => void })._onMediaAttached({ 
      media: { 
        currentTime: 0,
        addEventListener: () => {},
        removeEventListener: () => {},
      } 
    });
    (sc as unknown as { _onMediaDetached: () => void })._onMediaDetached();
    sc.destroy();
  });

  it('should handle manifest parsed event', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    (sc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({
      levels: [],
      audioTracks: [],
      subtitleTracks: [],
      url: 'master.m3u8',
    });
    sc.destroy();
  });

  it('should handle frag loaded event', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    (sc as unknown as { _onFragLoaded: (data: any) => void })._onFragLoaded({
      frag: { url: 'seg1.ts', sn: 0, level: 0, duration: 10, start: 0 },
      stats: { loaded: 10000, total: 10000, trequest: 0, tfirst: 1, tload: 100 },
    });
    sc.destroy();
  });

  it('should handle frag loaded with pending data', () => {
    const hls = new Hls();
    const abr = new AbrController(hls);
    const lc = new LevelController(hls, abr);
    const sc = new StreamController(hls, lc, abr);

    (sc as unknown as { _pendingData: ArrayBuffer | null })._pendingData = new ArrayBuffer(100);
    (sc as unknown as { _onFragLoaded: (data: any) => void })._onFragLoaded({
      frag: { url: 'seg1.ts', sn: 0, level: 0, duration: 10, start: 0 },
      stats: { loaded: 10000, total: 10000, trequest: 0, tfirst: 1, tload: 100 },
    });
    sc.destroy();
  });
});
