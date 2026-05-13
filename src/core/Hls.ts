import { EventEmitter, type HlsEventEmitter } from './EventEmitter';
import type { EventHandler } from './EventEmitter';
import { Events } from '../types/events';
import { defaultConfig, type HlsConfig } from '../types/config';
import type { ManifestData } from '../types/level';
import { PlaylistLoader } from '../loader/playlist-loader';
import { parseMasterPlaylist, parseMediaPlaylist } from '../parser/m3u8-parser';
import { ErrorTypes, ErrorDetails } from '../types/errors';
import type { HlsError } from '../types/errors';
import { BufferController } from '../controller/buffer-controller';
import { LevelController } from '../controller/level-controller';
import { StreamController } from '../controller/stream-controller';
import { AbrController, GapController } from '../controller/abr-controller';
import { ErrorController } from '../controller/error-controller';
import { CapLevelController } from '../controller/cap-level-controller';
import { AudioTrackController } from '../controller/audio-track-controller';
import { SubtitleTrackController } from '../controller/subtitle-track-controller';
import { AudioStreamController } from '../controller/audio-stream-controller';
import { SubtitleStreamController } from '../controller/subtitle-stream-controller';
import { MetadataController } from '../controller/metadata-controller';
import { LatencyController } from '../controller/latency-controller';
import { EMEController } from '../controller/eme-controller';
import { Logger } from '../utils/logger';

interface ComponentAPI {
  destroy(): void;
}

export class Hls implements HlsEventEmitter {
  static defaultConfig: HlsConfig | undefined;

  public readonly config: HlsConfig;
  public readonly userConfig: Partial<HlsConfig>;
  public readonly logger: Logger;
  private _emitter: EventEmitter = new EventEmitter();

  private _media: HTMLMediaElement | null = null;
  private _url: string | null = null;
  private coreComponents: ComponentAPI[] = [];
  private playlistLoader: PlaylistLoader;
  private bufferController: BufferController;
  private levelController: LevelController;
  public streamController: StreamController;
  private abrController: AbrController;
  private gapController: GapController;
  private errorController: ErrorController;
  private capLevelController: CapLevelController;
  private audioTrackController: AudioTrackController;
  private subtitleTrackController: SubtitleTrackController;
  private audioStreamController: AudioStreamController;
  private subtitleStreamController: SubtitleStreamController;
  private metadataController: MetadataController;
  private latencyController: LatencyController;
  private emeController: EMEController;

  constructor(userConfig: Partial<HlsConfig> = {}) {
    this.userConfig = userConfig;
    this.config = { ...defaultConfig, ...(Hls.defaultConfig as Partial<HlsConfig> || {}), ...userConfig };
    this.logger = new Logger('Hls');
    this.playlistLoader = new PlaylistLoader();

    this.abrController = new AbrController(this);
    this.gapController = new GapController();
    this.errorController = new ErrorController(this);
    this.capLevelController = new CapLevelController(this);
    this.audioTrackController = new AudioTrackController(this);
    this.subtitleTrackController = new SubtitleTrackController(this);
    this.audioStreamController = new AudioStreamController(this);
    this.subtitleStreamController = new SubtitleStreamController(this);
    this.metadataController = new MetadataController(this);
    this.latencyController = new LatencyController(this);
    this.emeController = new EMEController(this);
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
      this.audioTrackController,
      this.subtitleTrackController,
      this.audioStreamController,
      this.subtitleStreamController,
      this.metadataController,
      this.latencyController,
      this.emeController,
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
    media.addEventListener('seeking', this._onMediaSeeking);
    media.addEventListener('seeked', this._onMediaSeeked);
    this.trigger(Events.MEDIA_ATTACHED, { media });
  }

  detachMedia(): void {
    if (this._media) {
      this._media.removeEventListener('seeking', this._onMediaSeeking);
      this._media.removeEventListener('seeked', this._onMediaSeeked);
    }
    this._emitter.removeAllListeners(Events.MEDIA_DETACHED);
    this.trigger(Events.MEDIA_DETACHED);
    this._media = null;
  }

  destroy(): void {
    this.trigger(Events.DESTROYING);
    for (const comp of this.coreComponents) comp.destroy();
    this.playlistLoader.abort();
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

  get levels(): import('../types/level').Level[] {
    return this.levelController.levels;
  }

  get currentLevel(): number {
    return this.levelController.currentLevel?.id ?? -1;
  }

  set currentLevel(newLevel: number) {
    this.levelController.loadLevel(newLevel);
  }

  get nextLevel(): number {
    return this.currentLevel;
  }

  set nextLevel(newLevel: number) {
    this.levelController.loadLevel(newLevel);
  }

  get audioTrack(): number {
    return this.audioTrackController.audioTrack;
  }

  set audioTrack(trackId: number) {
    this.audioTrackController.audioTrack = trackId;
  }

  get audioTracks(): import('../types/level').MediaPlaylist[] {
    return this.audioTrackController.audioTracks;
  }

  get subtitleTrack(): number {
    return this.subtitleTrackController.subtitleTrack;
  }

  set subtitleTrack(trackId: number) {
    this.subtitleTrackController.subtitleTrack = trackId;
  }

  get subtitleTracks(): import('../types/level').MediaPlaylist[] {
    return this.subtitleTrackController.subtitleTracks;
  }

  get bandwidthEstimate(): number {
    return this.abrController.bwEstimate;
  }

  get liveSyncPosition(): number {
    return this.media?.currentTime ?? 0;
  }

  startLoad(startPosition: number = -1): void {
    if (startPosition !== -1) {
      this.config.startPosition = startPosition;
    }
    this.trigger(Events.MANIFEST_LOADING, { url: this._url! });
  }

  stopLoad(): void {
    // Basic stop logic
  }

  seekTo(time: number): void {
    if (!this._media) return;
    this.streamController._seekTo(time);
  }

  recoverMediaError(): void {
    this.errorController.recoverMediaError();
  }

  on<EventName extends import('../types/events').Event>(event: EventName, handler: EventHandler<EventName>): void {
    return this._emitter.on(event, handler);
  }

  once<EventName extends import('../types/events').Event>(event: EventName, handler: EventHandler<EventName>): void {
    return this._emitter.once(event, handler);
  }

  off<EventName extends import('../types/events').Event>(event: EventName, handler: EventHandler<EventName>): void {
    return this._emitter.off(event, handler);
  }

  emit<EventName extends import('../types/events').Event>(event: EventName, ...data: import('../types/events').HlsEventPayloads[EventName] extends void ? [] : [import('../types/events').HlsEventPayloads[EventName]]): void {
    return this._emitter.emit(event, ...data);
  }

  trigger<EventName extends import('../types/events').Event>(event: EventName, ...data: import('../types/events').HlsEventPayloads[EventName] extends void ? [] : [import('../types/events').HlsEventPayloads[EventName]]): void {
    return this._emitter.trigger(event, ...data);
  }

  removeAllListeners(event?: import('../types/events').Event): void {
    return this._emitter.removeAllListeners(event);
  }

  listeners(event: import('../types/events').Event): EventHandler<any>[] {
    return this._emitter.listeners(event);
  }

  private _onMediaSeeking = (): void => {
    this.trigger(Events.MEDIA_SEEKING);
  };

  private _onMediaSeeked = (): void => {
    this.trigger(Events.MEDIA_SEEKED);
  };

  private _wireControllers(): void {
    const bc = this.bufferController;
    const lc = this.levelController;
    const sc = this.streamController;
    const ac = this.abrController;
    const gc = this.gapController;
    const ec = this.errorController;
    const cc = this.capLevelController;

    this.on(Events.MEDIA_ATTACHED, bc._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, bc._onMediaDetached);
    this.on(Events.MANIFEST_PARSED, bc._onManifestParsed);
    this.on(Events.BUFFER_CODECS, bc._onBufferCodecs);
    this.on(Events.BUFFER_APPENDING, bc._onBufferAppending);
    this.on(Events.BUFFER_FLUSHING, bc._onBufferFlushing);
    this.on(Events.BUFFER_RESET, bc._onBufferReset);
    this.on(Events.LEVEL_UPDATED, bc._onLevelUpdated);

    this.on(Events.MANIFEST_PARSED, lc._onManifestParsed);
    this.on(Events.LEVEL_LOADING, lc._onLevelLoading);
    this.on(Events.LEVEL_LOADED, lc._onLevelLoaded);

    this.on(Events.MEDIA_ATTACHED, sc._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, sc._onMediaDetached);
    this.on(Events.MEDIA_SEEKING, sc._onSeeking);
    this.on(Events.MEDIA_SEEKED, sc._onSeeked);
    this.on(Events.BUFFER_RESET, sc._onBufferReset);
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

    this.on(Events.MANIFEST_PARSED, this.audioTrackController._onManifestParsed);
    this.on(Events.MANIFEST_PARSED, this.subtitleTrackController._onManifestParsed);

    this.on(Events.MEDIA_ATTACHED, this.audioStreamController._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, this.audioStreamController._onMediaDetached);
    this.on(Events.AUDIO_TRACK_SWITCHING, this.audioStreamController._onAudioTrackSwitching);

    this.on(Events.MEDIA_ATTACHED, this.subtitleStreamController._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, this.subtitleStreamController._onMediaDetached);
    this.on(Events.SUBTITLE_TRACK_SWITCH, this.subtitleStreamController._onSubtitleTrackSwitch);

    this.on(Events.MEDIA_ATTACHED, this.metadataController._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, this.metadataController._onMediaDetached);
    this.on(Events.LEVEL_UPDATED, this.metadataController._onLevelUpdated);
    this.on(Events.FRAG_PARSING_METADATA, this.metadataController._onFragParsingMetadata);

    this.on(Events.MEDIA_ATTACHED, this.latencyController._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, this.latencyController._onMediaDetached);
    this.on(Events.LEVEL_UPDATED, this.latencyController._onLevelUpdated);

    this.on(Events.MEDIA_ATTACHED, this.emeController._onMediaAttached);
    this.on(Events.MEDIA_DETACHED, this.emeController._onMediaDetached);
    this.on(Events.MANIFEST_PARSED, this.emeController._onManifestParsed);
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
              details: ErrorDetails.MANIFEST_PARSING_ERROR,
              fatal: true,
              reason: `Manifest parsing error: ${(err as Error).message}`,
            };
            this.trigger(Events.ERROR, error);
          }
        },
        onError: (err) => {
          const error: HlsError = {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.MANIFEST_LOAD_ERROR,
            fatal: true,
            reason: err.text,
          };
          this.trigger(Events.ERROR, error);
        },
        onTimeout: () => {
          const error: HlsError = {
            type: ErrorTypes.NETWORK_ERROR,
            details: ErrorDetails.MANIFEST_LOAD_TIMEOUT,
            fatal: true,
            reason: 'Manifest load timed out',
          };
          this.trigger(Events.ERROR, error);
        },
      },
    );
  }
}