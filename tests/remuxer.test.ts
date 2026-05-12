import { describe, it, expect } from 'bun:test';
import { Remuxer } from '../src/remux/remuxer';
import type { DemuxResult } from '../src/remux/tsdemuxer';

describe('Remuxer', () => {
  it('should create and reset', () => {
    const remuxer = new Remuxer();
    remuxer.reset();
  });

  it('should return empty result for empty demux input', () => {
    const remuxer = new Remuxer();
    const result = remuxer.remux({});
    expect(result.initSegment).toBeUndefined();
    expect(result.data).toBeUndefined();
  });

  it('should produce init segment and video data for video track', () => {
    const remuxer = new Remuxer();
    const demuxResult: DemuxResult = {
      videoTrack: {
        type: 'video',
        id: 1,
        timescale: 90000,
        duration: 0,
        width: 640,
        height: 480,
        sps: [new Uint8Array([0x01, 0x64, 0x00, 0x1e, 0xff])],
        pps: [new Uint8Array([0x01, 0x68, 0xeb])],
        codec: 'avc1.64001e',
        samples: [
          { size: 10, duration: 3000, dts: 0, pts: 0, keyframe: true, data: new Uint8Array(10).fill(0x01) },
        ],
      },
    };

    const result = remuxer.remux(demuxResult);
    expect(result.initSegment).toBeDefined();
    expect(result.initSegment!.length).toBeGreaterThan(0);
    expect(result.videoData).toBeDefined();
    expect(result.videoData!.length).toBeGreaterThan(0);
    expect(result.data).toBeDefined();
  });

  it('should produce init segment and audio data for audio track', () => {
    const remuxer = new Remuxer();
    const demuxResult: DemuxResult = {
      audioTrack: {
        type: 'audio',
        id: 2,
        timescale: 44100,
        duration: 0,
        codec: 'mp4a.40.2',
        channelCount: 2,
        sampleRate: 44100,
        config: undefined,
        samples: [
          { size: 8, duration: 1024, dts: 0, pts: 0, data: new Uint8Array(8).fill(0x20) },
        ],
      },
    };

    const result = remuxer.remux(demuxResult);
    expect(result.initSegment).toBeDefined();
    expect(result.initSegment!.length).toBeGreaterThan(0);
    expect(result.audioData).toBeDefined();
    expect(result.audioData!.length).toBeGreaterThan(0);
    expect(result.data).toBeDefined();
  });

  it('should produce combined data for both video and audio', () => {
    const remuxer = new Remuxer();
    const demuxResult: DemuxResult = {
      videoTrack: {
        type: 'video',
        id: 1,
        timescale: 90000,
        duration: 0,
        width: 1280,
        height: 720,
        sps: [new Uint8Array([0x01, 0x64, 0x00, 0x2a])],
        pps: [new Uint8Array([0x01, 0x68, 0xeb])],
        codec: 'avc1.64002a',
        samples: [
          { size: 15, duration: 3000, dts: 0, pts: 0, keyframe: true, data: new Uint8Array(15).fill(0x01) },
        ],
      },
      audioTrack: {
        type: 'audio',
        id: 2,
        timescale: 44100,
        duration: 0,
        codec: 'mp4a.40.2',
        channelCount: 2,
        sampleRate: 44100,
        config: undefined,
        samples: [
          { size: 8, duration: 1024, dts: 0, pts: 0, data: new Uint8Array(8).fill(0x20) },
        ],
      },
    };

    const result = remuxer.remux(demuxResult);
    expect(result.initSegment).toBeDefined();
    expect(result.data).toBeDefined();
    expect((result.data!.length)).toBeGreaterThan(0);
    expect(result.videoTrack).toBeDefined();
    expect(result.audioTrack).toBeDefined();
  });

  it('should not repeat init segment on subsequent calls', () => {
    const remuxer = new Remuxer();
    const demuxResult: DemuxResult = {
      videoTrack: {
        type: 'video',
        id: 1,
        timescale: 90000,
        duration: 0,
        width: 640,
        height: 480,
        sps: [new Uint8Array([0x01, 0x64, 0x00, 0x1e])],
        pps: [new Uint8Array([0x01, 0x68, 0xeb])],
        codec: 'avc1.64001e',
        samples: [
          { size: 10, duration: 3000, dts: 0, pts: 0, keyframe: true, data: new Uint8Array(10).fill(0x01) },
        ],
      },
    };

    const r1 = remuxer.remux(demuxResult);
    expect(r1.initSegment).toBeDefined();

    const r2 = remuxer.remux(demuxResult);
    expect(r2.initSegment).toBeUndefined();
  });

  it('should handle multiple samples in a track', () => {
    const remuxer = new Remuxer();
    const demuxResult: DemuxResult = {
      videoTrack: {
        type: 'video',
        id: 1,
        timescale: 90000,
        duration: 0,
        width: 640,
        height: 480,
        sps: [new Uint8Array([0x01, 0x64, 0x00, 0x1e])],
        pps: [new Uint8Array([0x01, 0x68, 0xeb])],
        codec: 'avc1.64001e',
        samples: [
          { size: 10, duration: 3000, dts: 0, pts: 0, keyframe: true, data: new Uint8Array(10).fill(0x01) },
          { size: 5, duration: 3000, dts: 3000, pts: 3000, keyframe: false, data: new Uint8Array(5).fill(0x02) },
          { size: 8, duration: 3000, dts: 6000, pts: 6000, keyframe: false, data: new Uint8Array(8).fill(0x03) },
        ],
      },
    };

    const result = remuxer.remux(demuxResult);
    expect(result.initSegment).toBeDefined();
    expect(result.videoData).toBeDefined();
  });

  it('should use base dts from the first sample', () => {
    const remuxer = new Remuxer();
    const demuxResult: DemuxResult = {
      videoTrack: {
        type: 'video',
        id: 1,
        timescale: 90000,
        duration: 0,
        width: 640,
        height: 480,
        sps: [new Uint8Array([0x01, 0x64, 0x00, 0x1e])],
        pps: [new Uint8Array([0x01, 0x68, 0xeb])],
        codec: 'avc1.64001e',
        samples: [
          { size: 10, duration: 3000, dts: 90000, pts: 90000, keyframe: true, data: new Uint8Array(10).fill(0x01) },
        ],
      },
    };

    const result = remuxer.remux(demuxResult);
    expect(result.videoData).toBeDefined();
  });
});
