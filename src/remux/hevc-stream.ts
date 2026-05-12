import type { IDemuxer, DemuxedVideoSample } from './types';

const HEVC_NALU_VPS = 32;
const HEVC_NALU_SPS = 33;
const HEVC_NALU_PPS = 34;
const HEVC_NALU_IDR_W_RADL = 19;
const HEVC_NALU_IDR_N_LP = 20;
const HEVC_NALU_CRA = 21;
const HEVC_NALU_BLA_W_LP = 16;
const HEVC_NALU_BLA_W_RADL = 17;
const HEVC_NALU_BLA_N_LP = 18;

export class HevcStream {
  private _vps: Uint8Array[] = [];
  private _sps: Uint8Array[] = [];
  private _pps: Uint8Array[] = [];
  private _pendingNalus: Uint8Array[] = [];
  private _codec: string = '';
  private _demuxer: IDemuxer | null = null;

  get codec(): string {
    return this._codec || 'hev1.1.6.L93.90';
  }

  parse(data: Uint8Array, pts: number, dts: number, demuxer: IDemuxer): void {
    this._demuxer = demuxer;
    this._parseNalus(data);
    this._emitSamples(pts, dts);
  }

  flush(_demuxer: IDemuxer): void {
    this._pendingNalus = [];
  }

  private _parseNalus(data: Uint8Array): void {
    let offset = 0;
    while (offset < data.length - 4) {
      let startCodeLength = 0;
      if (data[offset] === 0x00 && data[offset + 1] === 0x00 && data[offset + 2] === 0x00 && data[offset + 3] === 0x01) {
        startCodeLength = 4;
      } else if (data[offset] === 0x00 && data[offset + 1] === 0x00 && data[offset + 2] === 0x01) {
        startCodeLength = 3;
      }

      if (startCodeLength > 0) {
        const naluStart = offset;
        offset += startCodeLength;

        while (offset < data.length - 3) {
          if (data[offset] === 0x00 && data[offset + 1] === 0x00) {
            if (data[offset + 2] === 0x01) break;
            if (data[offset + 2] === 0x00 && data[offset + 3] === 0x01) break;
          }
          offset++;
        }

        const naluData = data.subarray(naluStart + startCodeLength, offset);
        this._classifyNalu(naluData);
      } else {
        offset++;
      }
    }
  }

  private _classifyNalu(nalu: Uint8Array): void {
    if (nalu.length < 2) return;
    const naluType = (nalu[0] >> 1) & 0x3F;

    switch (naluType) {
      case HEVC_NALU_VPS:
        this._vps = [nalu];
        this._demuxer?.setVideoVPS(nalu);
        this._updateCodecString();
        break;
      case HEVC_NALU_SPS:
        this._sps.push(nalu);
        this._updateCodecString();
        break;
      case HEVC_NALU_PPS:
        this._pps.push(nalu);
        break;
      case HEVC_NALU_IDR_W_RADL:
      case HEVC_NALU_IDR_N_LP:
      case HEVC_NALU_CRA:
      case HEVC_NALU_BLA_W_LP:
      case HEVC_NALU_BLA_W_RADL:
      case HEVC_NALU_BLA_N_LP:
        this._pendingNalus.push(nalu);
        break;
      default:
        if (naluType >= 0 && naluType <= 31) {
          this._pendingNalus.push(nalu);
        }
        break;
    }
  }

  private _emitSamples(pts: number, dts: number): void {
    if (!this._demuxer) return;

    if (this._pendingNalus.length === 0) {
      if (this._vps.length > 0 || this._sps.length > 0) {
        this._demuxer.setVideoMeta(0, 0, this._sps, this._pps);
      }
      return;
    }

    const totalSize = this._pendingNalus.reduce((s, n) => s + n.length + 4, 0);
    const sample = new Uint8Array(totalSize);
    let pos = 0;
    for (const nalu of this._pendingNalus) {
      sample[pos] = (nalu.length >> 24) & 0xFF;
      sample[pos + 1] = (nalu.length >> 16) & 0xFF;
      sample[pos + 2] = (nalu.length >> 8) & 0xFF;
      sample[pos + 3] = nalu.length & 0xFF;
      sample.set(nalu, pos + 4);
      pos += 4 + nalu.length;
    }

    const isKeyframe = this._pendingNalus.some(n => {
      const type = (n[0] >> 1) & 0x3F;
      return type >= HEVC_NALU_BLA_W_LP && type <= HEVC_NALU_CRA;
    });

    const videoSample: DemuxedVideoSample = {
      size: totalSize,
      duration: 0,
      dts,
      pts,
      keyframe: isKeyframe,
      data: sample,
    };

    this._demuxer.addVideoSample(videoSample);
    this._pendingNalus = [];
  }

  private _updateCodecString(): void {
    if (this._sps.length === 0) return;
    const sps = this._sps[this._sps.length - 1];
    if (sps.length < 4) return;

    const profileSpace = (sps[1] >> 6) & 0x03;
    const tierFlag = (sps[1] >> 5) & 0x01;
    const profileIdc = sps[1] & 0x1F;
    const compatFlags = ((sps[2] << 24) | (sps[3] << 16) | (sps[4] << 8) | sps[5]);
    const levelIdc = sps[12];

    const profileStr = String.fromCharCode(65 + profileSpace) + profileIdc.toString();
    const tierStr = tierFlag ? 'H' : 'L';
    const levelStr = levelIdc.toString();

    this._codec = `hev1.${profileStr}.${tierStr}${levelStr}.${compatFlags.toString(16).toUpperCase()}`;
  }
}
