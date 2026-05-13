import { describe, it, expect } from 'bun:test';
import { AACDemuxer } from '../src/remux/aac-demuxer';
import { MP3Demuxer } from '../src/remux/mp3-demuxer';
import { PassThroughRemuxer } from '../src/remux/passthrough-remuxer';
import { CodecUtils } from '../src/utils/codecs';

describe('AACDemuxer', () => {
  it('should demux raw AAC ADTS frames', () => {
    const demuxer = new AACDemuxer();
    // Simple ADTS frame: sync=0xFFF, length=9 (7 header + 2 data)
    const data = new Uint8Array([
      0xff, 0xf1, 0x50, 0x80, 0x01, 0x20, 0xfc, 0x12, 0x34
    ]);
    const result = demuxer.demux(data, 0);
    expect(result.audioTrack).toBeDefined();
    expect(result.audioTrack?.samples.length).toBe(1);
    expect(result.audioTrack?.samples[0].size).toBe(2);
  });
});

describe('MP3Demuxer', () => {
  it('should demux MP3 frames', () => {
    const demuxer = new MP3Demuxer();
    // Simple MP3 frame mock (sync 0xFFE)
    const data = new Uint8Array(500).fill(0);
    data[0] = 0xff;
    data[1] = 0xfb; // sync + layer III
    data[2] = 0x90; // bitrate index 9, samplerate index 0
    const result = demuxer.demux(data, 0);
    expect(result.audioTrack).toBeDefined();
    expect(result.audioTrack?.samples.length).toBeGreaterThan(0);
  });
});

describe('PassThroughRemuxer', () => {
  it('should pass through fMP4 data', () => {
    const remuxer = new PassThroughRemuxer();
    const fmp4 = new Uint8Array([0, 0, 0, 20, 0x6d, 0x6f, 0x6f, 0x66, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const result = remuxer.remux(fmp4, 0);
    expect(result.data).toBe(fmp4);
  });

  it('should return empty for non-MP4 data', () => {
    const remuxer = new PassThroughRemuxer();
    const ts = new Uint8Array([0x47, 0, 0, 0x10]);
    const result = remuxer.remux(ts, 0);
    expect(result.data).toBeUndefined();
  });
});

describe('CodecUtils', () => {
  it('should detect MP4 correctly', () => {
    const fmp4 = new Uint8Array([0, 0, 0, 20, 0x6d, 0x6f, 0x6f, 0x66]);
    expect(CodecUtils.isMP4(fmp4)).toBe(true);
    
    const ts = new Uint8Array([0x47, 0, 0, 0x10]);
    expect(CodecUtils.isMP4(ts)).toBe(false);
  });

  it('should generate video codec string from SPS', () => {
    const sps = new Uint8Array([0x67, 0x64, 0x00, 0x1e]);
    expect(CodecUtils.getVideoCodec(sps)).toBe('avc1.64001e');
  });

  it('should generate audio codec string from config', () => {
    const config = new Uint8Array([0x12, 0x10]); // AAC-LC
    expect(CodecUtils.getAudioCodec(config)).toBe('mp4a.40.2');
  });
});
