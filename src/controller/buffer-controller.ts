import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import type { Level } from '../types/level';
import { TrackTypes, SourceBufferModes, type TrackType, ErrorDetails, ErrorTypes } from '../types';

interface CodecInfo {
  videoCodec?: string;
  audioCodec?: string;
}

export class BufferController {
  private hls: Hls;
  private _mediaSource: MediaSource | null = null;
  private _sourceBuffer: SourceBuffer | null = null;
  private _media: HTMLMediaElement | null = null;
  private _objectUrl: string = '';
  private _codecs: CodecInfo = {};
  private _queue: ArrayBuffer[] = [];
  private _appending: boolean = false;
  private _sourceBufferReady: boolean = false;
  private _pendingCodecs: CodecInfo | null = null;
  private _evicting: boolean = false;
  private _retryData: ArrayBuffer | null = null;

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

  _onManifestParsed = (data: { levels: Level[]; audioTracks: unknown[] }): void => {
    if (data.levels.length > 0) {
      const level = data.levels[0];
      const codecs = this._parseCodecs(level);
      this.hls.trigger(Events.BUFFER_CODECS, codecs);
    }
  };

  _onLevelUpdated = (data: { level: Level; details: Record<string, unknown> }): void => {
    if (this._mediaSource && this._mediaSource.readyState === 'open') {
      if (!data.details.live && data.details.totalduration) {
        // Only set duration if it's different and source buffer is not updating
        if (this._mediaSource.duration !== data.details.totalduration && (!this._sourceBuffer || !this._sourceBuffer.updating)) {
          try {
            this._mediaSource.duration = Number(data.details.totalduration);
          } catch (e) {
            console.warn('[BufferController] Failed to set duration:', e);
          }
        }
      }
    }
  };

  _onBufferCodecs = (data: CodecInfo): void => {
    this._codecs = data;
    if (this._mediaSource && this._mediaSource.readyState === 'open') {
      this._createSourceBuffer();
    } else {
      this._pendingCodecs = data;
    }
  };

  _onBufferAppending = (data: { data: ArrayBuffer; type: TrackType }): void => {
    this._queue.push(data.data);
    this._processQueue();
  };

  _onBufferFlushing = (data: { startOffset: number; endOffset: number }): void => {
    if (!this._sourceBuffer || this._sourceBuffer.updating) return;
    try {
      this._sourceBuffer.remove(data.startOffset, data.endOffset);
    } catch { /* ignore */ }
  };

  private _createMediaSource(): void {
    this._cleanMediaSource();

    if (!this._media) return;
    const ms = new MediaSource();
    this._mediaSource = ms;
    this._objectUrl = URL.createObjectURL(ms);
    this._media.src = this._objectUrl;

    const onSourceOpen = () => {
      ms.removeEventListener('sourceopen', onSourceOpen);
      if (this._pendingCodecs) {
        this._codecs = this._pendingCodecs;
        this._pendingCodecs = null;
      }
      
      // Only create if we actually have codecs, otherwise wait for _onBufferCodecs
      if (this._codecs.videoCodec || this._codecs.audioCodec) {
        this._createSourceBuffer();
      }
    };

    ms.addEventListener('sourceopen', onSourceOpen);
  }

  private _cleanMediaSource(): void {
    if (this._sourceBuffer && this._mediaSource?.readyState === 'open') {
      try { this._mediaSource.removeSourceBuffer(this._sourceBuffer); } catch { /* ignore */ }
    }

    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
    }

    this._mediaSource = null;
    this._sourceBuffer = null;
    this._objectUrl = '';
    this._queue = [];
    this._appending = false;
    this._evicting = false;
    this._retryData = null;
    this._sourceBufferReady = false;
    this._pendingCodecs = null;
  }

  private _createSourceBuffer(): void {
    if (!this._mediaSource || this._mediaSource.readyState !== 'open') return;
    if (this._sourceBuffer) return;

    // Build a combined MIME type for both video and audio
    const codecParts: string[] = [];
    if (this._codecs.videoCodec) codecParts.push(this._codecs.videoCodec);
    if (this._codecs.audioCodec) codecParts.push(this._codecs.audioCodec);

    if (codecParts.length === 0) {
      codecParts.push('avc1.42e01e');
    }

    const mime = `video/mp4; codecs="${codecParts.join(',')}"`;
    console.log(`[BufferController] Creating SourceBuffer with MIME: ${mime}`);
    console.log(`[BufferController] isTypeSupported: ${MediaSource.isTypeSupported(mime)}`);

    try {
      if (MediaSource.isTypeSupported(mime)) {
        this._sourceBuffer = this._mediaSource.addSourceBuffer(mime);
        this._sourceBuffer.mode = SourceBufferModes.SEGMENTS;
        this._sourceBufferReady = true;
        this._sourceBuffer.addEventListener('updateend', () => {
          this._appending = false;
          if (this._evicting) {
            this._evicting = false;
          }
          this._processQueue();
        });
        this._sourceBuffer.addEventListener('error', (e) => {
          console.error('[BufferController] SourceBuffer error', e);
          this._appending = false;
          this._sourceBufferReady = false;
          this._queue = [];
          this.hls.trigger(Events.ERROR, {
            type: ErrorTypes.MEDIA_ERROR,
            details: ErrorDetails.BUFFER_APPEND_ERROR,
            fatal: true,
            reason: 'SourceBuffer error during append',
          });
        });
        this._processQueue();
      } else {
        console.error(`[BufferController] MIME type not supported: ${mime}`);
      }
    } catch (err) {
      console.error('[BufferController] Error creating SourceBuffer:', err);
    }
  }

  private _processQueue(): void {
    if (!this._sourceBuffer || !this._sourceBufferReady || this._appending || this._evicting) return;
    if (this._sourceBuffer.updating || (this._media && this._media.error)) return;

    const data = this._retryData ?? (this._queue.length > 0 ? this._queue.shift()! : null);
    if (!data) return;
    this._retryData = null;

    try {
      this._appending = true;
      const u8 = new Uint8Array(data);
      console.log('[BufferController] appendBuffer', {
        byteLength: data.byteLength,
        first16: Array.from(u8.subarray(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' '),
      });
      if (data.byteLength === 0) {
        console.warn('[BufferController] Skipping zero-length appendBuffer');
        this._appending = false;
        this._retryData = null;
        this._processQueue();
        return;
      }
      this._sourceBuffer.appendBuffer(data);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (msg.includes('buffer') || msg.includes('Quota') || msg.includes('full')) {
        console.warn('[BufferController] Buffer full, evicting old data');
        this._retryData = data;
        this._appending = false;
        this._evictRange();
      } else {
        console.error('[BufferController] appendBuffer error:', err);
        this._appending = false;
        this._retryData = null;
      }
    }
  }

  private _evictRange(): void {
    if (!this._sourceBuffer || !this._media || this._sourceBuffer.updating) {
      this._retryData = null;
      return;
    }

    const currentTime = this._media.currentTime;
    const buffered = this._sourceBuffer.buffered;
    if (buffered.length === 0) {
      this._retryData = null;
      return;
    }

    // Strategy 1: Evict data behind the playhead (keep only 5s behind)
    const evictEnd = Math.max(0, currentTime - 5);
    const evictStart = buffered.start(0);

    if (evictEnd > evictStart + 0.5) {
      console.log(`[BufferController] Evicting behind playhead: ${evictStart.toFixed(1)}s - ${evictEnd.toFixed(1)}s`);
      this._evicting = true;
      try {
        this._sourceBuffer.remove(evictStart, evictEnd);
        return; // updateend will retry the append via _processQueue
      } catch {
        this._evicting = false;
      }
    }

    // Strategy 2: Evict data far ahead of the playhead (keep only 60s ahead)
    const maxKeepAhead = 60;
    const lastEnd = buffered.end(buffered.length - 1);
    if (lastEnd > currentTime + maxKeepAhead + 10) {
      const farStart = currentTime + maxKeepAhead;
      console.log(`[BufferController] Evicting far-ahead data: ${farStart.toFixed(1)}s - ${lastEnd.toFixed(1)}s`);
      this._evicting = true;
      try {
        this._sourceBuffer.remove(farStart, lastEnd);
        return;
      } catch {
        this._evicting = false;
      }
    }

    // Nothing could be evicted — drop the pending data to avoid infinite loop
    console.warn('[BufferController] No evictable range, dropping data');
    this._retryData = null;
  }

  private _parseCodecs(level: Level): CodecInfo {
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
      codecInfo.videoCodec = 'avc1.42e01e';
    }
    return codecInfo;
  }
}
