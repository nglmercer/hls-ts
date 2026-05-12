import { Events } from '../types/events';
import type { Hls } from '../core/Hls';

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

  _onManifestParsed = (data: { levels: any[]; audioTracks: any[] }): void => {
    if (data.levels.length > 0) {
      const level = data.levels[0];
      const codecs = this._parseCodecs(level);
      this.hls.trigger(Events.BUFFER_CODECS, codecs);
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

  _onBufferAppending = (data: { data: ArrayBuffer; type: 'video' | 'audio' }): void => {
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
      this._createSourceBuffer();
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

    try {
      if (MediaSource.isTypeSupported(mime)) {
        this._sourceBuffer = this._mediaSource.addSourceBuffer(mime);
        this._sourceBufferReady = true;
        this._sourceBuffer.addEventListener('updateend', () => {
          this._appending = false;
          this._processQueue();
        });
        this._sourceBuffer.addEventListener('error', (e) => {
          console.error('[BufferController] SourceBuffer error', e);
          this._appending = false;
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
    if (!this._sourceBuffer || this._appending || this._queue.length === 0) return;
    if (this._sourceBuffer.updating) return;
    try {
      this._appending = true;
      const data = this._queue.shift()!;
      this._sourceBuffer.appendBuffer(data);
    } catch (err) {
      console.error('[BufferController] appendBuffer error:', err);
      this._appending = false;
    }
  }

  private _parseCodecs(level: any): CodecInfo {
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
