import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { MediaPlaylist, ManifestData } from '../types/level';

export class SubtitleTrackController {
  private hls: Hls;
  private _tracks: MediaPlaylist[] = [];
  private _trackId: number = -1;
  private _subtitleDisplay: boolean = true;

  constructor(hls: Hls) {
    this.hls = hls;
  }

  get subtitleTracks(): MediaPlaylist[] {
    return this._tracks;
  }

  get subtitleTrack(): number {
    return this._trackId;
  }

  set subtitleTrack(newId: number) {
    this.setSubtitleTrack(newId);
  }

  get subtitleDisplay(): boolean {
    return this._subtitleDisplay;
  }

  set subtitleDisplay(value: boolean) {
    this._subtitleDisplay = value;
    // Logic to show/hide text tracks on the video element
  }

  public setSubtitleTrack(newId: number): void {
    if (this._trackId === newId) return;
    if (newId < -1 || newId >= this._tracks.length) return;

    this._trackId = newId;
    const track = newId === -1 ? null : this._tracks[newId];
    this.hls.trigger(Events.SUBTITLE_TRACK_SWITCH, { id: newId, track });
  }

  _onManifestParsed = (data: ManifestData): void => {
    this._tracks = data.subtitleTracks || [];
    // Subtitles are usually OFF by default (-1)
    this._trackId = -1;
  };

  destroy(): void {
    this._tracks = [];
  }
}
