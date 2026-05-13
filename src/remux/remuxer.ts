import type { DemuxResult, DemuxedVideoTrack, DemuxedAudioTrack } from './tsdemuxer';
import { initSegment, fragmentBox, type MP4Track, type MP4Sample } from './mp4-generator';
import { TrackTypes, type TrackType } from '../types';
import { Logger } from '../utils/logger';

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
  type: TrackType;
  timescale: number;
  duration: number;
  width?: number;
  height?: number;
  codec: string;
  sps: Uint8Array[];
  pps: Uint8Array[];
  vps?: Uint8Array[];
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
  private _sequenceNumber: number = 0;
  private _nextAudioPts: number = -1;
  private _nextVideoPts: number = -1;
  private _startBaseDts: number = -1;
  private _videoTsOffset: number = -1;
  private _audioTsOffset: number = -1;

  remux(demuxResult: DemuxResult, baseDts: number): RemuxResult {
    if (this._startBaseDts === -1) {
      this._startBaseDts = baseDts;
    }

    const result: RemuxResult = {};

    if (demuxResult.videoTrack) {
      this._remuxVideo(demuxResult.videoTrack);
    }
    if (demuxResult.audioTrack) {
      this._remuxAudio(demuxResult.audioTrack);
    }

    // Build init segment with all tracks (video + audio combined)
    // Don't emit init segment until we have valid SPS/PPS for video
    if (!this._initSent) {
      const videoReady = !this._videoTrack || (this._videoTrack.sps.length > 0 && this._videoTrack.pps.length > 0);
      const audioReady = !this._audioTrack || this._audioTrack.samples.length > 0;

      if (videoReady && (this._videoTrack || this._audioTrack)) {
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
    }

    const videoSamples = this._videoTrack?.samples || [];
    const audioSamples = this._audioTrack?.samples || [];

    // Generate separate moof+mdat for video and audio tracks
    // Each track gets its own fragment since they have different timescales
    if (videoSamples.length > 0) {
      const track = this._videoTrack!;
      const mp4Track = this._toMP4Track(track);
      const mp4Samples = videoSamples.map(s => this._toMP4Sample(s));
      
      if (this._videoTsOffset === -1) {
        this._videoTsOffset = videoSamples[0].dts - this._startBaseDts;
        Logger.log(`[Remuxer] initialized _videoTsOffset to ${this._videoTsOffset} (dts=${videoSamples[0].dts}, startBaseDts=${this._startBaseDts})`);
      }
      const videoTfdt = videoSamples[0].dts - this._videoTsOffset;
      Logger.log(`[Remuxer] videoTfdt=${videoTfdt} for frag baseDts=${baseDts}`);

      const { moof, mdat } = fragmentBox(mp4Track, mp4Samples, videoTfdt, ++this._sequenceNumber);
      result.videoData = concat(moof, mdat);
      result.videoTrack = track;
      
      this._nextVideoPts = videoTfdt + mp4Samples.reduce((s, x) => s + x.duration, 0);
    }

    if (audioSamples.length > 0) {
      const track = this._audioTrack!;
      const mp4Track = this._toMP4Track(track);
      let mp4Samples = audioSamples.map(s => this._toMP4Sample(s));

      if (this._audioTsOffset === -1) {
        this._audioTsOffset = audioSamples[0].dts - this._startBaseDts;
      }
      const audioTfdt = audioSamples[0].dts - this._audioTsOffset;
      
      if (this._nextAudioPts >= 0) {
        // Insert silence for significant gaps to catch up to the expected timeline
        const gap = baseDts - this._nextAudioPts;
        if (gap > 3000 && gap < 90000) {
          const silenceFrame = generateSilentFrame(track);
          const silenceDuration = Math.round(1024 * 90000 / (track.sampleRate || 44100));
          let silencePts = this._nextAudioPts;
          const filledSamples: typeof mp4Samples = [];
          while (silencePts + silenceDuration <= baseDts) {
            filledSamples.push({
              size: silenceFrame.length,
              duration: silenceDuration,
              cts: 0,
              flags: { isLeading: 0, isDependedOn: 2, hasRedundancy: 0, degradPrio: 0, dependsOn: 2, isSync: true },
              data: silenceFrame,
            });
            silencePts += silenceDuration;
          }
          filledSamples.push(...mp4Samples);
          mp4Samples = filledSamples;
        }
      }

      const { moof, mdat } = fragmentBox(mp4Track, mp4Samples, audioTfdt, ++this._sequenceNumber);
      result.audioData = concat(moof, mdat);
      result.audioTrack = track;

      this._nextAudioPts = audioTfdt + mp4Samples.reduce((s, x) => s + x.duration, 0);
    }

    // Combine all fragment data into a single buffer for the single SourceBuffer
    const parts: Uint8Array[] = [];
    if (result.videoData) parts.push(result.videoData);
    if (result.audioData) parts.push(result.audioData);
    if (parts.length > 0) {
      result.data = concat(...parts);
    }

    return result;
  }

  reset(): void {
    Logger.log('[Remuxer] reset() called');
    this._videoTrack = undefined;
    this._audioTrack = undefined;
    this._initSent = false;
    this._baseDts = 0;
    this._sequenceNumber = 0;
    this._nextAudioPts = -1;
    this._nextVideoPts = -1;
    this._startBaseDts = -1;
    this._videoTsOffset = -1;
    this._audioTsOffset = -1;
  }

  private _remuxVideo(track: DemuxedVideoTrack): void {
    this._videoTrack = {
      id: track.id,
      type: TrackTypes.VIDEO,
      timescale: track.timescale,
      duration: track.duration,
      width: track.width,
      height: track.height,
      codec: track.codec,
      sps: track.sps,
      pps: track.pps,
      vps: track.vps,
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
      type: TrackTypes.AUDIO,
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
      vps: track.vps,
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

function generateSilentFrame(track: RemuxedTrack): Uint8Array {
  const sampleRate = track.sampleRate || 44100;
  const channels = track.channelCount || 2;
  // AAC silent frame: raw AAC block with fill_element (FIL)
  // For standard AAC, a silent frame can be 0x21 0x10 0x04 0x60 0x8c 0x1c or longer
  // This is a minimal valid AAC silent frame for LC-AAC 44100Hz stereo
  if (sampleRate >= 44100) {
    return new Uint8Array([0x21, 0x10, 0x04, 0x60, 0x8c, 0x1c]);
  }
  return new Uint8Array([0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x00]);
}
