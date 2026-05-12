import { EventEmitter, type HlsEventEmitter } from './EventEmitter';
import type { EventHandler } from './EventEmitter';
import { Events } from '../types/events';
import { defaultConfig, type HlsConfig } from '../types/config';
import { ErrorTypes } from '../types/errors';
import type { ManifestData, Level } from '../types/level';
import { PlaylistLoader } from '../loader/playlist-loader';
import { parseMasterPlaylist, parseMediaPlaylist } from '../parser/m3u8-parser';
import type { HlsError } from '../types/errors';
import { BufferController } from '../controller/buffer-controller';
import { LevelController, StreamController } from '../controller/stream-controller';
import { AbrController, GapController } from '../controller/abr-controller';
import { ErrorController } from '../controller/error-controller';
import { CapLevelController } from '../controller/cap-level-controller';

interface ComponentAPI {
  destroy(): void;
}

export class Hls implements HlsEventEmitter {
  static defaultConfig: HlsConfig | undefined;

  public readonly config: HlsConfig;
  public readonly userConfig: Partial<HlsConfig>;
  public readonly logger: Console;

  private _emitter: EventEmitter = new EventEmitter();
  private _media: HTMLMediaElement | null = null;
  private _url: string | null = null;
  private coreComponents: ComponentAPI[] = [];
  private playlistLoader: PlaylistLoader;
  private bufferController: BufferController;
  private levelController: LevelController;
  private streamController: StreamController;
  private abrController: AbrController;
  private gapController: GapController;
  private errorController: ErrorController;
  private capLevelController: CapLevelController;

  constructor(userConfig: Partial<HlsConfig> = {}) {
    this.userConfig = userConfig;
    this.config = { ...defaultConfig, ...(Hls.defaultConfig as Partial<HlsConfig> || {}), ...userConfig };
    this.logger = console;
    this.playlistLoader = new PlaylistLoader();

    this.abrController = new AbrController(this);
    this.gapController = new GapController();
    this.errorController = new ErrorController(this);
    this.capLevelController = new CapLevelController(this);
    this.bufferController = new BufferController(this);
    this.levelController = new LevelController(this, this.abrController);
    this.streamController = new StreamController(this, this.levelController, this.abrController);

    this.coreComponents = [
      this.bufferController,
      this.levelController,
      this.streamController,
      this.abrController,
      this.gapController,
      this.errorController,
      this.capLevelController,
    ];

    this._wireControllers();
  }

  get abr(): AbrController {
    return this.abrController;
  }

  get autoLevelCapping(): number {
    return this.capLevelController.autoLevelCapping;
  }

  set autoLevelCapping(value: number) {
    this.capLevelController.autoLevelCapping = value;
  }

  static isMSESupported(): boolean {
    return typeof MediaSource !== 'undefined' && typeof MediaSource.isTypeSupported === 'function';
  }

  static isSupported(): boolean {
    return Hls.isMSESupported();
  }

  loadSource(url: string): void {
    this._url = url;
    this.trigger(Events.MANIFEST_LOADING, { url });
    this._loadManifest(url);
  }

  attachMedia(media: HTMLMediaElement): void {
    this._media = media;
    this.trigger(Events.MEDIA_ATTACHED, { media });
  }

  detachMedia(): void {
    this.trigger(Events.MEDIA_DETACHED, {});
    this._media = null;
  }

  destroy(): void {
    this.trigger(Events.DESTROYING, {});
    for (const comp of this.coreComponents) comp.destroy();
    this._emitter.removeAllListeners();
    this._media = null;
    this._url = null;
  }

  get url(): string | null {
    return this._url;
  }

  get media(): HTMLMediaElement | null {
    return this._media;
  }

  get levels(): Level[] {
    return this.levelController.levels;
  }

  on(event: string, handler: (...args: any[]) => void): void {
    this._emitter.on(event, handler);
  }

  once(event: string, handler: (...args: any[]) => void): void {
    this._emitter.once(event, handler);
  }

  off(event: string, handler: (...args: any[]) => void): void {
    this._emitter.off(event, handler);
  }

  emit(event: string, ...args: any[]): void {
    this._emitter.emit(event, ...args);
  }

  trigger(event: string, ...args: any[]): void {
    this._emitter.emit(event, ...args);
  }

  removeAllListeners(event?: string): void {
    this._emitter.removeAllListeners(event);
  }

  listeners(event: string): EventHandler[] {
    return this._emitter.listeners(event);
  }

  private _wireControllers(): void {
    const bc = this.bufferController as any;
    const lc = this.levelController as any;
    const sc = this.streamController as any;
    const ac = this.abrController as any;
    const gc = this.gapController as any;
    const ec = this.errorController as any;
    const cc = this.capLevelController as any;

    this.on(Events.MEDIA_ATTACHED, bc._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, bc._onMediaDetached);
    this.on(Events.MANIFEST_PARSED, bc._onManifestParsed);
    this.on(Events.BUFFER_CODECS, bc._onBufferCodecs);
    this.on(Events.BUFFER_APPENDING, bc._onBufferAppending);
    this.on(Events.BUFFER_FLUSHING, bc._onBufferFlushing);

    this.on(Events.MANIFEST_PARSED, lc._onManifestParsed);
    this.on(Events.LEVEL_LOADING, lc._onLevelLoading);
    this.on(Events.LEVEL_LOADED, lc._onLevelLoaded);

    this.on(Events.MEDIA_ATTACHED, sc._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, sc._onMediaDetached);
    this.on(Events.MANIFEST_PARSED, sc._onManifestParsed);
    this.on(Events.LEVEL_UPDATED, sc._onLevelUpdated);
    this.on(Events.FRAG_LOADED, sc._onFragLoaded);

    this.on(Events.MANIFEST_PARSED, ac._onManifestParsed);
    this.on(Events.FRAG_LOADED, ac._onFragLoaded);
    this.on(Events.LEVEL_LOADED, ac._onLevelLoaded);

    this.on(Events.MEDIA_ATTACHED, gc._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, gc._onMediaDetached);
    this.on(Events.BUFFER_FLUSHED, gc._onBufferFlushed);
    this.on(Events.FRAG_BUFFERED, gc._onFragBuffered);

    this.on(Events.ERROR, ec._onError);

    this.on(Events.MEDIA_ATTACHED, cc._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, cc._onMediaDetached);
    this.on(Events.MANIFEST_PARSED, cc._onManifestParsed);
  }

  private _loadManifest(url: string): void {
    this.playlistLoader.load(
      { url },
      {
        onSuccess: (response) => {
          try {
            const baseurl = response.url.substring(0, response.url.lastIndexOf('/') + 1);
            if (response.data.includes('#EXT-X-STREAM-INF')) {
              const result = parseMasterPlaylist(response.data, baseurl);
              const manifest: ManifestData = {
                levels: result.levels,
                audioTracks: result.audioTracks,
                subtitleTracks: result.subtitleTracks,
                url: response.url,
              };
              this.trigger(Events.MANIFEST_LOADED, { data: response.data, ...manifest });
              this.trigger(Events.MANIFEST_PARSED, { ...manifest });
            } else if (response.data.includes('#EXTINF')) {
              const result = parseMediaPlaylist(response.data, baseurl);
              this.trigger(Events.LEVEL_LOADED, {
                url: response.url,
                data: response.data,
                ...result,
              });
            }
          } catch (err) {
            const error: HlsError = {
              type: ErrorTypes.OTHER_ERROR,
              details: 'manifestParsingError' as any,
              fatal: true,
              reason: `Manifest parsing error: ${(err as Error).message}`,
            };
            this.trigger(Events.ERROR, error);
          }
        },
        onError: (err) => {
          const error: HlsError = {
            type: ErrorTypes.NETWORK_ERROR,
            details: 'manifestLoadError' as any,
            fatal: true,
            reason: err.text,
          };
          this.trigger(Events.ERROR, error);
        },
        onTimeout: () => {
          const error: HlsError = {
            type: ErrorTypes.NETWORK_ERROR,
            details: 'manifestLoadTimeout' as any,
            fatal: true,
            reason: 'Manifest load timed out',
          };
          this.trigger(Events.ERROR, error);
        },
      },
    );
  }
}
