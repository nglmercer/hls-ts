import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { Level, Fragment, LevelDetails, ManifestData } from '../types/level';
import { FragmentLoader } from '../loader/fragment-loader';
import { TransmuxerController } from '../remux/transmuxer-controller';
import { ErrorTypes } from '../types/errors';
import type { HlsError } from '../types/errors';
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
  private _pendingData: ArrayBuffer | null = null;
  private _lastCC: Map<number, number> = new Map();

  constructor(hls: Hls, levelController: LevelController, abrController: AbrController) {
    this.hls = hls;
    this._levelController = levelController;
    this._abrController = abrController;
    this._fragmentLoader = new FragmentLoader();
    this._transmuxer = new TransmuxerController();
  }

  destroy(): void {
    this._transmuxer.destroy();
  }

  _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
  };

  _onMediaDetached = (): void => {
    this._media = null;
  };

  _onBufferReset = (): void => {
    this._transmuxer.reset();
  };

  _onManifestParsed = (_data: ManifestData): void => {
    this._startLoading();
  };

  _onLevelUpdated = (data: { level: Level; details: LevelDetails }): void => {
    this._fragQueue = [...data.details.fragments];
    this._loadNextFragment();
  };

  _onFragLoaded = async (data: { frag: Fragment; stats: { loaded: number; total: number; trequest: number; tfirst: number; tload: number } }) => {
    const { frag, stats } = data;
    this._loading = false;

    const responseData = this._pendingData;
    this._pendingData = null;
    if (!responseData) {
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

    await this._processFragment(responseData, frag);
    this._loadNextFragment();
  }

  private _startLoading(): void {
    this._paused = false;
    this._loadNextFragment();
  }

  private _loadNextFragment(): void {
    if (this._paused || this._loading) {
      if (this._fragQueue.length > 0 && !this._loading) {
        this._loading = true;
        this._doLoad();
      }
      return;
    }

    if (this._fragQueue.length === 0) return;
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
      { url: frag.url, frag },
      {
        onSuccess: (response) => {
          this._pendingData = response.data;
          this.hls.trigger(Events.FRAG_LOADED, { frag, stats: response.stats });
        },
        onError: (err) => {
          this._loading = false;
          const error: HlsError = {
            type: ErrorTypes.NETWORK_ERROR,
            details: 'fragLoadError',
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
            details: 'fragLoadTimeout',
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

      const { remuxResult } = await this._transmuxer.transmux(uint8, frag.start, baseDts, discontinuity);

      if (!remuxResult) return;

      // Append init segment first (contains ftyp + moov with all tracks)
      if (remuxResult.initSegment) {
        this.hls.trigger(Events.FRAG_PARSING_INIT_SEGMENT, { frag, tracks: remuxResult });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.initSegment, type: 'video' });
      }

      // Append combined media data (moof+mdat for each track, concatenated)
      if (remuxResult.data) {
        this.hls.trigger(Events.FRAG_PARSING_DATA, { frag, data: remuxResult.data, type: 'video' });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.data, type: 'video' });
      }

      this.hls.trigger(Events.FRAG_PARSED, { frag });
      this.hls.trigger(Events.FRAG_BUFFERED, { frag });
    } catch (err) {
      const error: HlsError = {
        type: ErrorTypes.MUX_ERROR,
        details: 'fragParsingError',
        fatal: true,
        reason: `Fragment parsing error: ${(err as Error).message}`,
        frag,
      };
      this.hls.trigger(Events.ERROR, error);
    }
  }
}
