import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { Level, Fragment, LevelDetails, ManifestData, Part } from '../types/level';
import { FragmentLoader } from '../loader/fragment-loader';
import { TransmuxerController } from '../remux/transmuxer-controller';
import { ErrorTypes, ErrorDetails, type HlsError, TrackTypes } from '../types';
import { Logger } from '../utils/logger';
import type { AbrController } from './abr-controller';
import type { LevelController } from './level-controller';

export class StreamController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _levelController: LevelController;
  private _abrController: AbrController;
  private _fragmentLoader: FragmentLoader;
  private _transmuxer: TransmuxerController;
  private _loading: boolean = false;
  private _currentFrag: Fragment | null = null;
  private _currentPart: Part | null = null;
  private _fragQueue: Fragment[] = [];
  private _partQueue: Part[] = [];
  private _paused: boolean = false;
  private _seeking: boolean = false;
  private _lastLevel?: number;
  private _pendingData: ArrayBuffer | null = null;
  private _lastCC: Map<number, number> = new Map();
  private _checkBufferTimer: ReturnType<typeof setTimeout> | null = null;
  private _timeUpdateTimer: ReturnType<typeof setTimeout> | null = null;
  private _lastFragmentIndex: number = -1;
  private _lastFragmentIndexLevel: number = -1;
  private _seekGeneration: number = 0;
  private _pendingLevelUpdate: { fragments: Fragment[]; details: LevelDetails; isLL: boolean } | null = null;
  private logger = new Logger('StreamController');

  constructor(hls: Hls, levelController: LevelController, abrController: AbrController) {
    this.hls = hls;
    this._levelController = levelController;
    this._abrController = abrController;
    this._fragmentLoader = new FragmentLoader();
    this._transmuxer = new TransmuxerController(hls.config.enableWorker);
  }

  destroy(): void {
    if (this._checkBufferTimer) {
      clearTimeout(this._checkBufferTimer);
      this._checkBufferTimer = null;
    }
    if (this._timeUpdateTimer) {
      clearTimeout(this._timeUpdateTimer);
      this._timeUpdateTimer = null;
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

    const isLL = data.details.partTarget !== undefined;

    // Don't rebuild queue while a fragment is being processed — the in-flight
    // fragment comes from the old level and replacing the queue mid-load causes
    // fragment SN jumps. Defer until loading completes.
    if (this._loading) {
      this._pendingLevelUpdate = { fragments, details: data.details, isLL };
      return;
    }

    this._applyLevelUpdate(fragments, data.details, isLL);
    this._loadNextFragment();
  };

  private _applyLevelUpdate(fragments: Fragment[], details: LevelDetails, isLL: boolean): void {
    if (this._currentFrag) {
      const nextStartTime = this._currentFrag.start + this._currentFrag.duration;
      const startFrag = this._findFragmentByPTS(nextStartTime, fragments)
        ?? this._findFragmentByPTS(this._currentFrag.start, fragments);

      if (startFrag) {
        this._fragQueue = fragments.filter(f => f.sn >= startFrag.sn);

        if (isLL && startFrag.sn === this._currentFrag.sn && startFrag.parts) {
          const lastPartIdx = this._currentPart ? this._currentPart.part : -1;
          this._partQueue = startFrag.parts.filter(p => p.part > lastPartIdx);
        }
      } else {
        this._fragQueue = [...fragments];
      }
    } else {
      if (details.live) {
        if (isLL && details.partHoldBack) {
          const targetTime = fragments[fragments.length - 1].start + fragments[fragments.length - 1].duration - details.partHoldBack;
          const startFrag = this._findFragmentByPTS(targetTime, fragments);
          if (startFrag) {
            this._fragQueue = fragments.filter(f => f.sn >= startFrag.sn);
            if (startFrag.parts) {
              this._partQueue = startFrag.parts.filter(p => (startFrag.start + p.duration * (p.part + 1)) >= targetTime);
            }
          } else {
            this._fragQueue = [fragments[fragments.length - 1]];
          }
        } else {
          const liveSyncCount = this.hls.config.liveSyncDurationCount;
          const startIndex = Math.max(0, fragments.length - liveSyncCount);
          this._fragQueue = fragments.slice(startIndex);
        }
      } else {
        if (this._media && this._media.buffered.length > 0) {
          const bufferedEnd = this._media.buffered.end(this._media.buffered.length - 1);
          const startFrag = this._findFragmentByPTS(bufferedEnd, fragments);
          if (startFrag) {
            this._fragQueue = fragments.filter(f => f.sn >= startFrag.sn);
          } else {
            this._fragQueue = [...fragments];
          }
        } else {
          this._fragQueue = [...fragments];
        }
      }
    }
  }


  _onFragLoaded = async (data: { frag: Fragment; part?: Part; stats: { loaded: number; total: number; trequest: number; tfirst: number; tload: number } }) => {
    const { frag, stats } = data;
    const responseData = this._pendingData;
    this._pendingData = null;
    if (!responseData) {
      this._loading = false;
      this._loadNextFragment();
      return;
    }

    if (this._fragQueue.length > 0 && !this._media?.paused && this._levelController.manualLevel < 0) {
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
      if (this._pendingLevelUpdate) {
        const { fragments, details, isLL } = this._pendingLevelUpdate;
        this._pendingLevelUpdate = null;
        this._applyLevelUpdate(fragments, details, isLL);
      }
      this._loadNextFragment();
    }
  };

  _startLoading(): void {
    this._paused = false;
    const startPosition = this.hls.config.startPosition;
    if (startPosition >= 0) {
      this._loadStartPosition(startPosition);
    } else {
      this._loadNextFragment();
    }
  }

  private _loadStartPosition(time: number): void {
    const level = this._levelController.currentLevel;
    if (level?.details) {
      const frag = this._findFragmentByPTS(time, level.details.fragments);
      if (frag) {
        this._currentFrag = frag;
        this._fragQueue = level.details.fragments.filter(f => f.sn >= frag.sn);
      } else {
        this._fragQueue = [...level.details.fragments];
      }
    }
    this._loadNextFragment();
  }

  _seekTo = (time: number): void => {
    if (!this._media) return;

    this._pendingLevelUpdate = null;
    this._seeking = true;
    this._loading = false;
    this._currentFrag = null;
    this._fragQueue = [];
    this._fragmentLoader.abort();

    // media.currentTime = time synchronously fires the 'seeking' event,
    // which triggers _onSeeking — that handles BUFFER_RESET, BUFFER_FLUSHING,
    // queue rebuild, and _loadNextFragment. Don't duplicate those operations here.
    this._media.currentTime = time;
  };

  _onSeeking = (): void => {
    this._pendingLevelUpdate = null;
    this._seekGeneration++;
    this._seeking = true;
    this._loading = false;
    this._currentFrag = null;
    this._fragQueue = [];
    this._fragmentLoader.abort();
    this.hls.trigger(Events.BUFFER_RESET);
    this._lastLevel = undefined;

    // Start loading immediately at the seek position to break the Catch-22
    if (this._media) {
      const targetTime = this._media.currentTime;

      // Flush old buffer data — the previous position's data is stale after seeking
      this.hls.trigger(Events.BUFFER_FLUSHING, { startOffset: 0, endOffset: Infinity });
      const level = this._levelController.currentLevel;
      if (level?.details) {
        const frag = this._findFragmentByPTS(targetTime, level.details.fragments);
        if (frag) {
          this._fragQueue = level.details.fragments.filter(f => f.sn >= frag.sn);
          this._loadNextFragment();
        }
      }
    }
  };

  _onSeeked = (): void => {
    this._seeking = false;
    // If _onSeeking already started a load, this might be redundant but safe
    if (!this._loading) {
      this._loadNextFragment();
    }
  };

  _onTimeUpdate = (): void => {
    if (this._paused || this._seeking) return;
    if (this._timeUpdateTimer) return;
    this._timeUpdateTimer = setTimeout(() => {
      this._timeUpdateTimer = null;
      if (!this._loading) this._loadNextFragment();
    }, 200);
  };

  _onPlaying = (): void => {
    if (this._paused) return;
    if (!this._loading) this._loadNextFragment();
  };


  private _findFragmentByPTS(time: number, fragments: Fragment[]): Fragment | null {
    if (fragments.length === 0) return null;
    if (this._lastFragmentIndex >= 0 && this._lastFragmentIndex < fragments.length) {
      const probeIdx = this._lastFragmentIndex + 1;
      if (probeIdx < fragments.length) {
        const probe = fragments[probeIdx];
        if (probe && time >= probe.start && time < probe.start + probe.duration) {
          this._lastFragmentIndex = probeIdx;
          return probe;
        }
      }
    }
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
        this._lastFragmentIndex = mid;
        return f;
      }
    }
    const result = fragments[Math.min(lo, fragments.length - 1)] ?? null;
    return result;
  }

  private _loadNextFragment(): void {
    if (this._paused || this._loading) return;
    if (this._fragQueue.length === 0 && this._partQueue.length === 0) return;

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
          this._checkBufferTimer = setTimeout(() => this._loadNextFragment(), 100);
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
          this._checkBufferTimer = setTimeout(() => this._loadNextFragment(), 100);
          return;
        }
      }
    }
    this._loading = true;
    this._doLoad();
  }

  private _doLoad(): void {
    if (this._partQueue.length > 0) {
      const part = this._partQueue.shift()!;
      this._currentPart = part;
      const frag = this._currentFrag!;

      this.logger.log(`Loading part SN:${part.sn} part:${part.part} uri:${part.uri}`);
      this.hls.trigger(Events.FRAG_LOADING, { frag, part });

      const headers: Record<string, string> = {};
      if (part.byteRangeEnd && part.byteRangeEnd > 0) {
        headers['Range'] = `bytes=${part.byteRangeStart}-${part.byteRangeEnd - 1}`;
      }

      this._fragmentLoader.load(
        { url: part.uri, frag, headers },
        {
          onSuccess: (res) => {
            this._pendingData = res.data;
            this.hls.trigger(Events.FRAG_LOADED, { frag, part: this._currentPart ?? undefined, stats: res.stats });
          },
          onError: (err) => {
            this._loading = false;
            const reason = err instanceof Error ? err.message : JSON.stringify(err);
            this.hls.trigger(Events.ERROR, { type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.FRAG_LOAD_ERROR, reason, frag, fatal: false });
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
        }
      );
      return;
    }

    const frag = this._fragQueue.shift()!;
    if (!frag) {
      // Check for preload hints if we're out of fragments but in LL-HLS mode
      const details = this._levelController.currentLevel?.details;
      if (details?.preloadHint && details.preloadHint.type === 'PART') {
        const hint = details.preloadHint;
        this.logger.log(`Loading preload hint: ${hint.uri}`);
        this._fragmentLoader.load(
          { url: hint.uri, frag: this._currentFrag! }, // Use last frag context
          {
            onSuccess: (res) => {
              this._pendingData = res.data;
              this.hls.trigger(Events.FRAG_LOADED, { frag: this._currentFrag!, stats: res.stats });
            },
            onError: () => { this._loading = false; this._loadNextFragment(); },
            onTimeout: () => { this._loading = false; this._loadNextFragment(); },
          }
        );
        return;
      }

      this._loading = false;
      return;
    }

    this._currentFrag = frag;
    this._currentPart = null;

    // If fragment has parts, load the first part instead of the full fragment
    if (frag.parts && frag.parts.length > 0) {
      this._partQueue = [...frag.parts];
      this._doLoad();
      return;
    }

    this.logger.log(`Loading fragment SN:${frag.sn} level:${frag.level} start:${frag.start.toFixed(3)}s`);
    this.hls.trigger(Events.FRAG_LOADING, { frag });

    const headers: Record<string, string> = {};
    if (frag.byteRangeEnd && frag.byteRangeEnd > 0) {
      headers['Range'] = `bytes=${frag.byteRangeStart}-${frag.byteRangeEnd - 1}`;
    }

    this._fragmentLoader.load(
      { url: frag.url, frag, headers },
      {
        onSuccess: (res) => {
          this._pendingData = res.data;
          this.hls.trigger(Events.FRAG_LOADED, { frag, stats: res.stats });
        },
onError: (err) => {
            this._loading = false;
            const reason = err instanceof Error ? err.message : JSON.stringify(err);
            this.hls.trigger(Events.ERROR, { type: ErrorTypes.NETWORK_ERROR, details: ErrorDetails.FRAG_LOAD_ERROR, reason, frag, fatal: false });
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
    const gen = this._seekGeneration;

    try {
      const baseDts = Math.round(frag.start * 90000);
      const level = frag.level;
      const lastCC = this._lastCC.get(level);
      const discontinuity = lastCC !== undefined && frag.cc !== lastCC + 1;
      this._lastCC.set(level, frag.cc);

      if (this._lastLevel !== undefined && this._lastLevel !== level) {
        this._transmuxer.reset();
        if (this._media && this._media.buffered.length > 0) {
          const start = frag.start;
          const end = this._media.buffered.end(this._media.buffered.length - 1);
          if (end > start) {
            this.hls.trigger(Events.BUFFER_FLUSHING, { startOffset: start, endOffset: end });
          }
        }
      }
      this._lastLevel = level;

      const { remuxResult } = await this._transmuxer.transmux(uint8, frag.start, baseDts, discontinuity);

      if (this._seekGeneration !== gen) return;
      if (!remuxResult) return;

      // Append init segment first (contains ftyp + moov with all tracks)
      if (remuxResult.initSegment) {
        this.hls.trigger(Events.FRAG_PARSING_INIT_SEGMENT, { frag, tracks: remuxResult });
      }

      if (remuxResult.metadata) {
        this.hls.trigger(Events.FRAG_PARSING_METADATA, { frag, samples: remuxResult.metadata });
      }

      // Batch init + media data into single appendBuffer calls to reduce append cycles.
      // The MP4 spec allows ftyp+moov+moof+mdat in a single buffer.
      const initSeg = remuxResult.initSegment;

      // Append init segment as separate event (avoids intermediate concat copies)
      if (initSeg) {
        this.hls.trigger(Events.BUFFER_APPENDING, { data: initSeg.buffer as ArrayBuffer, type: TrackTypes.VIDEO });
      }

      if (remuxResult.videoData) {
        this.hls.trigger(Events.FRAG_PARSING_DATA, { frag, data: remuxResult.videoData, type: TrackTypes.VIDEO });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.videoData.buffer as ArrayBuffer, type: TrackTypes.VIDEO });
      }

      if (remuxResult.audioData && this.hls.audioTrack === -1) {
        this.hls.trigger(Events.FRAG_PARSING_DATA, { frag, data: remuxResult.audioData, type: TrackTypes.AUDIO });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.audioData.buffer as ArrayBuffer, type: TrackTypes.AUDIO });
      }

      if (!remuxResult.videoData && !remuxResult.audioData && remuxResult.data) {
        this.hls.trigger(Events.FRAG_PARSING_DATA, { frag, data: remuxResult.data, type: TrackTypes.VIDEO });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.data.buffer as ArrayBuffer, type: TrackTypes.VIDEO });
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
