import { Events } from '../types/events';

export class CapLevelController {
  private hls: any;
  private _media: HTMLMediaElement | null = null;
  private _levels: number = 0;
  private _autoLevelCapping: number = -1;
  private _lastWidth: number = 0;
  private _lastHeight: number = 0;
  private _resizeHandler: (() => void) | null = null;
  private _firstLevel: number = 0;

  constructor(hls: any) {
    this.hls = hls;
  }

  get autoLevelCapping(): number {
    return this._autoLevelCapping;
  }

  set autoLevelCapping(value: number) {
    this._autoLevelCapping = value;
  }

  get firstLevel(): number {
    return this._firstLevel;
  }

  set firstLevel(value: number) {
    this._firstLevel = value;
  }

  destroy(): void {
    if (typeof window !== 'undefined' && this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
  }

  private _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
    this._resizeHandler = () => this._onResize();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._resizeHandler);
    }
    this._onResize();
  };

  private _onMediaDetached = (): void => {
    if (typeof window !== 'undefined' && this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    this._media = null;
  };

  private _onManifestParsed = (data: { levels: any[] }): void => {
    this._levels = data.levels.length;
    this._onResize();
  };

  private _onResize(): void {
    if (!this._media || this._levels <= 1) return;

    const width = this._media.clientWidth;
    const height = this._media.clientHeight;

    if (width === this._lastWidth && height === this._lastHeight) return;
    this._lastWidth = width;
    this._lastHeight = height;

    const levels = this.hls.levels as any[];
    if (!levels || levels.length === 0) return;

    const pixelArea = width * height;
    let cappedLevel = this._firstLevel;

    for (let i = levels.length - 1; i >= 0; i--) {
      const level = levels[i];
      const levelArea = (level.width || 0) * (level.height || 0);
      if (levelArea <= pixelArea * 1.5) {
        cappedLevel = i;
        break;
      }
    }

    this._autoLevelCapping = cappedLevel;
  }
}
