import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { MediaPlaylist, Fragment, LevelDetails } from '../types/level';
import { FragmentLoader } from '../loader/fragment-loader';
import { PlaylistLoader } from '../loader/playlist-loader';
import type { StreamController } from './stream-controller';
import { parseMediaPlaylist, type PlaylistParseResult } from '../parser/m3u8-parser';
import { TransmuxerController } from '../remux/transmuxer-controller';
import { TrackTypes, type HlsError, ErrorTypes, ErrorDetails } from '../types';
import { Logger } from '../utils/logger';

export class AudioStreamController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _track: MediaPlaylist | null = null;
  private _details: LevelDetails | null = null;
  private _fragmentLoader: FragmentLoader;
  private _playlistLoader: PlaylistLoader;
  private _transmuxer: TransmuxerController;
  private _currentFrag: Fragment | null = null;
  private _fragQueue: Fragment[] = [];
  private _loading: boolean = false;
  private _paused: boolean = false;
  private _checkBufferTimer: ReturnType<typeof setInterval> | null = null;
  private logger = new Logger('AudioStreamController');

  constructor(hls: Hls, streamController?: StreamController) {
    this.hls = hls;
    this._fragmentLoader = new FragmentLoader();
    this._playlistLoader = new PlaylistLoader();
    this._transmuxer = new TransmuxerController();
  }

  _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
  };

  _onMediaDetached = (): void => {
    this._media = null;
  };

  _onAudioTrackSwitching = (data: { id: number; track: MediaPlaylist | null }): void => {
    this._track = data.track;
    this._fragQueue = [];
    this._currentFrag = null;
    this._fragmentLoader.abort();
    this._transmuxer.reset();

    if (this._track) {
      this._loadPlaylist(this._track);
    }
  };

  private _loadPlaylist(track: MediaPlaylist): void {
    const baseurl = track.url.substring(0, track.url.lastIndexOf('/') + 1);
    this._playlistLoader.load(
      { url: track.url },
      {
        onSuccess: (response) => {
          const result = parseMediaPlaylist(response.data, baseurl);
          // Convert result to LevelDetails-like structure
          this._onPlaylistLoaded(result);
        },
        onError: (err) => {
          this.hls.trigger(Events.ERROR, {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.LEVEL_LOAD_ERROR,
            fatal: false,
            reason: err.text,
          });
        },
        onTimeout: () => {
          this.hls.trigger(Events.ERROR, {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.LEVEL_LOAD_TIMEOUT,
            fatal: false,
            reason: 'Audio playlist load timeout',
          });
        }
      }
    );
  }

  private _onPlaylistLoaded(data: PlaylistParseResult): void {
    // Basic conversion to fragments
    let totalDuration = 0;
    const fragments: Fragment[] = data.fragments.map((f) => {
      const frag: Fragment = {
        url: f.url,
        sn: f.sn,
        level: -1, // Audio track
        duration: f.duration,
        start: totalDuration,
        cc: 0,
        byteRangeStart: f.byteRangeStart,
        byteRangeEnd: f.byteRangeEnd,
        programDateTime: f.programDateTime,
        initSegment: f.initSegment,
        tagList: f.tagList,
        stats: { loaded: 0, total: 0, trequest: 0, tfirst: 0, tload: 0, aborted: false, loading: false },
      };
      totalDuration += f.duration;
      return frag;
    });

    this._details = {
      version: data.version,
      targetduration: data.targetduration,
      totalduration: totalDuration,
      startSN: data.startSN,
      endSN: data.endSN,
      fragStart: 0,
      fragments,
      live: data.live,
      type: data.type,
      updated: Date.now(),
      advanced: false,
      availabilityDelay: 0,
    };

    if (this._media) {
      const currentTime = this._media.currentTime;
      this._fragQueue = fragments.filter((f) => f.start + f.duration > currentTime);
      this._loadNextFragment();
    }
  }

  private _loadNextFragment(): void {
    if (this._paused || this._loading || !this._media || this._fragQueue.length === 0) return;

    const currentTime = this._media.currentTime;
    const maxBuffer = this.hls.config.maxBufferLength;

    if (this._currentFrag) {
      const loadedAhead = (this._currentFrag.start + this._currentFrag.duration) - currentTime;
      if (loadedAhead >= maxBuffer) {
        if (this._checkBufferTimer) clearTimeout(this._checkBufferTimer);
        this._checkBufferTimer = setTimeout(() => this._loadNextFragment(), 500);
        return;
      }
    }

    const frag = this._fragQueue.shift()!;
    this._currentFrag = frag;
    this._loading = true;

    this._fragmentLoader.load(
      { url: frag.url, frag },
      {
        onSuccess: async (response) => {
          await this._processFragment(response.data, frag);
          this._loading = false;
          this._loadNextFragment();
        },
        onError: (err) => {
          this._loading = false;
          this._loadNextFragment();
        },
        onTimeout: () => {
          this._loading = false;
          this._loadNextFragment();
        }
      }
    );
  }

  private async _processFragment(data: ArrayBuffer, frag: Fragment): Promise<void> {
    const uint8 = new Uint8Array(data);
    try {
      const baseDts = Math.round(frag.start * 90000);
      const { remuxResult } = await this._transmuxer.transmux(uint8, frag.start, baseDts, false);

      if (!remuxResult) return;

      if (remuxResult.initSegment) {
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.initSegment.buffer as ArrayBuffer, type: TrackTypes.AUDIO });
      }
      if (remuxResult.data) {
        this.hls.trigger(Events.BUFFER_APPENDING, { data: remuxResult.data.buffer as ArrayBuffer, type: TrackTypes.AUDIO });
      }
    } catch (err) {
      this.logger.error('Audio processing error', err);
    }
  }

  destroy(): void {
    if (this._checkBufferTimer) clearTimeout(this._checkBufferTimer);
    this._transmuxer.destroy();
  }
}
