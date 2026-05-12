import { type DemuxedVideoSample, type DemuxedAudioSample, type DemuxResult, type IDemuxer, type DemuxedAudioTrack } from './types';

const BITRATES: Record<number, Record<number, Record<number, number>>> = {
  // MPEG 1
  1: {
    1: { 0: 0, 1: 32, 2: 64, 3: 96, 4: 128, 5: 160, 6: 192, 7: 224, 8: 256, 9: 288, 10: 320, 11: 352, 12: 384, 13: 416, 14: 448, 15: 0 },
    2: { 0: 0, 1: 32, 2: 48, 3: 56, 4: 64, 5: 80, 6: 96, 7: 112, 8: 128, 9: 160, 10: 192, 11: 224, 12: 256, 13: 320, 14: 384, 15: 0 },
    3: { 0: 0, 1: 32, 2: 40, 3: 48, 4: 56, 5: 64, 6: 80, 7: 96, 8: 112, 9: 128, 10: 160, 11: 192, 12: 224, 13: 256, 14: 320, 15: 0 },
  },
  // MPEG 2 / 2.5
  2: {
    1: { 0: 0, 1: 32, 2: 48, 3: 56, 4: 64, 5: 80, 6: 96, 7: 112, 8: 128, 9: 144, 10: 160, 11: 176, 12: 192, 13: 224, 14: 256, 15: 0 },
    2: { 0: 0, 1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 7: 56, 8: 64, 9: 80, 10: 96, 11: 112, 12: 128, 13: 144, 14: 160, 15: 0 },
    3: { 0: 0, 1: 8, 2: 16, 3: 24, 4: 32, 5: 40, 6: 48, 7: 56, 8: 64, 9: 80, 10: 96, 11: 112, 12: 128, 13: 144, 14: 160, 15: 0 },
  },
};

const SAMPLERATES: Record<number, Record<number, number>> = {
  1: { 0: 44100, 1: 48000, 2: 32000 },
  2: { 0: 22050, 1: 24000, 2: 16000 },
  25: { 0: 11025, 1: 12000, 2: 8000 },
};

interface MPEGFrame {
  version: 1 | 2 | 25;
  layer: 1 | 2 | 3;
  bitrate: number;
  sampleRate: number;
  channelMode: number;
  sampleCount: number;
  frameSize: number;
  padding: boolean;
}

function parseMPEGHeader(byte0: number, byte1: number, byte2: number, byte3: number): MPEGFrame | null {
  const sync = ((byte0 << 3) | (byte1 >> 5)) & 0x7FF;
  if (sync !== 0x7FF) return null;

  const versionBits = (byte1 >> 3) & 0x03;
  let version: 1 | 2 | 25;
  let sampleRateKey: 1 | 2 | 25;
  if (versionBits === 3) {
    version = 1;
    sampleRateKey = 1;
  } else if (versionBits === 2) {
    version = 2;
    sampleRateKey = 2;
  } else {
    version = 25;
    sampleRateKey = 25;
  }

  const layerBits = (byte1 >> 1) & 0x03;
  if (layerBits === 0) return null;
  const layer = (4 - layerBits) as 1 | 2 | 3;

  const bitrateIndex = (byte2 >> 4) & 0x0F;
  const bitrate = BITRATES[version === 1 ? 1 : 2]?.[layer]?.[bitrateIndex] ?? 0;
  if (bitrate === 0) return null;

  const sampleRateIndex = (byte2 >> 2) & 0x03;
  const sampleRate = SAMPLERATES[sampleRateKey]?.[sampleRateIndex] ?? 44100;
  if (sampleRate === 0) return null;

  const padding = ((byte2 >> 1) & 0x01) === 1;
  const channelMode = (byte3 >> 6) & 0x03;

  let sampleCount: number;
  let frameSize: number;

  if (layer === 1) {
    sampleCount = 384;
    frameSize = Math.floor((12 * bitrate * 1000 / sampleRate) + (padding ? 1 : 0)) * 4;
  } else if (layer === 2) {
    sampleCount = 1152;
    frameSize = Math.floor(144 * bitrate * 1000 / sampleRate) + (padding ? 1 : 0);
  } else {
    sampleCount = version === 1 ? 1152 : 576;
    frameSize = Math.floor(144 * bitrate * 1000 / sampleRate) + (padding ? 1 : 0);
  }

  if (frameSize <= 0 || frameSize > 2880) return null;

  return { version, layer, bitrate, sampleRate, channelMode, sampleCount, frameSize, padding };
}

export class MP3Demuxer implements IDemuxer {
  private _audioTrack?: DemuxedAudioTrack;
  private _parsedSampleRate: number = 44100;
  private _parsedChannelCount: number = 2;

  demux(data: Uint8Array, timeOffset: number): DemuxResult {
    this._audioTrack = undefined;
    const pts = Math.round(timeOffset * 90000);
    this._parseMP3(data, pts);
    return { audioTrack: this._audioTrack };
  }

  private _parseMP3(data: Uint8Array, pts: number): void {
    let offset = 0;
    let firstFrame = true;

    while (offset < data.length - 4) {
      if (data[offset] !== 0xff || (data[offset + 1] & 0xe0) !== 0xe0) {
        offset++;
        continue;
      }

      const frame = parseMPEGHeader(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
      if (!frame) {
        offset++;
        continue;
      }

      if (offset + frame.frameSize > data.length) break;

      if (firstFrame) {
        this._parsedSampleRate = frame.sampleRate;
        this._parsedChannelCount = frame.channelMode === 3 ? 1 : 2;
        firstFrame = false;
      }

      const rawFrame = data.subarray(offset, offset + frame.frameSize);
      this.addAudioSample({
        size: rawFrame.length,
        duration: Math.round(frame.sampleCount * 90000 / frame.sampleRate),
        dts: pts,
        pts: pts,
        data: rawFrame,
      });

      pts += Math.round(frame.sampleCount * 90000 / frame.sampleRate);
      offset += frame.frameSize;
    }
  }

  private _initAudioTrack(): DemuxedAudioTrack {
    if (!this._audioTrack) {
      this._audioTrack = {
        type: 'audio',
        id: 2,
        timescale: 90000,
        duration: 0,
        codec: 'mp3',
        channelCount: this._parsedChannelCount,
        sampleRate: this._parsedSampleRate,
        config: undefined,
        samples: [],
      };
    }
    return this._audioTrack;
  }

  addVideoSample(_sample: DemuxedVideoSample): void {}
  addAudioSample(sample: DemuxedAudioSample): void {
    const track = this._initAudioTrack();
    track.samples.push(sample);
  }
  setVideoMeta(_width: number, _height: number, _sps: Uint8Array[], _pps: Uint8Array[]): void {}
  setVideoPPS(_pps: Uint8Array): void {}
  setAudioConfig(config: Uint8Array, sampleRate: number, channelCount: number): void {
    const track = this._initAudioTrack();
    track.config = config;
    track.sampleRate = sampleRate;
    track.channelCount = channelCount;
  }
}
