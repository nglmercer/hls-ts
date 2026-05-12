import { Events } from '../types/events';
import type { Hls } from '../core/Hls';

interface CodecInfo {
  videoCodec?: string;
  audioCodec?: string;
}

export class BufferController {
  private hls: Hls;
  private _mediaSource: MediaSource | null = null;
  private _videoBuffer: SourceBuffer | null = null;
  private _audioBuffer: SourceBuffer | null = null;
  private _media: HTMLMediaElement | null = null;
  private _objectUrl: string = '';
  private _codecs: CodecInfo = {};
  private _queue: ArrayBuffer[] = [];
  private _appending: boolean = false;
  private _onMediaSourceOpen: (() => void) | null = null;
  private _onMediaSourceEnded: (() => void) | null = null;

  constructor(hls: Hls) {
    this.hls = hls;
  }

  destroy(): void {
    this._cleanMediaSource();
  }

  private _onMediaAttached = ({ media }: { media: HTMLMediaElement }): void => {
    this._media = media;
    if (typeof MediaSource !== 'undefined') {
      this._createMediaSource();
    }
  };

  private _onMediaDetached = (): void => {
    this._cleanMediaSource();
  };

  private _onManifestParsed = (data: { levels: any[]; audioTracks: any[] }): void => {
    if (data.levels.length > 0) {
      const level = data.levels[0];
      const codecs = this._parseCodecs(level);
      this.hls.trigger(Events.BUFFER_CODECS, codecs);
    }
  };

  private _onBufferCodecs = (data: CodecInfo): void => {
    this._codecs = data;
    this._createSourceBuffers();
  };

  private _onBufferAppending = (data: { data: ArrayBuffer; type: 'video' | 'audio' }): void => {
    this._queue.push(data.data);
    this._processQueue();
  };

  private _onBufferFlushing = (data: { startOffset: number; endOffset: number }): void => {
    const sb = this._videoBuffer || this._audioBuffer;
    if (!sb) return;
    if (sb.updating) return;
    try {
      sb.remove(data.startOffset, data.endOffset);
    } catch {}
  };

  private _createMediaSource(): void {
    this._cleanMediaSource();

    if (!this._media) return;
    const ms = new MediaSource();
    this._mediaSource = ms;
    this._objectUrl = URL.createObjectURL(ms);
    this._media.src = this._objectUrl;

    this._onMediaSourceOpen = () => {
      this._createSourceBuffers();
    };
    this._onMediaSourceEnded = () => {};

    ms.addEventListener('sourceopen', this._onMediaSourceOpen);
    ms.addEventListener('sourceended', this._onMediaSourceEnded);
  }

  private _cleanMediaSource(): void {
    if (this._onMediaSourceOpen && this._mediaSource) {
      this._mediaSource.removeEventListener('sourceopen', this._onMediaSourceOpen);
    }
    if (this._onMediaSourceEnded && this._mediaSource) {
      this._mediaSource.removeEventListener('sourceended', this._onMediaSourceEnded);
    }

    if (this._videoBuffer && this._mediaSource?.readyState === 'open') {
      try { this._mediaSource.removeSourceBuffer(this._videoBuffer); } catch {}
    }
    if (this._audioBuffer && this._mediaSource?.readyState === 'open') {
      try { this._mediaSource.removeSourceBuffer(this._audioBuffer); } catch {}
    }

    if (this._objectUrl) {
      URL.revokeObjectURL(this._objectUrl);
    }

    this._mediaSource = null;
    this._videoBuffer = null;
    this._audioBuffer = null;
    this._objectUrl = '';
    this._queue = [];
    this._appending = false;
    this._onMediaSourceOpen = null;
    this._onMediaSourceEnded = null;
  }

  private _createSourceBuffers(): void {
    if (!this._mediaSource || this._mediaSource.readyState !== 'open') return;

    if (this._codecs.videoCodec) {
      const mime = `video/mp4; codecs="${this._codecs.videoCodec}"`;
      if (MediaSource.isTypeSupported(mime)) {
        this._videoBuffer = this._mediaSource.addSourceBuffer(mime);
        this._videoBuffer.addEventListener('updateend', () => this._onBufferUpdateEnd());
      }
    }

    if (this._codecs.audioCodec) {
      const mime = `audio/mp4; codecs="${this._codecs.audioCodec}"`;
      if (MediaSource.isTypeSupported(mime)) {
        this._audioBuffer = this._mediaSource.addSourceBuffer(mime);
        this._audioBuffer.addEventListener('updateend', () => this._onBufferUpdateEnd());
      }
    }

    this._processQueue();
  }

  private _onBufferUpdateEnd(): void {
    this._appending = false;
    this._processQueue();
  }

  private _processQueue(): void {
    if (this._appending || this._queue.length === 0) return;

    const data = this._queue.shift()!;
    const sb = this._videoBuffer || this._audioBuffer;
    if (!sb) {
      this._queue.unshift(data);
      return;
    }

    try {
      this._appending = true;
      sb.appendBuffer(data);
    } catch (err) {
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
        } else {
          if (!codecInfo.videoCodec) codecInfo.videoCodec = c;
        }
      }
    }
    return codecInfo;
  }
}
