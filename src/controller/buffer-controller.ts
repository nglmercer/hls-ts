import { Events } from '../types/events';
import type { Hls } from '../core/Hls';

interface CodecInfo {
  videoCodec?: string;
  audioCodec?: string;
}

interface BufferQueueItem {
  data: ArrayBuffer;
  type: 'video' | 'audio';
}

export class BufferController {
  private hls: Hls;
  private _mediaSource: MediaSource | null = null;
  private _videoBuffer: SourceBuffer | null = null;
  private _audioBuffer: SourceBuffer | null = null;
  private _media: HTMLMediaElement | null = null;
  private _objectUrl: string = '';
  private _codecs: CodecInfo = {};
  private _videoQueue: ArrayBuffer[] = [];
  private _audioQueue: ArrayBuffer[] = [];
  private _videoAppending: boolean = false;
  private _audioAppending: boolean = false;
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
    if (data.type === 'video') {
      this._videoQueue.push(data.data);
      this._processVideoQueue();
    } else {
      this._audioQueue.push(data.data);
      this._processAudioQueue();
    }
  };

  private _onBufferFlushing = (data: { startOffset: number; endOffset: number }): void => {
    [this._videoBuffer, this._audioBuffer].forEach(sb => {
      if (!sb || sb.updating) return;
      try {
        sb.remove(data.startOffset, data.endOffset);
      } catch {}
    });
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
    this._videoQueue = [];
    this._audioQueue = [];
    this._videoAppending = false;
    this._audioAppending = false;
    this._onMediaSourceOpen = null;
    this._onMediaSourceEnded = null;
  }

  private _createSourceBuffers(): void {
    if (!this._mediaSource || this._mediaSource.readyState !== 'open') return;

    if (this._codecs.videoCodec && !this._videoBuffer) {
      const mime = `video/mp4; codecs="${this._codecs.videoCodec}"`;
      if (MediaSource.isTypeSupported(mime)) {
        this._videoBuffer = this._mediaSource.addSourceBuffer(mime);
        this._videoBuffer.addEventListener('updateend', () => {
          this._videoAppending = false;
          this._processVideoQueue();
        });
      }
    }

    if (this._codecs.audioCodec && !this._audioBuffer) {
      const mime = `audio/mp4; codecs="${this._codecs.audioCodec}"`;
      if (MediaSource.isTypeSupported(mime)) {
        this._audioBuffer = this._mediaSource.addSourceBuffer(mime);
        this._audioBuffer.addEventListener('updateend', () => {
          this._audioAppending = false;
          this._processAudioQueue();
        });
      }
    }

    this._processVideoQueue();
    this._processAudioQueue();
  }

  private _processVideoQueue(): void {
    if (!this._videoBuffer || this._videoAppending || this._videoQueue.length === 0) return;
    try {
      this._videoAppending = true;
      this._videoBuffer.appendBuffer(this._videoQueue.shift()!);
    } catch (err) {
      this._videoAppending = false;
    }
  }

  private _processAudioQueue(): void {
    if (!this._audioBuffer || this._audioAppending || this._audioQueue.length === 0) return;
    try {
      this._audioAppending = true;
      this._audioBuffer.appendBuffer(this._audioQueue.shift()!);
    } catch (err) {
      this._audioAppending = false;
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
