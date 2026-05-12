import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { Level, Fragment, LevelDetails, ManifestData, LevelParsed } from '../types/level';
import { PlaylistLoader } from '../loader/playlist-loader';
import { FragmentLoader } from '../loader/fragment-loader';
import { parseMediaPlaylist } from '../parser/m3u8-parser';
import { TSDemuxer } from '../remux/tsdemuxer';
import { Remuxer } from '../remux/remuxer';
import { ErrorTypes } from '../types/errors';
import type { HlsError } from '../types/errors';
import type { AbrController } from './abr-controller';

export class LevelController {
  private hls: Hls;
  private _levels: Level[] = [];
  private _currentLevel: Level | null = null;
  private _playlistLoader: PlaylistLoader;
  private _abrController: AbrController;

  constructor(hls: Hls, abrController: AbrController) {
    this.hls = hls;
    this._abrController = abrController;
    this._playlistLoader = new PlaylistLoader();
  }

  get levels(): Level[] {
    return this._levels;
  }

  get currentLevel(): Level | null {
    return this._currentLevel;
  }

  loadLevel(levelId: number): void {
    const level = this._levels[levelId];
    if (level) this._loadLevel(level);
  }

  destroy(): void {}

  private _onManifestParsed = (data: ManifestData): void => {
    this._levels = data.levels.map((l: LevelParsed, i: number) => ({
      id: i,
      url: l.url,
      bitrate: l.bitrate,
      width: l.width,
      height: l.height,
      audioCodec: l.audioCodec,
      videoCodec: l.videoCodec,
      codecSet: l.codecSet,
      name: l.name,
      frameRate: l.frameRate,
    }));

    if (this._levels.length > 0) {
      const startLevel = this.hls.config.startLevel;
      const levelId = startLevel === -1 ? 0 : Math.min(startLevel, this._levels.length - 1);
      this._loadLevel(this._levels[levelId]);
    }
  };

  private _onLevelLoading = (_data: { url: string }): void => {};

  private _onLevelLoaded = (data: { url: string; fragments: any[]; targetduration: number; live: boolean; type: string; initSegment: any }): void => {
    const level = this._levels.find(l => l.url === data.url);
    if (!level) return;

    let totalDuration = 0;
    const fragments = data.fragments.map((f: any) => {
      const frag = {
        url: f.url,
        sn: f.sn,
        level: level.id,
        duration: f.duration,
        start: totalDuration,
        cc: 0,
        byteRangeStart: f.byteRangeStart || 0,
        byteRangeEnd: f.byteRangeEnd || 0,
        programDateTime: f.programDateTime || 0,
        initSegment: f.initSegment || data.initSegment || null,
        tagList: f.tagList || [],
        stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false, loading: false },
      };
      totalDuration += f.duration;
      return frag;
    });

    level.details = {
      version: 1,
      targetduration: data.targetduration,
      totalduration: totalDuration,
      startSN: data.fragments[0]?.sn ?? 0,
      endSN: data.fragments[data.fragments.length - 1]?.sn ?? 0,
      fragStart: 0,
      fragments,
      live: data.live,
      type: data.type,
      updated: Date.now(),
      advanced: false,
      availabilityDelay: 0,
    };

    this.hls.trigger(Events.LEVEL_UPDATED, { level, details: level.details });
  };

  private _loadLevel(level: Level): void {
    this._currentLevel = level;
    this.hls.trigger(Events.LEVEL_LOADING, { url: level.url, level });

    const baseurl = level.url.substring(0, level.url.lastIndexOf('/') + 1);
    this._playlistLoader.load(
      { url: level.url },
      {
        onSuccess: (response) => {
          const result = parseMediaPlaylist(response.data, baseurl);
          this.hls.trigger(Events.LEVEL_LOADED, {
            url: level.url,
            data: response.data,
            ...result,
          });
        },
        onError: (err) => {
          this.hls.trigger(Events.ERROR, {
            type: ErrorTypes.NETWORK_ERROR,
            details: 'levelLoadError',
            fatal: false,
            reason: err.text,
          } as HlsError);
        },
        onTimeout: () => {
          this.hls.trigger(Events.ERROR, {
            type: ErrorTypes.NETWORK_ERROR,
            details: 'levelLoadTimeout',
            fatal: false,
            reason: 'Level load timed out',
          } as HlsError);
        },
      },
    );
  }
}

export class StreamController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _levelController: LevelController;
  private _abrController: AbrController;
  private _fragmentLoader: FragmentLoader;
  private _demuxer: TSDemuxer;
  private _remuxer: Remuxer;
  private _currentFrag: Fragment | null = null;
  private _fragQueue: Fragment[] = [];
  private _loading: boolean = false;
  private _paused: boolean = false;
  private _pendingData: ArrayBuffer | null = null;

  constructor(hls: Hls, levelController: LevelController, abrController: AbrController) {
    this.hls = hls;
    this._levelController = levelController;
    this._abrController = abrController;
    this._fragmentLoader = new FragmentLoader();
    this._demuxer = new TSDemuxer();
    this._remuxer = new Remuxer();
  }

  destroy(): void {}

  private _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
  };

  private _onMediaDetached = (): void => {
    this._media = null;
  };

  private _onManifestParsed = (_data: ManifestData): void => {
    this._startLoading();
  };

  private _onLevelUpdated = (data: { level: Level; details: LevelDetails }): void => {
    this._fragQueue = [...data.details.fragments];
    this._loadNextFragment();
  };

  private _onFragLoaded = (data: { frag: Fragment; stats: { loaded: number; total: number; trequest: number; tfirst: number; tload: number } }): void => {
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

    this._processFragment(responseData, frag);
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

  private _processFragment(data: ArrayBuffer, frag: Fragment): void {
    const uint8 = new Uint8Array(data);

    this.hls.trigger(Events.FRAG_PARSING_INIT_SEGMENT, { frag });

    try {
      const demuxResult = this._demuxer.demux(uint8, frag.start);
      const remuxResult = this._remuxer.remux(demuxResult, frag.start * 90000);

      if (remuxResult.initSegment) {
        this.hls.trigger(Events.FRAG_PARSING_INIT_SEGMENT, { frag, tracks: remuxResult });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.initSegment, type: 'video' });
      }

      if (remuxResult.videoData) {
        this.hls.trigger(Events.FRAG_PARSING_DATA, { frag, data: remuxResult.videoData, type: 'video' });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.videoData, type: 'video' });
      }

      if (remuxResult.audioData) {
        this.hls.trigger(Events.FRAG_PARSING_DATA, { frag, data: remuxResult.audioData, type: 'audio' });
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.audioData, type: 'audio' });
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
