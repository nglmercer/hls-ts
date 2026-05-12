import { describe, it, expect } from 'bun:test';
import { initSegment, fragmentBox, type MP4Track, type MP4Sample } from '../src/remux/mp4-generator';
import { TrackTypes } from '../src/types';

describe('MP4 Generator', () => {
  const videoTrack: MP4Track = {
    id: 1,
    type: TrackTypes.VIDEO,
    timescale: 90000,
    duration: 0,
    width: 640,
    height: 480,
    codec: 'avc1.64001e',
    sps: [new Uint8Array([0x01, 0x64, 0x00, 0x1e, 0xff, 0xe1, 0x00, 0x19, 0x67, 0x64, 0x00, 0x1e, 0xac, 0x52, 0x0a, 0x6e, 0x08, 0x08, 0x20, 0x00, 0x00, 0x03, 0x00, 0x02, 0x00, 0x00, 0x03, 0x00, 0x78, 0x1e, 0x16, 0x2e, 0x48])],
    pps: [new Uint8Array([0x01, 0x68, 0xeb, 0xc3])],
  };

  const audioTrack: MP4Track = {
    id: 2,
    type: TrackTypes.AUDIO,
    timescale: 44100,
    duration: 0,
    codec: 'mp4a.40.2',
  };

  it('should generate init segment', () => {
    const init = initSegment([videoTrack, audioTrack]);
    expect(init.length).toBeGreaterThan(0);
    expect(init[0]).toBe(0); // box size first byte
    expect(init[4]).toBe(0x66); // 'f'
    expect(init[5]).toBe(0x74); // 't'
    expect(init[6]).toBe(0x79); // 'y'
    expect(init[7]).toBe(0x70); // 'p'
    expect(new TextDecoder().decode(init.subarray(4, 8))).toBe('ftyp');
  });

  it('should generate init segment for video-only', () => {
    const init = initSegment([videoTrack]);
    expect(init.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(init.subarray(4, 8))).toBe('ftyp');
  });

  it('should generate init segment for audio-only', () => {
    const init = initSegment([audioTrack]);
    expect(init.length).toBeGreaterThan(0);
  });

  it('should return empty for no tracks', () => {
    const init = initSegment([]);
    expect(init.length).toBe(0);
  });

  it('should generate fragment box with samples', () => {
    const sample: MP4Sample = {
      size: 100,
      duration: 3000,
      cts: 0,
      flags: { isLeading: 0, isDependedOn: 0, hasRedundancy: 0, degradPrio: 0, dependsOn: 2, isSync: true },
      data: new Uint8Array(100).fill(0x42),
    };

    const result = fragmentBox(videoTrack, [sample], 0);
    expect(result.moof.length).toBeGreaterThan(0);
    expect(result.mdat.length).toBeGreaterThan(0);
    expect(new TextDecoder().decode(result.moof.subarray(4, 8))).toBe('moof');
    expect(new TextDecoder().decode(result.mdat.subarray(4, 8))).toBe('mdat');
  });

  it('should generate fragment box with multiple samples', () => {
    const samples: MP4Sample[] = [
      { size: 50, duration: 3000, cts: 0, flags: { isLeading: 0, isDependedOn: 0, hasRedundancy: 0, degradPrio: 0, dependsOn: 2, isSync: true }, data: new Uint8Array(50).fill(0x42) },
      { size: 30, duration: 3000, cts: 100, flags: { isLeading: 0, isDependedOn: 0, hasRedundancy: 0, degradPrio: 0, dependsOn: 1, isSync: false }, data: new Uint8Array(30).fill(0x43) },
    ];

    const result = fragmentBox(videoTrack, samples, 1000);
    expect(result.moof.length).toBeGreaterThan(0);
    expect(result.mdat.length).toBe(8 + 80);
  });
});
