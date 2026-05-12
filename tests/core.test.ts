import { describe, it, expect } from 'bun:test';
import { EventEmitter } from '../src/core/EventEmitter';
import { Hls } from '../src/core/Hls';
import { defaultConfig } from '../src/types/config';
import { parseMasterPlaylist, parseMediaPlaylist } from '../src/parser/m3u8-parser';
import { EWMA } from '../src/controller/abr-controller';

describe('EventEmitter', () => {
  it('should emit and listen to events', () => {
    const ee = new EventEmitter();
    let called = false;
    ee.on('test', () => { called = true; });
    ee.emit('test');
    expect(called).toBe(true);
  });

  it('should support once listeners', () => {
    const ee = new EventEmitter();
    let count = 0;
    ee.once('test', () => { count++; });
    ee.emit('test');
    ee.emit('test');
    expect(count).toBe(1);
  });

  it('should support off listeners', () => {
    const ee = new EventEmitter();
    let called = false;
    const fn = () => { called = true; };
    ee.on('test', fn);
    ee.off('test', fn);
    ee.emit('test');
    expect(called).toBe(false);
  });

  it('should remove all listeners', () => {
    const ee = new EventEmitter();
    let count = 0;
    ee.on('a', () => count++);
    ee.on('b', () => count++);
    ee.removeAllListeners();
    ee.emit('a');
    ee.emit('b');
    expect(count).toBe(0);
  });
});

describe('Hls', () => {
  it('should create instance with default config', () => {
    const hls = new Hls();
    expect(hls.config).toBeDefined();
    expect(hls.config.debug).toBe(false);
  });

  it('should merge user config with defaults', () => {
    const hls = new Hls({ debug: true, startLevel: 3 });
    expect(hls.config.debug).toBe(true);
    expect(hls.config.startLevel).toBe(3);
  });

  it('should support static isSupported checks', () => {
    expect(typeof Hls.isSupported).toBe('function');
    expect(typeof Hls.isMSESupported).toBe('function');
  });

  it('should trigger events on loadSource', () => {
    const hls = new Hls();
    let manifestLoading = false;
    hls.on('manifestLoading', () => { manifestLoading = true; });
    hls.loadSource('https://example.com/manifest.m3u8');
    expect(manifestLoading).toBe(true);
  });
});

describe('Config', () => {
  it('should have reasonable default values', () => {
    expect(defaultConfig.maxBufferLength).toBe(30);
    expect(defaultConfig.liveSyncDurationCount).toBe(3);
    expect(defaultConfig.abrController.abrEwmaFastVoD).toBe(3);
    expect(defaultConfig.fragLoadPolicy.maxLoadTimeMs).toBe(100000);
  });
});

describe('M3U8 Parser', () => {
  it('should parse master playlist', () => {
    const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1280000,RESOLUTION=1280x720,CODECS="avc1.64001e,mp4a.40.2"
high.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=640000,RESOLUTION=852x480,CODECS="avc1.64001e,mp4a.40.2"
low.m3u8`;
    const result = parseMasterPlaylist(playlist, 'http://example.com/');
    expect(result.levels.length).toBe(2);
    expect(result.levels[0].bitrate).toBe(1280000);
    expect(result.levels[0].width).toBe(1280);
    expect(result.levels[0].height).toBe(720);
    expect(result.levels[1].bitrate).toBe(640000);
  });

  it('should parse media playlist with fragments', () => {
    const playlist = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10.000,
segment0.ts
#EXTINF:10.000,
segment1.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.fragments.length).toBe(2);
    expect(result.targetduration).toBe(10);
    expect(result.live).toBe(false);
    expect(result.fragments[0].sn).toBe(0);
    expect(result.fragments[0].duration).toBe(10);
    expect(result.fragments[1].sn).toBe(1);
  });

  it('should detect live playlists', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
segment0.ts`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.live).toBe(true);
  });

  it('should parse alternative audio tracks', () => {
    const playlist = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",LANGUAGE="en",URI="audio.m3u8",DEFAULT=YES,AUTOSELECT=YES
#EXT-X-STREAM-INF:BANDWIDTH=1000000,CODECS="avc1.64001e,mp4a.40.2",AUDIO="audio"
video.m3u8`;
    const result = parseMasterPlaylist(playlist, 'http://example.com/');
    expect(result.audioTracks.length).toBe(1);
    expect(result.audioTracks[0].language).toBe('en');
    expect(result.audioTracks[0].default).toBe(true);
    expect(result.levels.length).toBe(1);
  });

  it('should resolve relative URLs', () => {
    const playlist = `#EXTINF:10.000,
segment.ts`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/video/playlist.m3u8');
    expect(result.fragments[0].url).toBe('http://example.com/video/segment.ts');
  });
});

describe('EWMA', () => {
  it('should estimate bandwidth', () => {
    const ewma = new EWMA(1 / 3);
    ewma.sample(1, 1000);
    ewma.sample(1, 2000);
    ewma.sample(1, 3000);
    expect(ewma.estimate).toBeGreaterThan(0);
    expect(ewma.samples).toBe(3);
    expect(ewma.total).toBe(6000);
  });

  it('should handle single sample', () => {
    const ewma = new EWMA(1);
    ewma.sample(1, 5000);
    expect(ewma.estimate).toBe(5000);
  });
});
