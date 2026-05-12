import { describe, it, expect } from 'bun:test';
import { EWMA, AbrController, GapController } from '../src/controller/abr-controller';

describe('EWMA', () => {
  it('should initialize with zero', () => {
    const ewma = new EWMA(0.5);
    expect(ewma.estimate).toBe(0);
    expect(ewma.samples).toBe(0);
    expect(ewma.total).toBe(0);
  });

  it('should converge to the input value with alpha=1', () => {
    const ewma = new EWMA(1);
    ewma.sample(1, 500);
    expect(ewma.estimate).toBe(500);
  });

  it('should smooth values with alpha < 1', () => {
    const ewma = new EWMA(0.5);
    ewma.sample(1, 100);
    expect(ewma.estimate).toBe(50);
    ewma.sample(1, 200);
    expect(ewma.estimate).toBe(125);
    ewma.sample(1, 300);
    expect(ewma.estimate).toBe(212.5);
  });

  it('should track total and sample count', () => {
    const ewma = new EWMA(0.3);
    ewma.sample(1, 1000);
    ewma.sample(1, 2000);
    expect(ewma.total).toBe(3000);
    expect(ewma.samples).toBe(2);
  });

  it('should handle many samples', () => {
    const ewma = new EWMA(0.1);
    for (let i = 0; i < 100; i++) {
      ewma.sample(1, 1000);
    }
    expect(ewma.samples).toBe(100);
    expect(ewma.estimate).toBeCloseTo(1000, -1);
  });
});

describe('AbrController', () => {
  it('should create with default state', () => {
    const hlsMock = { config: { abrController: { abrEwmaFastVoD: 3, abrEwmaSlowVoD: 9 } } };
    const abr = new AbrController(hlsMock);
    expect(abr.bwEstimate).toBe(0);
  });

  it('should select level 0 when no levels', () => {
    const hlsMock = { config: { abrController: { abrEwmaFastVoD: 3, abrEwmaSlowVoD: 9 } } };
    const abr = new AbrController(hlsMock);
    expect(abr.getNextLevel(1000000)).toBe(0);
  });

  it('should select appropriate level based on bandwidth', () => {
    const hlsMock = { config: { abrController: { abrEwmaFastVoD: 3, abrEwmaSlowVoD: 9 } } };
    const abr = new AbrController(hlsMock);

    (abr as unknown as { _onManifestParsed: (data: { levels: any[] }) => void })._onManifestParsed({
      levels: [
        { id: 0, bitrate: 500000, width: 640, height: 360 },
        { id: 1, bitrate: 1000000, width: 854, height: 480 },
        { id: 2, bitrate: 2000000, width: 1280, height: 720 },
      ] as any,
    });

    expect(abr.getNextLevel(300000)).toBe(0);
    expect(abr.getNextLevel(500000)).toBe(0);
    expect(abr.getNextLevel(800000)).toBe(0);
    expect(abr.getNextLevel(1000000)).toBe(1);
    expect(abr.getNextLevel(1500000)).toBe(1);
    expect(abr.getNextLevel(2000000)).toBe(2);
    expect(abr.getNextLevel(5000000)).toBe(2);
  });

  it('should process frag loaded stats', () => {
    const hlsMock = {
      config: {
        abrController: {
          abrEwmaFastVoD: 3,
          abrEwmaSlowVoD: 9,
          abrBandWidthFactor: 0.95,
          abrBandWidthUpFactor: 0.7,
        },
      },
    };
    const abr = new AbrController(hlsMock);

    const now = performance.now();
    (abr as unknown as { _onFragLoaded: (data: { frag: any; stats: any }) => void })._onFragLoaded({
      frag: { sn: 1, level: 0 } as any,
      stats: { loaded: 500000, trequest: now - 1000, tfirst: now - 900, tload: now } as any,
    });

    expect(abr.bwEstimate).toBeGreaterThan(0);
  });
});

describe('GapController', () => {
  it('should create and destroy', () => {
    const gc = new GapController();
    gc.destroy();
  });

  it('should handle media attach/detach', () => {
    const gc = new GapController();
    (gc as unknown as { _onMediaAttached: (data: { media: any }) => void })._onMediaAttached({ media: { currentTime: 10, buffered: { length: 0 }, seeking: false, paused: false } as any });
    (gc as unknown as { _onMediaDetached: () => void })._onMediaDetached();
  });

  it('should not throw on buffer flushed without media', () => {
    const gc = new GapController();
    (gc as unknown as { _onBufferFlushed: () => void })._onBufferFlushed();
  });
});
