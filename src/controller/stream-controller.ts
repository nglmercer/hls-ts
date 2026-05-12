import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { Level, Fragment, LevelDetails, ManifestData } from '../types/level';
import { FragmentLoader } from '../loader/fragment-loader';
import { TransmuxerController } from '../remux/transmuxer-controller';
import { ErrorTypes, ErrorDetails, type HlsError, TrackTypes } from '../types';
import type { AbrController } from './abr-controller';
import type { LevelController } from './level-controller';

export class StreamController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _levelController: LevelController;
  private _abrController: AbrController;
  private _fragmentLoader: FragmentLoader;
  private _transmuxer: TransmuxerController;
  private _currentFrag: Fragment | null = null;
  private _fragQueue: Fragment[] = [];
  private _loading: boolean = false;
  private _paused: boolean = false;
  private _seeking: boolean = false;
  private _lastLevel?: number;
  private _pendingData: ArrayBuffer | null = null;
  private _lastCC: Map<number, number> = new Map();
  private _checkBufferTimer: ReturnType<typeof setInterval> | null = null;

  constructor(hls: Hls, levelController: LevelController, abrController: AbrController) {
    this.hls = hls;
    this._levelController = levelController;
    this._abrController = abrController;
    this._fragmentLoader = new FragmentLoader();
    this._transmuxer = new TransmuxerController();
  }

  destroy(): void {
    if (this._checkBufferTimer) {
      clearTimeout(this._checkBufferTimer);
      this._checkBufferTimer = null;
    }
    this._transmuxer.destroy();
  }

  _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
    this._media.addEventListener('timeupdate', this._onTimeUpdate);
    this._media.addEventListener('playing', this._onPlaying);
    this._media.addEventListener('waiting', this._onPlaying);
  };

  _onMediaDetached = (): void => {
    if (this._media) {
      this._media.removeEventListener('timeupdate', this._onTimeUpdate);
      this._media.removeEventListener('playing', this._onPlaying);
      this._media.removeEventListener('waiting', this._onPlaying);
    }
    this._media = null;
  };

  _onBufferReset = (): void => {
    this._transmuxer.reset();
  };

  _onManifestParsed = (_data: ManifestData): void => {
    this._startLoading();
  };

  _onLevelUpdated = (data: { level: Level; details: LevelDetails }): void => {
    const fragments = data.details.fragments;
    if (fragments.length === 0) return;

    if (this._currentFrag) {
      // When switching levels, find the fragment at the same TIME POSITION as the last loaded one.
      // Using sn comparison is WRONG because each level has its own numbering scheme.
      const nextStartTime = this._currentFrag.start + this._currentFrag.duration;
      const startFrag = this._findFragmentByPTS(nextStartTime, fragments)
        ?? this._findFragmentByPTS(this._currentFrag.start, fragments);

      if (startFrag) {
        this._fragQueue = fragments.filter(f => f.sn >= startFrag.sn);
      } else {
        this._fragQueue = [...fragments];
      }
    } else {
      if (data.details.live) {
        const liveSyncCount = this.hls.config.liveSyncDurationCount;
        const startIndex = Math.max(0, fragments.length - liveSyncCount);
        this._fragQueue = fragments.slice(startIndex);
      } else {
        this._fragQueue = [...fragments];
      }
    }
    this._loadNextFragment();
  };


  _onFragLoaded = async (data: { frag: Fragment; stats: { loaded: number; total: number; trequest: number; tfirst: number; tload: number } }) => {
    const { frag, stats } = data;
    const responseData = this._pendingData;
    this._pendingData = null;
    if (!responseData) {
      this._loading = false;
      this._loadNextFragment();
      return;
    }

    if (this._fragQueue.length > 0) {
      const bw = this._abrController.bwEstimate;
      const nextLevelId = this._abrController.getNextLevel(bw);
      const currentLevel = this._levelController.currentLevel;
      if (currentLevel && nextLevelId !== currentLevel.id && this._levelController.levels[nextLevelId]) {
        this.hls.trigger(Events.LEVEL_SWITCHING, { level: nextLevelId });
        this._levelController.loadLevel(nextLevelId);
      }
    }

    try {
      await this._processFragment(responseData, frag);
    } finally {
      this._loading = false;
      this._loadNextFragment();
    }
  }

  private _startLoading(): void {
    this._paused = false;
    this._loadNextFragment();
  }

  _onSeeking = (): void => {
    this._seeking = true;
    this._fragQueue = [];
    this._fragmentLoader.abort();
    this._transmuxer.reset();
    this._lastLevel = undefined;

    const targetTime = this._media?.currentTime ?? 0;
    if (targetTime > 1) {
      this.hls.trigger(Events.BUFFER_FLUSHING, { startOffset: 0, endOffset: Math.max(0, targetTime - 1) });
    }
  };

  _onSeeked = (): void => {
    if (!this._media) {
      this._seeking = false;
      return;
    }

    const targetTime = this._media.currentTime;
    const level = this._levelController.currentLevel;
    if (!level?.details) {
      this._seeking = false;
      return;
    }

    const frag = this._findFragmentByPTS(targetTime, level.details.fragments);
    if (frag) {
      this._fragQueue = level.details.fragments.filter(f => f.sn >= frag.sn);
    }

    this._seeking = false;
    this._loadNextFragment();
  };

  _onTimeUpdate = (): void => {
    if (this._paused || this._seeking) return;
    if (!this._loading) this._loadNextFragment();
  };

  _onPlaying = (): void => {
    if (this._paused || this._seeking) return;
    if (!this._loading) this._loadNextFragment();
  };


  private _findFragmentByPTS(time: number, fragments: Fragment[]): Fragment | null {
    if (fragments.length === 0) return null;
    let lo = 0;
    let hi = fragments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const f = fragments[mid];
      if (time < f.start) {
        hi = mid - 1;
      } else if (time > f.start + f.duration) {
        lo = mid + 1;
      } else {
        return f;
      }
    }
    return fragments[Math.min(lo, fragments.length - 1)] ?? null;
  }

  private _loadNextFragment(): void {
    if (this._paused || this._loading || this._seeking) return;
    if (this._fragQueue.length === 0) return;

    if (this._checkBufferTimer) {
      clearTimeout(this._checkBufferTimer);
      this._checkBufferTimer = null;
    }

    const maxBuffer = this.hls.config.maxBufferLength;

    if (this._media) {
      const currentTime = this._media.currentTime;

      // PRIMARY CHECK: Use the last loaded fragment's end time.
      // This is synchronous and NOT subject to the appendBuffer race condition.
      // It tells us how far ahead we've downloaded, regardless of whether
      // the browser has finished appending.
      if (this._currentFrag) {
        const loadedAhead = (this._currentFrag.start + this._currentFrag.duration) - currentTime;
        if (loadedAhead >= maxBuffer) {
          this._checkBufferTimer = setTimeout(() => this._loadNextFragment(), 500);
          return;
        }
      }

      // SECONDARY CHECK: Also verify via media.buffered (catches edge cases
      // where _currentFrag was reset, e.g. after seek).
      const buffered = this._media.buffered;
      if (buffered.length > 0) {
        const furthestEnd = buffered.end(buffered.length - 1);
        const bufferLen = Math.max(0, furthestEnd - currentTime);
        if (bufferLen >= maxBuffer) {
          this._checkBufferTimer = setTimeout(() => this._loadNextFragment(), 500);
          return;
        }
      }
    }

    console.log('Queue size', this._fragQueue.length);
    this._loading = true;
    this._doLoad();
  }

  private _doLoad(): void {
    const frag = this._fragQueue.shift()!;
    if (!frag) {
      this._loading = false;
      return;
    }

    this._currentFrag = frag;
    this.hls.trigger(Events.FRAG_LOADING, { frag });

    this._fragmentLoader.load(
      { url: frag.url, frag, headers: frag.byteRangeEnd > 0 ? { 'Range': `bytes=${frag.byteRangeStart}-${frag.byteRangeEnd - 1}` } : undefined },
      {
        onSuccess: (response) => {
          this._pendingData = response.data;
          this.hls.trigger(Events.FRAG_LOADED, { frag, stats: response.stats });
        },
        onError: (err) => {
          this._loading = false;
          const error: HlsError = {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.FRAG_LOAD_ERROR,
            fatal: true,
            reason: err.text,
            frag,
          };
          this.hls.trigger(Events.ERROR, error);
          this._loadNextFragment();
        },
        onTimeout: () => {
          this._loading = false;
          const error: HlsError = {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.FRAG_LOAD_TIMEOUT,
            fatal: false,
            reason: 'Fragment load timed out',
            frag,
          };
          this.hls.trigger(Events.ERROR, error);
          this._loadNextFragment();
        },
      },
    );
  }

  private async _processFragment(data: ArrayBuffer, frag: Fragment): Promise<void> {
    const uint8 = new Uint8Array(data);

    try {
      const baseDts = Math.round(frag.start * 90000);
      const level = frag.level;
      const lastCC = this._lastCC.get(level);
      const discontinuity = lastCC !== undefined && frag.cc !== lastCC + 1;
      this._lastCC.set(level, frag.cc);

      if (this._lastLevel !== undefined && this._lastLevel !== level) {
        this._transmuxer.reset();
      }
      this._lastLevel = level;

      const { remuxResult } = await this._transmuxer.transmux(uint8, frag.start, baseDts, discontinuity);

      if (!remuxResult) return;

      // Append init segment first (contains ftyp + moov with all tracks)
      if (remuxResult.initSegment) {
        this.hls.trigger(Events.FRAG_PARSING_INIT_SEGMENT, { frag, tracks: remuxResult });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.initSegment, type: TrackTypes.VIDEO });
      }

      // Append combined media data (moof+mdat for each track, concatenated)
      if (remuxResult.data) {
        this.hls.trigger(Events.FRAG_PARSING_DATA, { frag, data: remuxResult.data, type: TrackTypes.VIDEO });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.data, type: TrackTypes.VIDEO });
      }

      this.hls.trigger(Events.FRAG_PARSED, { frag });
      this.hls.trigger(Events.FRAG_BUFFERED, { frag });
    } catch (err) {
      const error: HlsError = {
        type: ErrorTypes.MUX_ERROR,
        details: ErrorDetails.FRAG_PARSING_ERROR,
        fatal: true,
        reason: `Fragment parsing error: ${(err as Error).message}`,
        frag,
      };
      this.hls.trigger(Events.ERROR, error);
    }
  }
}
