import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import { TrackTypes, SourceBufferModes, type TrackType, ErrorDetails, ErrorTypes, MediaSourceReadyStates, MediaSourceEvents, SourceBufferEvents, MimeTypes, DefaultCodecs } from '../types';
import type { Level, LevelDetails, ManifestData } from '../types/level';
import { Logger } from '../utils/logger';

interface CodecInfo {
  videoCodec?: string;
  audioCodec?: string;
}

export class BufferController {
  private hls: Hls;
  private _mediaSource: MediaSource | null = null;
  private _sourceBuffers: Map<TrackType, SourceBuffer> = new Map();
  private _media: HTMLMediaElement | null = null;
  private _hasAlternateAudio: boolean = false;
  private _objectUrl: string = '';
  private _codecs: CodecInfo = {};
  private _queues: Map<TrackType, ArrayBuffer[]> = new Map();
  private _queueIdx: Map<TrackType, number> = new Map();
  private _appending: Map<TrackType, boolean> = new Map();
  private _sourceBufferReady: boolean = false;
  private _pendingCodecs: CodecInfo | null = null;
  private _evicting: Map<TrackType, boolean> = new Map();
  private _retryData: Map<TrackType, ArrayBuffer | null> = new Map();
  private logger = new Logger('BufferController');

  constructor(hls: Hls) {
    this.hls = hls;
  }

  destroy(): void {
    this._cleanMediaSource();
  }

  _onMediaAttached = ({ media }: { media: HTMLMediaElement }): void => {
    this._media = media;
    if (typeof MediaSource !== 'undefined') {
      this._createMediaSource();
    }
  };

  _onMediaDetached = (): void => {
    this._cleanMediaSource();
  };

  _onManifestParsed = (data: ManifestData): void => {
    this._hasAlternateAudio = data.audioTracks && data.audioTracks.length > 0;
    if (data.levels.length > 0) {
      const level = data.levels[0];
      const codecs = this._parseCodecs(level);
      // If we have alternate audio, ignore the audio codec from the video level
      if (this._hasAlternateAudio) {
        delete codecs.audioCodec;
      }
      this.hls.trigger(Events.BUFFER_CODECS, codecs);
    }
  };

  _onLevelUpdated = (data: { level: Level; details: LevelDetails }): void => {
    if (this._mediaSource && this._mediaSource.readyState === MediaSourceReadyStates.OPEN) {
      if (!data.details.live && data.details.totalduration) {
        const duration = Number(data.details.totalduration);
        const updating = Array.from(this._sourceBuffers.values()).some(sb => sb.updating);
        if (!isNaN(duration) && duration > 0 && this._mediaSource.duration !== duration && !updating) {
          try {
            this._mediaSource.duration = duration;
          } catch (e) {
            this.logger.warn('Failed to set duration:', e);
          }
        }
      }
    }
  };

  _onBufferCodecs = (data: CodecInfo): void => {
    this._codecs = data;
    if (this._mediaSource && this._mediaSource.readyState === MediaSourceReadyStates.OPEN) {
      this._createSourceBuffer();
    } else {
      this._pendingCodecs = data;
    }
  };

  _onBufferAppending = (data: { data: ArrayBuffer; type: TrackType }): void => {
    const type = data.type || TrackTypes.VIDEO;
    if (!this._queues.has(type)) {
      this._queues.set(type, []);
      this._queueIdx.set(type, 0);
    }
    this._queues.get(type)!.push(data.data);
    this._processQueue(type);
  };

  _onBufferFlushing = (data: { startOffset: number; endOffset: number; type?: TrackType }): void => {
    const types = data.type ? [data.type] : Array.from(this._sourceBuffers.keys());
    for (const type of types) {
      const sb = this._sourceBuffers.get(type);
      if (!sb) continue;
      if (sb.updating) {
        try { sb.abort(); } catch { /* ignore */ }
      }
      try {
        const end = (data.endOffset === Infinity && this._mediaSource) ? this._mediaSource.duration : data.endOffset;
        if (end > data.startOffset) {
          sb.remove(data.startOffset, end);
        }
      } catch { /* ignore */ }
    }
  };

  _onBufferReset = (): void => {
    this._queues.clear();
    this._queueIdx.clear();
    this._retryData.clear();
    this._appending.clear();
    this._evicting.clear();
    for (const sb of this._sourceBuffers.values()) {
      if (sb.updating) {
        try { sb.abort(); } catch { /* ignore */ }
      }
    }
  };

  private _createMediaSource(): void {
    this._cleanMediaSource();

    if (!this._media) return;
    const ms = new MediaSource();
    this._mediaSource = ms;
    this._objectUrl = URL.createObjectURL(ms);
    this._media.src = this._objectUrl;

    const onSourceOpen = () => {
      ms.removeEventListener(MediaSourceEvents.SOURCE_OPEN, onSourceOpen);
      if (this._pendingCodecs) {
        this._codecs = this._pendingCodecs;
        this._pendingCodecs = null;
      }

      // Only create if we actually have codecs, otherwise wait for _onBufferCodecs
      if (this._codecs.videoCodec || this._codecs.audioCodec) {
        this._createSourceBuffer();
      }
    };

    ms.addEventListener(MediaSourceEvents.SOURCE_OPEN, onSourceOpen);
  }

  private _cleanMediaSource(): void {
    if (this._mediaSource?.readyState === MediaSourceReadyStates.OPEN) {
      for (const sb of this._sourceBuffers.values()) {
        try { this._mediaSource.removeSourceBuffer(sb); } catch { /* ignore */ }
      }
    }

    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
    }

    this._mediaSource = null;
    this._sourceBuffers.clear();
    this._objectUrl = '';
    this._queues.clear();
    this._queueIdx.clear();
    this._appending.clear();
    this._evicting.clear();
    this._retryData.clear();
    this._sourceBufferReady = false;
    this._pendingCodecs = null;
  }

  private _createSourceBuffer(): void {
    if (!this._mediaSource || this._mediaSource.readyState !== MediaSourceReadyStates.OPEN) return;
    if (this._sourceBuffers.size > 0) return;

    // Build a combined MIME type for both video and audio
    const codecParts: string[] = [];
    if (this._codecs.videoCodec) codecParts.push(this._codecs.videoCodec);
    if (this._codecs.audioCodec) codecParts.push(this._codecs.audioCodec);

    if (codecParts.length === 0) {
      codecParts.push(DefaultCodecs.AVC);
    }

    const mime = `${MimeTypes.VIDEO_MP4}; codecs="${codecParts.join(',')}"`;
    this.logger.log(`Creating SourceBuffer with MIME: ${mime}`);
    this.logger.log(`isTypeSupported: ${MediaSource.isTypeSupported(mime)}`);

    try {
      // Logic for multiplexed vs separate tracks:
      // If we have both video and audio codecs, AND no alternate audio is present, 
      // we use a single combined SourceBuffer for multiplexed TS.
      const isMultiplexed = this._codecs.videoCodec && this._codecs.audioCodec && !this._hasAlternateAudio;

      if (isMultiplexed) {
        const mime = `${MimeTypes.VIDEO_MP4}; codecs="${this._codecs.videoCodec},${this._codecs.audioCodec}"`;
        this.logger.log(`Creating combined SourceBuffer: ${mime}`);
        const sb = this._mediaSource.addSourceBuffer(mime);
        sb.mode = SourceBufferModes.SEGMENTS;
        this._sourceBuffers.set(TrackTypes.VIDEO, sb);
        this._sourceBuffers.set(TrackTypes.AUDIO, sb); // Map both to the same SB
        
        sb.addEventListener(SourceBufferEvents.UPDATE_END, () => {
          this._appending.set(TrackTypes.VIDEO, false);
          this._appending.set(TrackTypes.AUDIO, false);
          this._evicting.set(TrackTypes.VIDEO, false);
          this._evicting.set(TrackTypes.AUDIO, false);
          this._processQueue(TrackTypes.VIDEO);
          this._processQueue(TrackTypes.AUDIO);
        });

        sb.addEventListener(SourceBufferEvents.ERROR, (e) => {
          this.logger.error('Combined SourceBuffer error', e);
          this.hls.trigger(Events.ERROR, {
            type: ErrorTypes.MEDIA_ERROR,
            details: ErrorDetails.BUFFER_APPEND_ERROR,
            fatal: true,
            reason: 'Combined SourceBuffer error during append',
          });
        });
      } else {
        // Create separate buffers for separate tracks (fMP4 or Alternate Audio)
        const types = [TrackTypes.VIDEO, TrackTypes.AUDIO];
        for (const type of types) {
          let mime = '';
          if (type === TrackTypes.VIDEO && this._codecs.videoCodec) {
            mime = `${MimeTypes.VIDEO_MP4}; codecs="${this._codecs.videoCodec}"`;
          } else if (type === TrackTypes.AUDIO && this._codecs.audioCodec) {
            mime = `${MimeTypes.AUDIO_MP4}; codecs="${this._codecs.audioCodec}"`;
          } else if (type === TrackTypes.VIDEO && !this._codecs.videoCodec && !this._codecs.audioCodec) {
            mime = `${MimeTypes.VIDEO_MP4}; codecs="${DefaultCodecs.AVC}"`;
          }

          if (mime && MediaSource.isTypeSupported(mime) && !this._sourceBuffers.has(type)) {
            this.logger.log(`Creating separate SourceBuffer for ${type}: ${mime}`);
            const sb = this._mediaSource.addSourceBuffer(mime);
            sb.mode = SourceBufferModes.SEGMENTS;
            this._sourceBuffers.set(type, sb);
            sb.addEventListener(SourceBufferEvents.UPDATE_END, () => {
              this._appending.set(type, false);
              this._evicting.set(type, false);
              this._processQueue(type);
            });
            sb.addEventListener(SourceBufferEvents.ERROR, (e) => {
              this.logger.error(`SourceBuffer ${type} error`, e);
              this.hls.trigger(Events.ERROR, {
                type: ErrorTypes.MEDIA_ERROR,
                details: ErrorDetails.BUFFER_APPEND_ERROR,
                fatal: true,
                reason: `SourceBuffer ${type} error during append`,
              });
            });
          }
        }
      }
      this._sourceBufferReady = true;
      for (const type of this._sourceBuffers.keys()) {
        this._processQueue(type);
      }
    } catch (err) {
      this.logger.error('Error creating SourceBuffer:', err);
    }
  }

  private _processQueue(type: TrackType): void {
    const sb = this._sourceBuffers.get(type);
    if (!sb || !this._sourceBufferReady || this._appending.get(type) || this._evicting.get(type)) return;
    if (sb.updating || (this._media && this._media.error)) return;

    const queue = this._queues.get(type) || [];
    const idx = this._queueIdx.get(type) || 0;
    const data = this._retryData.get(type) ?? (idx < queue.length ? queue[idx]! : null);
    if (!data) return;
    this._queueIdx.set(type, idx + 1);
    this._retryData.set(type, null);

    try {
      if (data.byteLength === 0) {
        this._processQueue(type);
        return;
      }
      this._appending.set(type, true);
      sb.appendBuffer(data);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('buffer') || msg.includes('Quota') || msg.includes('full')) {
        this.logger.warn(`Buffer ${type} full, evicting old data`);
        this._retryData.set(type, data);
        this._appending.set(type, false);
        this._evictRange(type);
      } else {
        this.logger.error(`appendBuffer ${type} error:`, err);
        this._appending.set(type, false);
        this._retryData.set(type, null);
      }
    }
  }

  private _evictRange(type: TrackType): void {
    const sb = this._sourceBuffers.get(type);
    if (!sb || !this._media || sb.updating) {
      this._retryData.set(type, null);
      return;
    }

    const currentTime = this._media.currentTime;
    const buffered = sb.buffered;
    if (buffered.length === 0) {
      this._retryData.set(type, null);
      return;
    }

    // Strategy 1: Evict data behind the playhead (keep only 2s behind for VOD, 5s for live)
    const evictEnd = Math.max(0, currentTime - 2);
    const evictStart = buffered.start(0);

    if (evictEnd > evictStart + 0.5) {
      this.logger.log(`Evicting ${type} behind playhead: ${evictStart.toFixed(1)}s - ${evictEnd.toFixed(1)}s`);
      this._evicting.set(type, true);
      try {
        sb.remove(evictStart, evictEnd);
        return;
      } catch {
        this._evicting.set(type, false);
      }
    }

    // Strategy 2: Evict data far ahead of the playhead (keep only 60s ahead)
    const maxKeepAhead = 60;
    const lastEnd = buffered.end(buffered.length - 1);
    if (lastEnd > currentTime + maxKeepAhead + 10) {
      const farStart = currentTime + maxKeepAhead;
      this.logger.log(`Evicting ${type} far-ahead data: ${farStart.toFixed(1)}s - ${lastEnd.toFixed(1)}s`);
      this._evicting.set(type, true);
      try {
        sb.remove(farStart, lastEnd);
        return;
      } catch {
        this._evicting.set(type, false);
      }
    }

    // Strategy 3: For non-live streams, evict all data more than 2s behind the playhead
    const behindEnd = Math.max(0, currentTime - 2);
    const behindStart = buffered.start(0);
    if (behindEnd > behindStart + 0.5) {
      this.logger.log(`Evicting ${type} old data: ${behindStart.toFixed(1)}s - ${behindEnd.toFixed(1)}s`);
      this._evicting.set(type, true);
      try {
        sb.remove(behindStart, behindEnd);
        return;
      } catch {
        this._evicting.set(type, false);
      }
    }

    this.logger.warn(`No evictable range for ${type}, dropping data`);
    this._retryData.set(type, null);
  }

  private _parseCodecs(level: { codecSet?: string }): CodecInfo {
    const codecInfo: CodecInfo = {};
    if (level.codecSet) {
      const parts = level.codecSet.split(',');
      for (const part of parts) {
        const c = part.trim();
        if (c.startsWith('avc1') || c.startsWith('hvc1') || c.startsWith('hev1')) {
          codecInfo.videoCodec = c;
        } else if (c.startsWith('mp4a') || c.startsWith('ec-3') || c.startsWith('ac-3')) {
          codecInfo.audioCodec = c;
        }
      }
    }
    // Fallback if none found
    if (!codecInfo.videoCodec && !codecInfo.audioCodec) {
      codecInfo.videoCodec = DefaultCodecs.AVC;
    }
    return codecInfo;
  }
}
