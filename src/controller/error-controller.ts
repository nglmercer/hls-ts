import { Events } from '../types/events';
import { ErrorTypes, ErrorDetails } from '../types/errors';
import type { HlsError } from '../types/errors';
import type { Hls } from '../core/Hls';

interface RecoveryState {
  retryCount: number;
  lastErrorTime: number;
  backoffMs: number;
}

export class ErrorController {
  private hls: Hls;
  private _recoveryStates: Map<string, RecoveryState> = new Map();
  private _mediaSwapCount: number = 0;
  private _maxMediaSwap: number = 3;

  constructor(hls: Hls) {
    this.hls = hls;
  }

  destroy(): void {
    this.clearRecoveryStates();
  }

  clearRecoveryStates(): void {
    this._recoveryStates.clear();
  }

  recoverMediaError(): void {
    const error: HlsError = {
      type: ErrorTypes.MEDIA_ERROR,
      details: 'mediaErrorRecovered' as any,
      fatal: true,
      reason: 'Manual recovery requested',
    };
    this._handleMediaError(error, { retryCount: 0, lastErrorTime: 0, backoffMs: 0 });
  }

  resetMediaSwapCount(): void {
    this._mediaSwapCount = 0;
  }

  public _onError = (error: HlsError): void => {
    if (!error.fatal) return;

    const key = `${error.type}:${error.details}`;
    const state = this._getOrCreateState(key);

    switch (error.type) {
      case ErrorTypes.NETWORK_ERROR:
        this._handleNetworkError(error, state, key);
        break;
      case ErrorTypes.MEDIA_ERROR:
        this._handleMediaError(error, state);
        break;
      case ErrorTypes.MUX_ERROR:
        this._handleMuxError(error, state);
        break;
      case ErrorTypes.KEY_SYSTEM_ERROR:
        // Optional key system error handling
        break;
      default:
        break;
    }
  };

  private _handleNetworkError(error: HlsError, state: RecoveryState, key: string): void {
    const maxRetries = this.hls.config.fragLoadPolicy?.errorRetry?.maxNumRetry ?? 3;
    if (state.retryCount >= maxRetries) return;

    state.retryCount++;
    state.lastErrorTime = performance.now();
    state.backoffMs = this._calculateBackoff(state.retryCount);

    const frag = error.frag;
    if (frag?.url) {
      setTimeout(() => {
        // Trigger frag loading directly or level loading depending on the actual error.
        // For fragment errors, load the fragment URL.
        if (error.details === 'fragLoadError' || error.details === 'fragLoadTimeout') {
          this.hls.trigger(Events.FRAG_LOADING, { frag });
        } else {
          this.hls.trigger(Events.LEVEL_LOADING, { url: frag.level ? this.hls.levels[frag.level]?.url : this.hls.url });
        }
      }, state.backoffMs);
    }
  }

  private _handleMediaError(error: HlsError, state: RecoveryState): void {
    if (this._mediaSwapCount >= this._maxMediaSwap) return;

    this._mediaSwapCount++;
    const media = this.hls.media;
    if (media) {
      const wasPlaying = !media.paused;
      const currentTime = media.currentTime;

      if (error.details === 'bufferAppendError') {
        this.hls.trigger(Events.BUFFER_RESET, {});
      }

      this.hls.detachMedia();
      setTimeout(() => {
        this.hls.attachMedia(media);
        media.currentTime = currentTime;
        if (wasPlaying) media.play().catch(() => { });
      }, 100);
    }
  }

  private _handleMuxError(error: HlsError, state: RecoveryState): void {
    const levelId = error.frag?.level;
    if (levelId === undefined) return;

    const levels = this.hls.levels;
    if (levels.length <= 1) return;

    const nextLevel = levelId > 0 ? levelId - 1 : 0;
    state.retryCount++;

    setTimeout(() => {
      this.hls.trigger(Events.LEVEL_SWITCHING, { level: nextLevel });
    }, 500);
  }

  private _calculateBackoff(retryCount: number): number {
    return Math.min(1000 * Math.pow(2, retryCount - 1), 15000);
  }

  private _getOrCreateState(key: string): RecoveryState {
    let state = this._recoveryStates.get(key);
    if (!state) {
      state = { retryCount: 0, lastErrorTime: 0, backoffMs: 0 };
      this._recoveryStates.set(key, state);
    }
    return state;
  }
}
