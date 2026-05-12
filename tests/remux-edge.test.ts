import { describe, it, expect } from 'bun:test';
import { TSDemuxer } from '../src/remux/tsdemuxer';
import { TrackTypes } from '../src/types';
import { type DemuxedVideoTrack, type DemuxedAudioTrack } from '../src/remux/types';
import { initSegment, fragmentBox, type MP4Track, type MP4Sample } from '../src/remux/mp4-generator';
import { Remuxer } from '../src/remux/remuxer';
import { ExpGolombReader, parseSPS } from '../src/remux/exp-golomb';
import { AacStream } from '../src/remux/aac-stream';
import { AvcStream } from '../src/remux/avc-stream';

describe('TSDemuxer - remaining paths', () => {
  it('setVideoMeta should not throw when no videoTrack', () => {
    const demuxer = new TSDemuxer();
    demuxer.setVideoMeta(640, 480, [new Uint8Array([0x01, 0x64, 0x00, 0x1e])], []);
  });

  it('setVideoMeta should update codec from SPS', () => {
    const demuxer = new TSDemuxer();
    demuxer.addVideoSample({
      size: 10, duration: 3000, dts: 0, pts: 0, keyframe: true,
      data: new Uint8Array(10),
    });

    const sps = new Uint8Array([
      0x01, 0x64, 0x00, 0x1e, 0xff, 0xe1, 0x00, 0x19,
      0x67, 0x64, 0x00, 0x2a, 0xac, 0x52,
    ]);
    demuxer.setVideoMeta(1280, 720, [sps], [new Uint8Array([0x01, 0x68, 0xeb])]);

    const vt = (demuxer as any)._videoTrack;
    expect(vt.width).toBe(1280);
    expect(vt.height).toBe(720);
    expect(vt.codec).toContain('avc1');
  });

  it('setAudioConfig should update existing track', () => {
    const demuxer = new TSDemuxer();
    demuxer.addAudioSample({
      size: 8, duration: 1024, dts: 0, pts: 0, data: new Uint8Array(8),
    });
    demuxer.setAudioConfig(new Uint8Array([0x12, 0x34]), 48000, 6);
    const at = (demuxer as any)._audioTrack;
    expect(at.sampleRate).toBe(48000);
    expect(at.channelCount).toBe(6);
  });

  it('should handle adaptation field in TS packet', () => {
    const demuxer = new TSDemuxer();
    const buf = new Uint8Array(188).fill(0xff);
    buf[0] = 0x47;
    buf[1] = 0x40;
    buf[2] = 0x00;
    buf[3] = 0x70;
    buf[4] = 0x02;
    buf[5] = 0x00;
    buf[6] = 0x00;
    buf[7] = 0x00;
    buf[8] = 0x00;
    buf[9] = 0x30;
    buf[10] = 0x0d;
    buf[11] = 0x00; buf[12] = 0x01;
    buf[13] = 0xc1; buf[14] = 0x00; buf[15] = 0x00;
    buf[16] = 0x00; buf[17] = 0x01;
    buf[18] = 0xf0; buf[19] = 0x01;

    demuxer.demux(buf, 0);
    expect((demuxer as any)._pmtPid).toBe(0x1001);
  });
});

describe('ExpGolombReader', () => {
  it('should read bits correctly', () => {
    const data = new Uint8Array([0b10101010, 0b11110000]);
    const reader = new ExpGolombReader(data);
    expect(reader.readBits(1)).toBe(1);
    expect(reader.readBits(1)).toBe(0);
    expect(reader.readBits(2)).toBe(2); // 10
    expect(reader.readBits(4)).toBe(10); // 1010
    expect(reader.readBits(4)).toBe(15); // 1111
  });

  it('should read UEG correctly', () => {
    // UEG 0 = 1
    // UEG 1 = 010
    // UEG 2 = 011
    // UEG 3 = 00100
    const data = new Uint8Array([0b10100110, 0b01000000]);
    const reader = new ExpGolombReader(data);
    expect(reader.readUEG()).toBe(0); // 1
    expect(reader.readUEG()).toBe(1); // 010
    expect(reader.readUEG()).toBe(2); // 011
    expect(reader.readUEG()).toBe(3); // 00100
  });

  it('should read SEG correctly', () => {
    // SEG 0 = 0 (UEG 0)
    // SEG 1 = 1 (UEG 1)
    // SEG -1 = 2 (UEG 2)
    const data = new Uint8Array([0b10100110, 0b00000000]);
    const reader = new ExpGolombReader(data);
    expect(reader.readSEG()).toBe(0);
    expect(reader.readSEG()).toBe(1);
    expect(reader.readSEG()).toBe(-1);
  });
});

describe('SPS Parsing', () => {
  it('should parse a basic SPS and return dimensions', () => {
    // Mock SPS for 1280x720
    const sps = new Uint8Array([
      0x67, 0x42, 0xc0, 0x1f, 0xda, 0x01, 0x40, 0x16,
      0xe8, 0x06, 0xd0, 0xa1, 0x35
    ]);
    const dims = parseSPS(sps);
    expect(dims.width).toBeGreaterThan(0);
    expect(dims.height).toBeGreaterThan(0);
  });

  it('should return defaults on failed parse', () => {
    const dims = parseSPS(new Uint8Array([0, 0, 0]));
    expect(dims.width).toBe(1920);
    expect(dims.height).toBe(1080);
  });
});

describe('AacStream', () => {
  it('should parse ADTS frames', () => {
    const stream = new AacStream();
    const demuxer = new TSDemuxer();
    
    // Minimal ADTS frame
    const adts = new Uint8Array([
      0xff, 0xf1, // sync + no CRC
      0x50, 0x80, // profile, rate, etc.
      0x01, 0x20, // length = 9 (0x0009) -> data[3] bits 12-11=0, data[4] bits 10-3=1, data[5] bits 2-0=1 (0x20)
      0xfc,       // data[5] has some flags too
      0x12, 0x34  // data
    ]);
    
    stream.parse(adts, 90000, 90000, demuxer);
    const at = (demuxer as any)._audioTrack;
    expect(at.samples.length).toBe(1);
    expect(at.samples[0].size).toBe(2);
  });
});

describe('AvcStream', () => {
  it('should find NALUs and emit samples', () => {
    const stream = new AvcStream();
    const demuxer = new TSDemuxer();
    
    const nalu1 = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x67, 0x42, 0x00, 0x1e]); // SPS
    const nalu2 = new Uint8Array([0x00, 0x00, 0x01, 0x68, 0xce, 0x3c, 0x80]); // PPS
    const nalu3 = new Uint8Array([0x00, 0x00, 0x01, 0x65, 0x12, 0x34]); // IDR slice
    
    const data = new Uint8Array(nalu1.length + nalu2.length + nalu3.length);
    data.set(nalu1);
    data.set(nalu2, nalu1.length);
    data.set(nalu3, nalu1.length + nalu2.length);
    
    stream.parse(data, 0, 0, demuxer);
    stream.flush(demuxer);
    
    const vt = (demuxer as any)._videoTrack;
    expect(vt.sps.length).toBe(1);
    expect(vt.pps.length).toBe(1);
    expect(vt.samples.length).toBe(1);
    expect(vt.samples[0].keyframe).toBe(true);
  });
});

describe('Remuxer - edge cases', () => {
  it('should handle missing video track in DemuxResult', () => {
    const remuxer = new Remuxer();
    const result = remuxer.remux({
      audioTrack: {
        type: TrackTypes.AUDIO, id: 2, timescale: 44100, duration: 0,
        codec: 'mp4a.40.2', channelCount: 2, sampleRate: 44100,
        config: new Uint8Array(2),
        samples: [{ size: 8, duration: 1024, dts: 0, pts: 0, data: new Uint8Array(8) }],
      },
    }, 0);
    expect(result.initSegment).toBeDefined();
    expect(result.audioData).toBeDefined();
  });
});
