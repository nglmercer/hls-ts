import { describe, expect, it, mock } from 'bun:test';
import { LatencyController } from '../src/controller/latency-controller';
import { Hls } from '../src/core/Hls';

describe('LatencyController', () => {
  it('should adjust playback rate based on drift', () => {
    const hls = new Hls();
    const controller = new LatencyController(hls);
    
    // Mock the video element
    const media = {
      currentTime: 10,
      playbackRate: 1.0,
    } as unknown as HTMLMediaElement;
    
    controller._onMediaAttached({ media });

    // Mock a live playlist update where live edge is at 15s (drift is 5s, target latency is 1.5s -> drift = 3.5s)
    controller._onLevelUpdated({
      details: {
        live: true,
        partTarget: 0.5, // 0.5s parts -> target latency 1.5s
        fragments: [{ start: 10, duration: 5, sn: 1, level: 0, cc: 0, byteRangeStart: 0, byteRangeEnd: 0, programDateTime: 0, initSegment: null, tagList: [], stats: {} as any }]
      } as any
    });

    // Manually trigger the latency check
    controller['_checkLatency']();

    // Since drift is > 1.0, it should speed up
    expect(media.playbackRate).toBeCloseTo(1.05);

    // Now pretend we are too close (currentTime = 14) -> Latency = 1s -> Drift = -0.5s
    media.currentTime = 14.5;
    controller['_checkLatency']();
    
    // Since drift is < -0.5, it should slow down
    expect(media.playbackRate).toBeCloseTo(0.95);
  });
});
