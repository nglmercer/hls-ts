import { TSDemuxer, type DemuxResult, type DemuxedVideoTrack, type DemuxedAudioTrack } from './tsdemuxer';
import { initSegment, fragmentBox, type MP4Track, type MP4Sample } from './mp4-generator';

export interface RemuxResult {
  initSegment?: Uint8Array;
  data?: Uint8Array;
  audioData?: Uint8Array;
  videoData?: Uint8Array;
  videoTrack?: RemuxedTrack;
  audioTrack?: RemuxedTrack;
}

export interface RemuxedTrack {
  id: number;
  type: 'video' | 'audio';
  timescale: number;
  duration: number;
  width?: number;
  height?: number;
  codec: string;
  sps: Uint8Array[];
  pps: Uint8Array[];
  channelCount?: number;
  sampleRate?: number;
  config?: Uint8Array;
  samples: RemuxedSample[];
}

export interface RemuxedSample {
  size: number;
  duration: number;
  dts: number;
  pts: number;
  keyframe: boolean;
  data: Uint8Array;
}

export class Remuxer {
  private _videoTrack?: RemuxedTrack;
  private _audioTrack?: RemuxedTrack;
  private _initSent: boolean = false;
  private _baseDts: number = 0;

  remux(demuxResult: DemuxResult): RemuxResult {
    const result: RemuxResult = {};

    if (demuxResult.videoTrack) {
      this._remuxVideo(demuxResult.videoTrack);
    }
    if (demuxResult.audioTrack) {
      this._remuxAudio(demuxResult.audioTrack);
    }

    if (!this._initSent) {
      const tracks: MP4Track[] = [];
      if (this._videoTrack) {
        tracks.push(this._toMP4Track(this._videoTrack));
      }
      if (this._audioTrack) {
        tracks.push(this._toMP4Track(this._audioTrack));
      }
      if (tracks.length > 0) {
        result.initSegment = initSegment(tracks);
        this._initSent = true;
      }
    }

    const videoSamples = this._videoTrack?.samples || [];
    const audioSamples = this._audioTrack?.samples || [];

    if (videoSamples.length > 0) {
      const track = this._videoTrack!;
      const mp4Track = this._toMP4Track(track);
      const mp4Samples = videoSamples.map(s => this._toMP4Sample(s));
      const { moof, mdat } = fragmentBox(mp4Track, mp4Samples, this._baseDts);
      result.videoData = concat(moof, mdat);
      result.videoTrack = track;
    }

    if (audioSamples.length > 0) {
      const track = this._audioTrack!;
      const mp4Track = this._toMP4Track(track);
      const mp4Samples = audioSamples.map(s => this._toMP4Sample(s));
      const { moof, mdat } = fragmentBox(mp4Track, mp4Samples, this._baseDts);
      result.audioData = concat(moof, mdat);
      result.audioTrack = track;
    }

    if (result.videoData || result.audioData) {
      const parts: Uint8Array[] = [];
      if (result.videoData) parts.push(result.videoData);
      if (result.audioData) parts.push(result.audioData);
      result.data = concat(...parts);
    }

    return result;
  }

  reset(): void {
    this._videoTrack = undefined;
    this._audioTrack = undefined;
    this._initSent = false;
    this._baseDts = 0;
  }

  private _remuxVideo(track: DemuxedVideoTrack): void {
    this._videoTrack = {
      id: track.id,
      type: 'video',
      timescale: track.timescale,
      duration: track.duration,
      width: track.width,
      height: track.height,
      codec: track.codec,
      sps: track.sps,
      pps: track.pps,
      samples: track.samples.map(s => ({
        size: s.size,
        duration: s.duration,
        dts: s.dts,
        pts: s.pts,
        keyframe: s.keyframe,
        data: s.data,
      })),
    };

    if (this._baseDts === 0 && track.samples.length > 0) {
      this._baseDts = track.samples[0].dts;
    }
  }

  private _remuxAudio(track: DemuxedAudioTrack): void {
    this._audioTrack = {
      id: track.id,
      type: 'audio',
      timescale: track.timescale,
      duration: track.duration,
      codec: track.codec,
      sps: [],
      pps: [],
      channelCount: track.channelCount,
      sampleRate: track.sampleRate,
      config: track.config,
      samples: track.samples.map(s => ({
        size: s.size,
        duration: s.duration,
        dts: s.dts,
        pts: s.pts,
        keyframe: true,
        data: s.data,
      })),
    };

    if (this._baseDts === 0 && track.samples.length > 0) {
      this._baseDts = Math.min(this._baseDts || track.samples[0].dts, track.samples[0].dts);
    }
  }

  private _toMP4Track(track: RemuxedTrack): MP4Track {
    return {
      id: track.id,
      type: track.type,
      timescale: track.timescale,
      duration: track.duration,
      width: track.width,
      height: track.height,
      codec: track.codec,
      sps: track.sps,
      pps: track.pps,
      channelCount: track.channelCount,
      sampleRate: track.sampleRate,
      audioConfig: track.config,
    };
  }

  private _toMP4Sample(sample: RemuxedSample): MP4Sample {
    return {
      size: sample.size,
      duration: sample.duration,
      cts: sample.pts - sample.dts,
      flags: {
        isLeading: 0,
        isDependedOn: 0,
        hasRedundancy: 0,
        degradPrio: 0,
        dependsOn: sample.keyframe ? 2 : 1,
        isSync: sample.keyframe,
      },
      data: sample.data,
    };
  }
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
