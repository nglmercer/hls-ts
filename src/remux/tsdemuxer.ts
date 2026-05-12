export interface DemuxedVideoTrack {
  type: 'video';
  id: number;
  timescale: number;
  duration: number;
  width: number;
  height: number;
  sps: Uint8Array[];
  pps: Uint8Array[];
  codec: string;
  samples: DemuxedVideoSample[];
}

export interface DemuxedAudioTrack {
  type: 'audio';
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
}

const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;
const PID_PAT = 0x0000;

export class TSDemuxer {
  private _videoTrack?: DemuxedVideoTrack;
  private _audioTrack?: DemuxedAudioTrack;
  private _aacStream: AacStream;
  private _avcStream: AvcStream;
  private _pmtPid: number = -1;
  private _pids: Map<number, 'video' | 'audio'> = new Map();
  private _pesData: Map<number, Uint8Array[]> = new Map();
  private _baseDts: number = 0;
  private _basePts: number = 0;

  constructor() {
    this._aacStream = new AacStream();
    this._avcStream = new AvcStream();
  }

  demux(data: Uint8Array, timeOffset: number): DemuxResult {
    this._videoTrack = undefined;
    this._audioTrack = undefined;

    let offset = 0;
    while (offset < data.length) {
      if (data[offset] !== TS_SYNC_BYTE) {
        offset++;
        continue;
      }
      if (offset + TS_PACKET_SIZE > data.length) break;

      const packet = data.subarray(offset, offset + TS_PACKET_SIZE);
      this._parsePacket(packet);
      offset += TS_PACKET_SIZE;
    }

    this._flush();

    return {
      videoTrack: this._videoTrack,
      audioTrack: this._audioTrack,
    };
  }

  private _parsePacket(packet: Uint8Array): void {
    const transportError = (packet[1] & 0x80) !== 0;
    if (transportError) return;

    const pid = ((packet[1] & 0x1f) << 8) | packet[2];
    const adaptationField = (packet[3] & 0x20) !== 0;
    const payloadUnitStart = (packet[3] & 0x40) !== 0;
    let payloadOffset = 4;

    if (adaptationField) {
      const adaptationLength = packet[4] + 1;
      payloadOffset += adaptationLength;
    }

    if (payloadOffset >= TS_PACKET_SIZE) return;

    const payload = packet.subarray(payloadOffset);

    if (pid === PID_PAT) {
      this._parsePAT(payload);
    } else if (pid === this._pmtPid) {
      this._parsePMT(payload);
    }

    const streamType = this._pids.get(pid);
    if (streamType) {
      this._parsePES(payload, pid, streamType, payloadUnitStart);
    }
  }

  private _parsePAT(payload: Uint8Array): void {
    if (payload.length < 8) return;
    const pointerField = payload[0];
    let offset = 1 + pointerField;
    if (offset + 5 > payload.length) return;

    const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2];
    const programInfoLength = sectionLength - 9;

    offset += 8;
    for (let i = 0; i < programInfoLength; i += 4) {
      if (offset + 4 > payload.length) break;
      const programNumber = (payload[offset] << 8) | payload[offset + 1];
      if (programNumber !== 0) {
        this._pmtPid = ((payload[offset + 2] & 0x1f) << 8) | payload[offset + 3];
      }
      offset += 4;
    }
  }

  private _parsePMT(payload: Uint8Array): void {
    if (payload.length < 7) return;
    const pointerField = payload[0];
    let offset = 1 + pointerField;
    if (offset + 5 > payload.length) return;

    const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2];
    offset += 8;

    // Skip PCR_PID (2 bytes)
    offset += 2;

    const programInfoLength = ((payload[offset] & 0x0f) << 8) | payload[offset + 1];
    offset += 2 + programInfoLength;

    const remaining = sectionLength - 9 - programInfoLength - 4;
    for (let i = 0; i < remaining; i += 5) {
      if (offset + 5 > payload.length) break;
      const streamType = payload[offset];
      const elementaryPid = ((payload[offset + 1] & 0x1f) << 8) | payload[offset + 2];

      if (streamType === 0x1b) {
        this._pids.set(elementaryPid, 'video');
      } else if (streamType === 0x0f || streamType === 0x11) {
        this._pids.set(elementaryPid, 'audio');
      }

      offset += 5;
    }
  }

  private _parsePES(payload: Uint8Array, pid: number, type: 'video' | 'audio', unitStart: boolean): void {
    if (unitStart) {
      if (payload.length < 5) return;
      if (payload[0] !== 0x00 || payload[1] !== 0x00 || payload[2] !== 0x01) return;

      if (this._pesData.has(pid)) {
        this._processPES(pid, type);
      }

      const pesLength = (payload[4] << 8) | payload[5];
      const dataLength = pesLength > 0 ? pesLength + 6 : 0;
      this._pesData.set(pid, [payload.subarray(0, dataLength > 0 ? dataLength : payload.length)]);
    } else {
      const existing = this._pesData.get(pid);
      if (existing) {
        existing.push(payload);
      }
    }
  }

  private _processPES(pid: number, type: 'video' | 'audio'): void {
    const parts = this._pesData.get(pid);
    if (!parts || parts.length === 0) return;

    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }

    if (data.length < 9) return;
    if (data[0] !== 0x00 || data[1] !== 0x00 || data[2] !== 0x01) return;

    const streamId = data[3];
    const pesHeaderLength = data[8] + 9;

    const ptsDtsFlag = (data[7] >> 6) & 0x03;
    let pts = 0;
    let dts = 0;

    if (ptsDtsFlag >= 2) {
      pts = this._parsePTS(data, 9);
      if (ptsDtsFlag === 3) {
        dts = this._parsePTS(data, 14);
      } else {
        dts = pts;
      }
    }

    if (this._baseDts === 0) {
      this._baseDts = dts;
      this._basePts = pts;
    }

    const esData = data.subarray(pesHeaderLength);

    if (type === 'video') {
      this._avcStream.parse(esData, pts, dts, this);
    } else if (type === 'audio') {
      this._aacStream.parse(esData, pts, dts, this);
    }
  }

  private _parsePTS(data: Uint8Array, offset: number): number {
    return (
      ((data[offset] & 0x0e) << 29) |
      ((data[offset + 1] & 0xff) << 22) |
      ((data[offset + 2] & 0xfe) << 14) |
      ((data[offset + 3] & 0xff) << 7) |
      ((data[offset + 4] & 0xfe) >> 1)
    );
  }

  private _flush(): void {
    for (const [pid, type] of this._pids) {
      if (this._pesData.has(pid)) {
        this._processPES(pid, type);
        this._pesData.delete(pid);
      }
    }
    this._avcStream.flush(this);
    this._aacStream.flush(this);
  }

  private _initVideoTrack(): DemuxedVideoTrack {
    if (!this._videoTrack) {
      this._videoTrack = {
        type: 'video',
        id: 1,
        timescale: 90000,
        duration: 0,
        width: 0,
        height: 0,
        sps: [],
        pps: [],
        codec: 'avc1.64001e',
        samples: [],
      };
    }
    return this._videoTrack;
  }

  private _initAudioTrack(): DemuxedAudioTrack {
    if (!this._audioTrack) {
      this._audioTrack = {
        type: 'audio',
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

  addVideoSample(sample: DemuxedVideoSample): void {
    this._initVideoTrack().samples.push(sample);
  }

  addAudioSample(sample: DemuxedAudioSample): void {
    this._initAudioTrack().samples.push(sample);
  }

  setVideoMeta(width: number, height: number, sps: Uint8Array[], pps: Uint8Array[]): void {
    const track = this._initVideoTrack();
    track.width = width;
    track.height = height;
    if (sps.length > 0) track.sps = sps;
    if (pps.length > 0) track.pps = pps;
    
    if (track.sps.length > 0) {
      const s = track.sps[0];
      const codecBytes = [0x61, 0x76, 0x63, 0x31, 0x2e];
      // Profile, constraints, level
      const profile = s[1].toString(16).padStart(2, '0');
      const constraints = s[2].toString(16).padStart(2, '0');
      const level = s[3].toString(16).padStart(2, '0');
      track.codec = `avc1.${profile}${constraints}${level}`;
    }
  }

  setVideoPPS(pps: Uint8Array): void {
    this._initVideoTrack().pps = [pps];
  }

  setAudioConfig(config: Uint8Array, sampleRate: number, channelCount: number): void {
    const track = this._initAudioTrack();
    track.config = config;
    track.sampleRate = sampleRate;
    track.channelCount = channelCount;
  }
}

class AacStream {
  parse(data: Uint8Array, pts: number, dts: number, demuxer: TSDemuxer): void {
    if (data.length < 7) return;

    let offset = 0;
    while (offset < data.length) {
      if (data[offset] !== 0xff || (data[offset + 1] & 0xf6) !== 0xf0) {
        offset++;
        continue;
      }

      if (offset + 7 > data.length) break;

      const frameLength = ((data[offset + 3] & 0x03) << 11) | (data[offset + 4] << 3) | ((data[offset + 5] >> 5) & 0x07);
      if (frameLength === 0 || offset + frameLength > data.length) {
        offset++;
        continue;
      }

      const sampleRateIndex = (data[offset + 2] >> 2) & 0x0f;
      const channelConfig = ((data[offset + 2] & 0x01) << 2) | ((data[offset + 3] >> 6) & 0x03);
      const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
      const sampleRate = sampleRates[sampleRateIndex] || 44100;

      const frame = data.subarray(offset, offset + frameLength);
      const audioObjectType = ((data[offset + 2] >> 6) & 0x03) + 1;
      const config = new Uint8Array([((audioObjectType << 3) | (sampleRateIndex >> 1)), ((sampleRateIndex << 7) | (channelConfig << 3))]);

      demuxer.setAudioConfig(config, sampleRate, channelConfig || 2);
      demuxer.addAudioSample({
        size: frameLength,
        duration: 1024 * 90000 / sampleRate,
        dts,
        pts,
        data: frame,
      });

      offset += frameLength;
    }
  }

  flush(_demuxer: TSDemuxer): void {}
}

class AvcStream {
  private _naluData: Uint8Array[] = [];
  private _lastPts: number = 0;
  private _lastDts: number = 0;

  parse(data: Uint8Array, pts: number, dts: number, demuxer: TSDemuxer): void {
    this.flush(demuxer);

    this._lastPts = pts;
    this._lastDts = dts;

    const nalus = this._findNALUs(data);

    for (const nalu of nalus) {
      const naluType = nalu[0] & 0x1f;

      if (naluType === 7) {
        const sps = nalu;
        const cropFlag = sps[1] & 0x80;
        let width = ((sps[1] & 0x3f) << 8) | sps[2];
        let height = ((sps[3] & 0x7f) << 8) | sps[4];
        if (cropFlag && sps.length > 10) {
          width = ((sps[10] & 0x0f) << 2) | ((sps[11] >> 6) & 0x03);
          height = (sps[11] & 0x3f);
          width = (width + 1) * 16;
          height = (height + 1) * 16;
        }
        demuxer.setVideoMeta(width, height, [sps], []);
        continue;
      }

      if (naluType === 8) {
        demuxer.setVideoPPS(nalu);
        continue;
      }

      if (naluType === 9 || naluType === 6) {
        continue;
      }

      this._naluData.push(nalu);
    }

    if (this._naluData.length > 0) {
      this.flush(demuxer);
    }
  }

  flush(demuxer: TSDemuxer): void {
    if (this._naluData.length === 0) return;
    const totalSize = this._naluData.reduce((s, d) => s + d.length, 0);
    const data = new Uint8Array(totalSize + this._naluData.length * 4);
    let offset = 0;
    for (const nalu of this._naluData) {
      data[offset++] = 0x00;
      data[offset++] = 0x00;
      data[offset++] = 0x00;
      data[offset++] = 0x01;
      data.set(nalu, offset);
      offset += nalu.length;
    }
    const isKeyframe = this._naluData.some((n) => (n[0] & 0x1f) === 5);
    demuxer.addVideoSample({
      size: data.length,
      duration: 0,
      dts: this._lastDts,
      pts: this._lastPts,
      keyframe: isKeyframe,
      data,
    });
    this._naluData = [];
  }

  private _findNALUs(data: Uint8Array): Uint8Array[] {
    const nalus: Uint8Array[] = [];
    let offset = 0;
    while (offset < data.length) {
      const startLen = this._findStartCode(data, offset);
      if (startLen === 0) {
        break;
      }
      const naluStart = offset + startLen;
      const nextStart = this._findNextStartCode(data, naluStart);
      const naluEnd = nextStart === -1 ? data.length : nextStart;
      nalus.push(data.subarray(naluStart, naluEnd));
      offset = naluEnd;
    }
    return nalus;
  }

  private _findStartCode(data: Uint8Array, offset: number): number {
    if (offset + 2 < data.length && data[offset] === 0x00 && data[offset + 1] === 0x00 && data[offset + 2] === 0x01) return 3;
    if (offset + 3 < data.length && data[offset] === 0x00 && data[offset + 1] === 0x00 && data[offset + 2] === 0x00 && data[offset + 3] === 0x01) return 4;
    return 0;
  }

  private _findNextStartCode(data: Uint8Array, offset: number): number {
    for (let i = offset; i < data.length - 3; i++) {
      if (data[i] === 0x00 && data[i + 1] === 0x00) {
        if (data[i + 2] === 0x01) return i;
        if (data[i + 2] === 0x00 && data[i + 3] === 0x01) return i;
      }
    }
    return -1;
  }
}
