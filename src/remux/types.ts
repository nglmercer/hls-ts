import { TrackTypes, type TrackType } from '../types';

export interface DemuxedVideoTrack {
  type: TrackType;
  id: number;
  timescale: number;
  duration: number;
  width: number;
  height: number;
  sps: Uint8Array[];
  pps: Uint8Array[];
  vps?: Uint8Array[];
  codec: string;
  samples: DemuxedVideoSample[];
}

export interface DemuxedAudioTrack {
  type: TrackType;
  id: number;
  timescale: number;
  duration: number;
  codec: string;
  channelCount: number;
  sampleRate: number;
  config: Uint8Array | undefined;
  samples: DemuxedAudioSample[];
}

export interface DemuxedVideoSample {
  size: number;
  duration: number;
  dts: number;
  pts: number;
  keyframe: boolean;
  data: Uint8Array;
}

export interface DemuxedAudioSample {
  size: number;
  duration: number;
  dts: number;
  pts: number;
  data: Uint8Array;
}

export interface DemuxResult {
  videoTrack?: DemuxedVideoTrack;
  audioTrack?: DemuxedAudioTrack;
  metadata?: Array<{ pts: number; data: Uint8Array }>;
}

export interface IDemuxer {
  addVideoSample(sample: DemuxedVideoSample): void;
  addAudioSample(sample: DemuxedAudioSample): void;
  setVideoMeta(width: number, height: number, sps: Uint8Array[], pps: Uint8Array[]): void;
  setVideoVPS(vps: Uint8Array): void;
  setVideoPPS(pps: Uint8Array): void;
  setAudioConfig(config: Uint8Array, sampleRate: number, channelCount: number): void;
}
