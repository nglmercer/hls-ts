import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { PlaylistParseResult } from '../parser/m3u8-parser';
import { Logger } from '../utils/logger';

export class MetadataController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private _dateranges: NonNullable<PlaylistParseResult['dateranges']> = [];
  private _activeDateranges: Set<string> = new Set();
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private logger = new Logger('MetadataController');

  constructor(hls: Hls) {
    this.hls = hls;
  }

  _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
    this._startPolling();
  };

  _onMediaDetached = (): void => {
    this._stopPolling();
    this._media = null;
  };

  _onLevelUpdated = (data: { details: PlaylistParseResult }): void => {
    if (data.details.dateranges) {
      this._dateranges = data.details.dateranges;
    }
  };

  private _startPolling(): void {
    this._stopPolling();
    this._pollTimer = setInterval(() => this._checkDateranges(), 500);
  }

  private _stopPolling(): void {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
  }

  private _checkDateranges(): void {
    if (!this._media || this._dateranges.length === 0) return;

    const currentTime = this._media.currentTime;
    // Note: This assumes dateranges can be mapped to timeline via Program Date Time.
    // For simplicity, if we don't have absolute mapping, we might need more logic.
    // However, many dateranges in HLS are tied to PDT.
    
    // For this "easy" implementation, we'll assume we have a way to map them or
    // we just use them as manifest-level metadata for now.
    
    // TODO: Implement PDT to timeline mapping for precise daterange events.
  }

  destroy(): void {
    this._stopPolling();
    this._activeDateranges.clear();
  }
}
