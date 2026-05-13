import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { MediaPlaylist, ManifestData } from '../types/level';

export class AudioTrackController {
  private hls: Hls;
  private _tracks: MediaPlaylist[] = [];
  private _trackId: number = -1;

  constructor(hls: Hls) {
    this.hls = hls;
  }

  get audioTracks(): MediaPlaylist[] {
    return this._tracks;
  }

  get audioTrack(): number {
    return this._trackId;
  }

  set audioTrack(newId: number) {
    this.setAudioTrack(newId);
  }

  public setAudioTrack(newId: number): void {
    if (this._trackId === newId) return;
    if (newId < -1 || newId >= this._tracks.length) return;

    this._trackId = newId;
    const track = newId === -1 ? null : this._tracks[newId];
    this.hls.trigger(Events.AUDIO_TRACK_SWITCHING, { id: newId, track });
    
    // In a real implementation, this would trigger the AudioStreamController
    // to start loading segments from the new track's URL.
    
    this.hls.trigger(Events.AUDIO_TRACK_SWITCHED, { id: newId, track });
  }

  _onManifestParsed = (data: ManifestData): void => {
    this._tracks = data.audioTracks || [];
    if (this._tracks.length > 0) {
      // Find default track
      const defaultIndex = this._tracks.findIndex(t => t.default);
      this._trackId = defaultIndex !== -1 ? defaultIndex : 0;
    } else {
      this._trackId = -1;
    }
  };

  destroy(): void {
    this._tracks = [];
  }
}
