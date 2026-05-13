import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { LevelDetails } from '../types/level';
import { Logger } from '../utils/logger';

export class LatencyController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _details: LevelDetails | null = null;
  private _checkTimer: ReturnType<typeof setInterval> | null = null;
  private logger = new Logger('LatencyController');

  constructor(hls: Hls) {
    this.hls = hls;
  }

  _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
    this._startMonitoring();
  };

  _onMediaDetached = (): void => {
    this._stopMonitoring();
    this._media = null;
  };

  _onLevelUpdated = (data: { details: LevelDetails }): void => {
    this._details = data.details;
  };

  private _startMonitoring(): void {
    this._stopMonitoring();
    this._checkTimer = setInterval(() => this._checkLatency(), 1000);
  }

  private _stopMonitoring(): void {
    if (this._checkTimer) {
      clearInterval(this._checkTimer);
      this._checkTimer = null;
    }
  }

  private _checkLatency(): void {
    if (!this._media || !this._details || !this._details.live) return;
    if (this._details.partTarget === undefined) return; // Not LL-HLS

    const fragments = this._details.fragments;
    if (fragments.length === 0) return;

    const liveEdge = fragments[fragments.length - 1].start + fragments[fragments.length - 1].duration;
    const currentTime = this._media.currentTime;
    const currentLatency = liveEdge - currentTime;
    
    // Target latency is partHoldBack if available, else 3x partTarget
    const targetLatency = this._details.partHoldBack || (this._details.partTarget * 3);
    const drift = currentLatency - targetLatency;

    // Latency management logic
    if (drift > 1.0) {
      // Too far behind, speed up
      this._media.playbackRate = 1.05;
      this.logger.log(`Drift detected: ${drift.toFixed(2)}s. Speeding up (1.05x)`);
    } else if (drift < -0.5) {
      // Too close to the edge, slow down
      this._media.playbackRate = 0.95;
      this.logger.log(`Too close to edge: ${drift.toFixed(2)}s. Catching breath (0.95x)`);
    } else {
      // Within acceptable range
      if (this._media.playbackRate !== 1.0) {
        this._media.playbackRate = 1.0;
        this.logger.log(`Latency stabilized. Normal playback.`);
      }
    }

    // Critical: If drift is extreme (> targetDuration), seek to live edge
    if (drift > this._details.targetduration * 2) {
      this.logger.log(`Extreme drift detected: ${drift.toFixed(2)}s. Seeking to live edge.`);
      this.hls.seekTo(liveEdge - targetLatency);
    }
  }

  destroy(): void {
    this._stopMonitoring();
    this._details = null;
  }
}
