import type { Hls } from '../core/Hls';
import type { Level, Fragment } from '../types/level';

export class EWMA {
  private _alpha: number;
  private _estimate: number = 0;
  private _total: number = 0;
  private _samples: number = 0;

  constructor(alpha: number, initialEstimate: number = 0) {
    this._alpha = alpha;
    this._estimate = initialEstimate;
  }

  sample(weight: number, value: number): void {
    const adjAlpha = Math.min(this._alpha * weight, 1);
    this._estimate = value * adjAlpha + this._estimate * (1 - adjAlpha);
    this._total += value;
    this._samples++;
  }

  get estimate(): number {
    return this._estimate;
  }

  get total(): number {
    return this._total;
  }

  get samples(): number {
    return this._samples;
  }
}

export class AbrController {
  private hls: Hls;
  private _fastEwma: EWMA;
  private _slowEwma: EWMA;
  private _currentLevel: number = -1;
  private _levels: Array<{ id: number; bitrate: number; width: number; height: number }> = [];
  private _lastFragLoadTime: number = 0;
  private _lastFragLoadedBytes: number = 0;
  private _bwEstimate: number = 0;
  private _initSent: boolean = false;

  constructor(hls: Hls) {
    this.hls = hls;
    const config = hls.config.abrController;
    this._fastEwma = new EWMA(1 / (config.abrEwmaFastVoD || 3));
    this._slowEwma = new EWMA(1 / (config.abrEwmaSlowVoD || 9));
  }

  get bwEstimate(): number {
    return this._bwEstimate;
  }

  destroy(): void { }

  public _onManifestParsed = (data: { levels: Level[] }): void => {
    this._levels = data.levels.map((l: Level, i: number) => ({
      id: i,
      bitrate: l.bitrate,
      width: l.width || 0,
      height: l.height || 0,
    }));
  };

  public _onFragLoaded = (data: { frag: Fragment; stats: { trequest: number; tfirst: number; tload: number; loaded: number } }): void => {
    const { stats } = data;
    if (stats.trequest === 0 || stats.tfirst === 0 || stats.loaded === 0) return;

    const loadTimeMs = stats.tload - stats.tfirst;
    if (loadTimeMs <= 0) return;

    const bwBytesPerMs = stats.loaded / loadTimeMs;
    const bwBitsPerSec = bwBytesPerMs * 8 * 1000;

    this._fastEwma.sample(1, bwBitsPerSec);
    this._slowEwma.sample(1, bwBitsPerSec);

    const config = this.hls.config.abrController;
    if (config.abrBandWidthFactor !== undefined) {
      this._bwEstimate = Math.min(
        this._fastEwma.estimate * config.abrBandWidthFactor,
        this._slowEwma.estimate * (config.abrBandWidthUpFactor || 0.7),
      );
    } else {
      this._bwEstimate = this._fastEwma.estimate;
    }

    this._lastFragLoadTime = loadTimeMs;
    this._lastFragLoadedBytes = stats.loaded;
  };

  public _onLevelLoaded = (data: { level: Level }): void => {
    this._currentLevel = data.level?.id ?? this._currentLevel;
  };

  getNextLevel(bitrate: number): number {
    if (this._levels.length <= 1) return 0;

    let lo = 0;
    let hi = this._levels.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this._levels[mid].bitrate <= bitrate) {
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return Math.min(lo, this._levels.length - 1);
  }
}

export class GapController {
  private _media: HTMLMediaElement | null = null;
  private _lastSeek: number = 0;
  private _gapCount: number = 0;

  constructor() { }

  destroy(): void { }

  public _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
    this._lastSeek = 0;
    this._gapCount = 0;
  };

  public _onMediaDetached = (): void => {
    this._media = null;
  };

  public _onBufferFlushed = (): void => {
    this._checkGap();
  };

  public _onFragBuffered = (): void => {
    this._checkGap();
  };

  private _checkGap(): void {
    if (!this._media || this._media.seeking || this._media.paused) return;

    const currentTime = this._media.currentTime;
    const buffered = this._media.buffered;

    if (buffered.length === 0) return;

    let inBuffer = false;
    for (let i = 0; i < buffered.length; i++) {
      if (currentTime >= buffered.start(i) && currentTime < buffered.end(i)) {
        inBuffer = true;
        break;
      }
    }

    if (!inBuffer) {
      for (let i = 0; i < buffered.length; i++) {
        if (currentTime < buffered.start(i) && buffered.start(i) - currentTime < 0.5) {
          this._media.currentTime = buffered.start(i) + 0.001;
          this._gapCount++;
          break;
        }
      }
    }
  }
}
