import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { Level, LevelDetails, ManifestData, LevelParsed } from '../types/level';
import { PlaylistLoader } from '../loader/playlist-loader';
import { parseMediaPlaylist, type PlaylistParseResult } from '../parser/m3u8-parser';
import { ErrorTypes, ErrorDetails } from '../types/errors';
import type { HlsError } from '../types/errors';
import type { AbrController } from './abr-controller';
import { TrackTypes, type TrackType } from '../types';

export class LevelController {
  private hls: Hls;
  private _levels: Level[] = [];
  private _currentLevel: Level | null = null;
  private _playlistLoader: PlaylistLoader;
  private _abrController: AbrController;
  private _livePollInterval: ReturnType<typeof setInterval> | null = null;

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

  destroy(): void {
    if (this._livePollInterval) {
      clearInterval(this._livePollInterval);
      this._livePollInterval = null;
    }
  }

  _startLivePolling(targetDuration: number): void {
    const interval = Math.max(targetDuration / 2, 0.5) * 1000;
    this._livePollInterval = setInterval(() => {
      if (this._currentLevel) {
        // avoid triggering LEVEL_LOADING for live updates to reduce log spam
        const baseurl = this._currentLevel.url.substring(0, this._currentLevel.url.lastIndexOf('/') + 1);
        this._playlistLoader.load(
          { url: this._currentLevel.url },
          {
            onSuccess: (response) => {
              const result = parseMediaPlaylist(response.data, baseurl);
              this.hls.trigger(Events.LEVEL_LOADED, {
                url: this._currentLevel!.url,
                data: response.data,
                ...result,
              });
            },
            onError: () => { }, // silent retry on interval
            onTimeout: () => { },
          }
        );
      }
    }, interval);
  }

  _onManifestParsed = (data: ManifestData): void => {
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

  _onLevelLoading = (_data: { url: string }): void => { };
 
  _onLevelLoaded = (data: { url: string } & PlaylistParseResult): void => {
    const level = this._levels.find(l => l.url === data.url);
    if (!level) return;

    let totalDuration = 0;
    const fragments = data.fragments.map((f) => {
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
      totalDuration += Number(f.duration);
      return frag;
    });

    level.details = {
      version: data.version,
      targetduration: data.targetduration,
      totalduration: totalDuration,
      startSN: data.startSN,
      endSN: data.endSN,
      fragStart: 0,
      fragments: fragments,
      live: data.live,
      type: data.type,
      updated: Date.now(),
      advanced: false,
      availabilityDelay: 0,
      dateranges: data.dateranges,
    };

    if (data.live && !this._livePollInterval) {
      this._startLivePolling(Number(data.targetduration));
    } else if (!data.live && this._livePollInterval) {
      clearInterval(this._livePollInterval);
      this._livePollInterval = null;
    }

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
            details: ErrorDetails.LEVEL_LOAD_ERROR,
            fatal: false,
            reason: err.text,
          } as HlsError);
        },
        onTimeout: () => {
          this.hls.trigger(Events.ERROR, {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.LEVEL_LOAD_TIMEOUT,
            fatal: false,
            reason: 'Level load timed out',
          } as HlsError);
        },
      },
    );
  }
}
