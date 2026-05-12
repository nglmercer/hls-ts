import { AacStream } from './aac-stream';
import { type DemuxedVideoSample, type DemuxedAudioSample, type DemuxResult, type IDemuxer, type DemuxedAudioTrack } from './types';
import { TrackTypes } from '../types';

export class AACDemuxer implements IDemuxer {
  private _aacStream: AacStream;
  private _audioTrack?: DemuxedAudioTrack;

  constructor() {
    this._aacStream = new AacStream();
  }

  set discontinuity(_value: boolean) {
    this._audioTrack = undefined;
    this._aacStream.flush(this);
  }

  demux(data: Uint8Array, timeOffset: number): DemuxResult {
    this._audioTrack = undefined;
    
    // In raw AAC/ADTS, timeOffset is the start time in seconds
    const pts = Math.round(timeOffset * 90000);
    this._aacStream.parse(data, pts, pts, this);
    
    return {
      audioTrack: this._audioTrack,
    };
  }

  private _initAudioTrack(): DemuxedAudioTrack {
    if (!this._audioTrack) {
      this._audioTrack = {
        type: TrackTypes.AUDIO,
        id: 2,
        timescale: 90000,
        duration: 0,
        codec: 'mp4a.40.2',
        channelCount: 2,
        sampleRate: 44100,
        config: undefined,
        samples: [],
      };
    }
    return this._audioTrack;
  }

  addVideoSample(_sample: DemuxedVideoSample): void {}

  addAudioSample(sample: DemuxedAudioSample): void {
    const track = this._initAudioTrack();
    if (track.samples.length > 0) {
      const last = track.samples[track.samples.length - 1];
      last.duration = sample.dts - last.dts;
      if (last.duration <= 0) last.duration = Math.round(1024 * 90000 / track.sampleRate);
    }
    track.samples.push(sample);
  }

  setVideoMeta(_width: number, _height: number, _sps: Uint8Array[], _pps: Uint8Array[]): void {}
  setVideoPPS(_pps: Uint8Array): void {}
  setVideoVPS(_vps: Uint8Array): void {}

  setAudioConfig(config: Uint8Array, sampleRate: number, channelCount: number): void {
    const track = this._initAudioTrack();
    track.config = config;
    track.sampleRate = sampleRate;
    track.channelCount = channelCount;
  }
}
