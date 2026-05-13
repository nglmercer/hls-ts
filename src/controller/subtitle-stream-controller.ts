import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { MediaPlaylist, Fragment } from '../types/level';
import { FragmentLoader } from '../loader/fragment-loader';
import { PlaylistLoader } from '../loader/playlist-loader';
import { parseMediaPlaylist, type PlaylistParseResult } from '../parser/m3u8-parser';
import { parseVTT, type VTTCueData } from '../utils/vtt-parser';
import { Logger } from '../utils/logger';

export class SubtitleStreamController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _track: MediaPlaylist | null = null;
  private _textTrack: TextTrack | null = null;
  private _fragmentLoader: FragmentLoader;
  private _playlistLoader: PlaylistLoader;
  private _fragQueue: Fragment[] = [];
  private _loading: boolean = false;
  private _loadedFrags: Set<string> = new Set();
  private logger = new Logger('SubtitleStreamController');

  constructor(hls: Hls) {
    this.hls = hls;
    this._fragmentLoader = new FragmentLoader();
    this._playlistLoader = new PlaylistLoader();
  }

  _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
  };

  _onMediaDetached = (): void => {
    this._media = null;
    this._textTrack = null;
  };

  _onSubtitleTrackSwitch = (data: { id: number; track: MediaPlaylist | null }): void => {
    this._track = data.track;
    this._fragQueue = [];
    this._loadedFrags.clear();
    this._fragmentLoader.abort();

    if (this._textTrack) {
      // Clear existing cues if any
      while (this._textTrack.cues?.length) {
        this._textTrack.removeCue(this._textTrack.cues[0]!);
      }
    }

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
          this._onPlaylistLoaded(result);
        },
        onError: () => { },
        onTimeout: () => { }
      }
    );
  }

  private _onPlaylistLoaded(data: PlaylistParseResult): void {
    let totalDuration = 0;
    this._fragQueue = data.fragments.map(f => {
      const frag: Fragment = {
        url: f.url,
        sn: f.sn,
        level: -1,
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
    this._ensureTextTrack();
    this._loadNextFragment();
  }

  private _ensureTextTrack(): void {
    if (!this._media || this._textTrack) return;
    this._textTrack = this._media.addTextTrack('subtitles', this._track?.name || 'Subtitles', this._track?.language || 'en');
    this._textTrack.mode = 'showing';
  }

  private _loadNextFragment(): void {
    if (this._loading || !this._media || this._fragQueue.length === 0) return;

    const frag = this._fragQueue.find(f => !this._loadedFrags.has(f.url));
    if (!frag) return;

    this._loading = true;
    this._fragmentLoader.load(
      { url: frag.url, frag },
      {
        onSuccess: (response) => {
          const text = new TextDecoder().decode(response.data);
          const cues = parseVTT(text);
          this._addCues(cues);
          this._loadedFrags.add(frag.url);
          this._loading = false;
          this._loadNextFragment();
        },
        onError: () => {
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

  private _addCues(cues: VTTCueData[]): void {
    if (!this._textTrack) return;
    for (const cueData of cues) {
      try {
        const cue = new VTTCue(cueData.start, cueData.end, cueData.text);
        this._textTrack.addCue(cue);
      } catch (e) {
        // Ignore overlapping cues or other issues
      }
    }
  }

  destroy(): void {
    this._loadedFrags.clear();
  }
}
