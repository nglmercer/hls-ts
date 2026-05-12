import { describe, it, expect } from 'bun:test';
import { TSDemuxer } from '../src/remux/tsdemuxer';
import { initSegment, fragmentBox, type MP4Track, type MP4Sample } from '../src/remux/mp4-generator';
import { Remuxer } from '../src/remux/remuxer';

describe('TSDemuxer - remaining paths', () => {
  it('setVideoMeta should not throw when no videoTrack', () => {
    const demuxer = new TSDemuxer();
    // _videoTrack is undefined, should return early
    (demuxer as any).setVideoMeta(640, 480, [new Uint8Array([0x01, 0x64, 0x00, 0x1e])], []);
  });

  it('setVideoMeta should update codec from SPS', () => {
    const demuxer = new TSDemuxer();
    // Add a video track first
    (demuxer as any).addVideoSample({
      size: 10, duration: 3000, dts: 0, pts: 0, keyframe: true,
      data: new Uint8Array(10),
    });

    // SPS with known profile/level
    const sps = new Uint8Array([
      0x01, 0x64, 0x00, 0x1e, 0xff, 0xe1, 0x00, 0x19,
      0x67, 0x64, 0x00, 0x2a, 0xac, 0x52,
    ]);
    (demuxer as any).setVideoMeta(1280, 720, [sps], [new Uint8Array([0x01, 0x68, 0xeb])]);

    const vt = (demuxer as any)._videoTrack;
    expect(vt.width).toBe(1280);
    expect(vt.height).toBe(720);
    expect(vt.codec).toContain('avc1');
  });

  it('setAudioConfig should not throw when no audioTrack', () => {
    const demuxer = new TSDemuxer();
    (demuxer as any).setAudioConfig(new Uint8Array(2), 44100, 2);
  });

  it('setAudioConfig should update existing track', () => {
    const demuxer = new TSDemuxer();
    (demuxer as any).addAudioSample({
      size: 8, duration: 1024, dts: 0, pts: 0, data: new Uint8Array(8),
    });
    (demuxer as any).setAudioConfig(new Uint8Array([0x12, 0x34]), 48000, 6);
    const at = (demuxer as any)._audioTrack;
    expect(at.sampleRate).toBe(48000);
    expect(at.channelCount).toBe(6);
  });

  it('should handle adaptation field in TS packet', () => {
    const demuxer = new TSDemuxer();
    // Build a PAT packet with adaptation field
    const buf = new Uint8Array(188).fill(0xff);
    buf[0] = 0x47;
    buf[1] = 0x40; // payloadUnitStart + PID=0
    buf[2] = 0x00;
    buf[3] = 0x60; // adaptation + payload
    buf[4] = 0x02; // adaptation length = 2
    buf[5] = 0x00; // adaptation data
    buf[6] = 0x00;
    buf[7] = 0x00; // pointer_field = 0
    buf[8] = 0x00; // table_id PAT
    buf[9] = 0x30;
    buf[10] = 0x0d;
    buf[11] = 0x00; buf[12] = 0x01;
    buf[13] = 0xc1; buf[14] = 0x00; buf[15] = 0x00;
    buf[16] = 0x00; buf[17] = 0x01;
    buf[18] = 0xf0; buf[19] = 0x01;

    demuxer.demux(buf, 0);
    expect((demuxer as any)._pmtPid).toBe(0x1001);
  });

  it('should handle PES continuation packets within same demux', () => {
    const demuxer = new TSDemuxer();
    const pids: Map<number, string> = (demuxer as any)._pids;
    pids.set(0x101, 'video');

    // Two TS packets for the same PES: start + continuation
    const pkt1 = new Uint8Array(188).fill(0xff);
    pkt1[0] = 0x47; pkt1[1] = 0x41; pkt1[2] = 0x01; pkt1[3] = 0x50;
    pkt1[4] = 0x00; pkt1[5] = 0x00; pkt1[6] = 0x01; pkt1[7] = 0xe0;
    pkt1[8] = 0x00; pkt1[9] = 0x00; pkt1[10] = 0x80; pkt1[11] = 0x80;
    pkt1[12] = 5; pkt1[13] = 0x21; pkt1[14] = 0x00; pkt1[15] = 0x01;
    pkt1[16] = 0x00; pkt1[17] = 0x01;
    pkt1[18] = 0x00; pkt1[19] = 0x00; pkt1[20] = 0x00; pkt1[21] = 0x01;
    pkt1[22] = 0x67; pkt1[23] = 0x64; pkt1[24] = 0x00; pkt1[25] = 0x1e;
    pkt1[26] = 0x00; pkt1[27] = 0x00; pkt1[28] = 0x00; pkt1[29] = 0x01;
    pkt1[30] = 0x65; pkt1[31] = 0x88;

    // Continuation packet (unitStart = false, same PID)
    const pkt2 = new Uint8Array(188).fill(0xff);
    pkt2[0] = 0x47; pkt2[1] = 0x01; pkt2[2] = 0x01; pkt2[3] = 0x10;
    pkt2[4] = 0xaa; pkt2[5] = 0xbb; // continuation data

    // Combine both packets in one buffer
    const allData = new Uint8Array(188 * 2);
    allData.set(pkt1);
    allData.set(pkt2, 188);

    const result = demuxer.demux(allData, 0);
    // Video should be processed from the continuation
    expect(result.videoTrack).toBeDefined();
  });

  it('should handle addVideoSample when videoTrack exists', () => {
    const demuxer = new TSDemuxer();
    (demuxer as any).addVideoSample({
      size: 10, duration: 3000, dts: 0, pts: 0, keyframe: true,
      data: new Uint8Array(10),
    });
    (demuxer as any).addVideoSample({
      size: 5, duration: 3000, dts: 3000, pts: 3000, keyframe: false,
      data: new Uint8Array(5),
    });
    const vt = (demuxer as any)._videoTrack;
    expect(vt.samples.length).toBe(2);
  });
});

describe('MP4 Generator - edge cases', () => {
  it('should generate codec string for sps with profile 100', () => {
    const track: MP4Track = {
      id: 1, type: 'video', timescale: 90000, duration: 0,
      width: 1920, height: 1080, codec: 'avc1.64001e',
      sps: [new Uint8Array([0x01, 0x64, 0x00, 0x1e, 0xff, 0xe1, 0x00, 0x19, 0x67, 0x64, 0x00, 0x2a])],
      pps: [new Uint8Array([0x01, 0x68, 0xeb, 0xc3])],
    };
    const init = initSegment([track]);
    expect(init.length).toBeGreaterThan(0);
  });

  it('should handle tracks with no sps/pps', () => {
    const track: MP4Track = {
      id: 1, type: 'video', timescale: 90000, duration: 0,
      width: 640, height: 480, codec: 'avc1.unknown',
    };
    const init = initSegment([track]);
    expect(init.length).toBeGreaterThan(0);
  });

  it('should handle fragmentBox with non-sync sample', () => {
    const track: MP4Track = {
      id: 1, type: 'video', timescale: 90000, duration: 3000,
      width: 640, height: 480, codec: 'avc1.64001e',
    };
    const samples: MP4Sample[] = [
      { size: 100, duration: 3000, cts: 0, flags: { isLeading: 0, isDependedOn: 0, hasRedundancy: 0, degradPrio: 0, dependsOn: 1, isSync: false }, data: new Uint8Array(100).fill(0x42) },
    ];
    const result = fragmentBox(track, samples, 1000);
    expect(result.moof.length).toBeGreaterThan(0);
    expect(result.mdat.length).toBeGreaterThan(0);
  });

  it('should handle empty samples array', () => {
    const track: MP4Track = {
      id: 1, type: 'video', timescale: 90000, duration: 0,
      width: 640, height: 480, codec: 'avc1.64001e',
    };
    const result = fragmentBox(track, [], 0);
    expect(result.mdat.length).toBe(8); // just the mdat box header
  });
  it('should handle fragmentBox with sync flag false', () => {
    const track: MP4Track = {
      id: 1, type: 'video', timescale: 90000, duration: 0,
      width: 640, height: 480, codec: 'avc1.64001e',
      sps: [new Uint8Array([0x01, 0x64, 0x00, 0x1e]), new Uint8Array([0x01, 0x64, 0x00, 0x2a])],
      pps: [new Uint8Array([0x01, 0x68, 0xeb])],
    };
    const sample: MP4Sample = {
      size: 50, duration: 3000, cts: 100,
      flags: { isLeading: 0, isDependedOn: 1, hasRedundancy: 0, degradPrio: 0, dependsOn: 1, isSync: false },
      data: new Uint8Array(50).fill(0xaa),
    };
    const result = fragmentBox(track, [sample], 5000);
    expect(result.moof).toBeDefined();
  });

  it('should handle empty samples in fragment', () => {
    const track: MP4Track = {
      id: 1, type: 'video', timescale: 90000, duration: 0,
      width: 640, height: 480, codec: 'avc1.64001e',
    };
    const result = fragmentBox(track, [], 0);
    expect(result.mdat.length).toBe(8);
  });
});

describe('Remuxer - edge cases', () => {
  it('should handle missing video track in DemuxResult', () => {
    const remuxer = new Remuxer();
    // Only audio
    const result = remuxer.remux({
      audioTrack: {
        type: 'audio', id: 2, timescale: 44100, duration: 0,
        codec: 'mp4a.40.2', channelCount: 2, sampleRate: 44100,
        config: new Uint8Array(2),
        samples: [{ size: 8, duration: 1024, dts: 0, pts: 0, data: new Uint8Array(8) }],
      },
    });
    expect(result.initSegment).toBeDefined();
    expect(result.audioData).toBeDefined();
  });

  it('should handle empty DemuxResult after first remux', () => {
    const remuxer = new Remuxer();
    const firstResult = remuxer.remux({});
    expect(firstResult.initSegment).toBeUndefined();

    resetRemuxState(remuxer);

    const secondResult = remuxer.remux({});
    expect(secondResult.initSegment).toBeUndefined();
  });
});

function resetRemuxState(remuxer: Remuxer): void {
  (remuxer as any)._initSent = true;
}
