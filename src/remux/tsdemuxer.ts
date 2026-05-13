import {
  type DemuxedVideoTrack,
  type DemuxedAudioTrack,
  type DemuxedVideoSample,
  type DemuxedAudioSample,
  type DemuxResult,
  type IDemuxer,
} from './types';
import { TrackTypes, type TrackType } from '../types';
import { AacStream } from './aac-stream';
import { AvcStream } from './avc-stream';
import { HevcStream } from './hevc-stream';

export * from './types';

const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;
const PID_PAT = 0x0000;

export class TSDemuxer implements IDemuxer {
  private _videoTrack?: DemuxedVideoTrack;
  private _audioTrack?: DemuxedAudioTrack;
  private _metadata: Array<{ pts: number; data: Uint8Array }> = [];
  private _aacStream: AacStream;
  private _avcStream: AvcStream;
  private _hevcStream: HevcStream;
  private _pmtPid: number = -1;
  private _pids: Map<number, { type: TrackType; streamType: number }> = new Map();
  private _pesData: Map<number, Uint8Array[]> = new Map();
  private _continuityCounters: Map<number, number> = new Map();
  private _discontinuity: boolean = false;
  private _ptsRollover: number = 0;
  private _lastPts: Map<number, number> = new Map();
  private _rolloverCounts: Map<number, number> = new Map();
  private _maxRolloverCount: number = 0;

  constructor() {
    this._aacStream = new AacStream();
    this._avcStream = new AvcStream();
    this._hevcStream = new HevcStream();
  }

  set discontinuity(value: boolean) {
    this._discontinuity = value;
    if (value) {
      this._flushPES();
      this._continuityCounters.clear();
      this._ptsRollover = 0;
      this._lastPts.clear();
      this._rolloverCounts.clear();
      this._maxRolloverCount = 0;
      this._avcStream.flush(this);
      this._aacStream.flush(this);
    }
  }

  demux(data: Uint8Array, timeOffset: number): DemuxResult {
    if (this._videoTrack) {
      this._videoTrack.samples.length = 0;
    } else {
      this._videoTrack = undefined;
    }
    if (this._audioTrack) {
      this._audioTrack.samples.length = 0;
    } else {
      this._audioTrack = undefined;
    }
    this._metadata.length = 0;

    let offset = 0;
    // Find first sync byte
    while (offset < data.length && data[offset] !== TS_SYNC_BYTE) {
      offset++;
    }

    while (offset + TS_PACKET_SIZE <= data.length) {
      if (data[offset] !== TS_SYNC_BYTE) {
        offset++;
        continue;
      }

      const packet = data.subarray(offset, offset + TS_PACKET_SIZE);
      this._parsePacket(packet);
      offset += TS_PACKET_SIZE;
    }
    this._flush();

    return {
      videoTrack: this._videoTrack,
      audioTrack: this._audioTrack,
      metadata: this._metadata.length > 0 ? this._metadata : undefined,
    };
  }

  private _parsePacket(packet: Uint8Array): void {
    const transportError = (packet[1] & 0x80) !== 0;
    if (transportError) return;

    const pid = ((packet[1] & 0x1f) << 8) | packet[2];
    const payloadUnitStart = (packet[1] & 0x40) !== 0;
    const hasAdaptation = (packet[3] & 0x20) !== 0;
    const hasPayload = (packet[3] & 0x10) !== 0;
    const continuityCounter = packet[3] & 0x0f;

    // Check continuity counter for jumps (skip PAT and null packets)
    if (pid !== PID_PAT && pid !== 0x1fff) {
      const expectedCC = this._continuityCounters.get(pid);
      if (expectedCC !== undefined) {
        const expected = (expectedCC + 1) & 0x0f;
        if (continuityCounter !== expected && continuityCounter !== expectedCC) {
          this._flushPESForPid(pid);
        }
      }
      this._continuityCounters.set(pid, continuityCounter);
    }

    let payloadOffset = 4;

    if (hasAdaptation) {
      const adaptationLength = packet[4];
      if (adaptationLength > 0 && payloadOffset + 1 < TS_PACKET_SIZE) {
        const discontinuityIndicator = (packet[payloadOffset + 1] & 0x80) !== 0;
        if (discontinuityIndicator && pid !== PID_PAT) {
          this._flushPESForPid(pid);
        }
      }
      payloadOffset += 1 + adaptationLength;
    }

    if (!hasPayload || payloadOffset >= TS_PACKET_SIZE) return;

    const payload = packet.subarray(payloadOffset);

    if (pid === PID_PAT) {
      if (payloadUnitStart) {
        this._parsePAT(payload);
      }
    } else if (pid === this._pmtPid) {
      if (payloadUnitStart) {
        this._parsePMT(payload);
      }
    }

    const streamInfo = this._pids.get(pid);
    if (streamInfo) {
      this._collectPES(payload, pid, streamInfo.type, payloadUnitStart);
    }
  }

  private _parsePAT(payload: Uint8Array): void {
    if (payload.length < 2) return;
    // pointer_field
    const pointerField = payload[0];
    let offset = 1 + pointerField;
    if (offset + 8 > payload.length) return;

    // table_id (1) + section_syntax_indicator + section_length (2)
    const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2];
    // transport_stream_id (2) + version/current_next (1) + section_number (1) + last_section_number (1)
    offset += 8;

    // Each program entry is 4 bytes. The last 4 bytes of the section are CRC.
    const programEnd = 1 + pointerField + 3 + sectionLength - 4;

    while (offset + 4 <= programEnd && offset + 4 <= payload.length) {
      const programNum = (payload[offset] << 8) | payload[offset + 1];
      if (programNum !== 0) {
        this._pmtPid = ((payload[offset + 2] & 0x1f) << 8) | payload[offset + 3];
      }
      offset += 4;
    }
  }

  private _parsePMT(payload: Uint8Array): void {
    if (payload.length < 2) return;
    const pointerField = payload[0];
    let offset = 1 + pointerField;
    if (offset + 12 > payload.length) return;

    // table_id (1) + section_syntax_indicator + section_length (2)
    const sectionLength = ((payload[offset + 1] & 0x0f) << 8) | payload[offset + 2];
    const sectionEnd = offset + 3 + sectionLength - 4; // -4 for CRC

    // program_number (2) + version/current_next (1) + section_number (1) + last_section_number (1)
    offset += 8;
    // PCR_PID (2)
    offset += 2;
    // program_info_length (2)
    if (offset + 2 > payload.length) return;
    const programInfoLength = ((payload[offset] & 0x0f) << 8) | payload[offset + 1];
    offset += 2 + programInfoLength;

    // Parse stream entries
    while (offset + 5 <= sectionEnd && offset + 5 <= payload.length) {
      const streamType = payload[offset];
      const elementaryPid = ((payload[offset + 1] & 0x1f) << 8) | payload[offset + 2];
      const esInfoLength = ((payload[offset + 3] & 0x0f) << 8) | payload[offset + 4];

      if (streamType === 0x1b || streamType === 0x24) {
        this._pids.set(elementaryPid, { type: TrackTypes.VIDEO, streamType });
      } else if (streamType === 0x0f || streamType === 0x11 || streamType === 0x03 || streamType === 0x04) {
        this._pids.set(elementaryPid, { type: TrackTypes.AUDIO, streamType });
      } else if (streamType === 0x15) {
        this._pids.set(elementaryPid, { type: TrackTypes.METADATA, streamType });
      }

      offset += 5 + esInfoLength; // Skip past ES_info descriptors
    }
  }

  private _collectPES(payload: Uint8Array, pid: number, type: TrackType, unitStart: boolean): void {
    if (unitStart) {
      if (this._pesData.has(pid)) {
        this._processPES(pid);
      }
      this._pesData.set(pid, [payload]);
    } else {
      const existing = this._pesData.get(pid);
      if (existing) {
        existing.push(payload);
      }
    }
  }

  private _processPES(pid: number): void {
    const pidInfo = this._pids.get(pid);
    if (!pidInfo) return;

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

    const ptsDtsFlag = (data[7] >> 6) & 0x03;
    const pesHeaderDataLength = data[8];
    const pesHeaderLength = 9 + pesHeaderDataLength;
    let pts = 0;
    let dts = 0;

    if (ptsDtsFlag >= 2 && data.length >= 14) {
      const rawPts = this._parsePTS(data, 9);
      pts = this._normalizePTS(rawPts, pid);
      if (ptsDtsFlag === 3 && data.length >= 19) {
        const rawDts = this._parsePTS(data, 14);
        dts = this._normalizePTS(rawDts, pid);
      } else {
        dts = pts;
      }
    }

    if (pesHeaderLength >= data.length) return;
    const esData = data.subarray(pesHeaderLength);

    if (pidInfo.type === TrackTypes.VIDEO) {
      if (pidInfo.streamType === 0x24) {
        this._hevcStream.parse(esData, pts, dts, this);
      } else {
        this._avcStream.parse(esData, pts, dts, this);
      }
    } else if (pidInfo.type === TrackTypes.AUDIO) {
      this._aacStream.parse(esData, pts, dts, this);
    } else if (pidInfo.type === TrackTypes.METADATA) {
      this._processMetadata(esData, pts);
    }
  }

  private _processMetadata(data: Uint8Array, pts: number): void {
    // Basic ID3 detection
    if (data.length >= 10 && data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33) {
      this._metadata.push({ pts, data });
    }
  }

  private _parsePTS(data: Uint8Array, offset: number): number {
    return (
      ((data[offset] & 0x0e) * 536870912) +
      ((data[offset + 1] & 0xff) * 4194304) +
      ((data[offset + 2] & 0xfe) * 16384) +
      ((data[offset + 3] & 0xff) * 128) +
      ((data[offset + 4] & 0xfe) >> 1)
    );
  }

  private _normalizePTS(rawPts: number, pid: number): number {
    const PTS_CYCLE = 0x200000000;
    let lastPts = this._lastPts.get(pid);
    let count = this._rolloverCounts.get(pid) || 0;

    if (lastPts !== undefined) {
      const halfMax = 0x100000000;
      if (rawPts < lastPts - halfMax) {
        count++;
      } else if (rawPts > lastPts + halfMax) {
        count--;
      }
    } else {
      count = this._maxRolloverCount;
    }

    this._lastPts.set(pid, rawPts);
    this._rolloverCounts.set(pid, count);
    if (count > this._maxRolloverCount) this._maxRolloverCount = count;
    return rawPts + count * PTS_CYCLE;
  }

  private _flushPESForPid(pid: number): void {
    if (this._pids.has(pid) && this._pesData.has(pid)) {
      this._processPES(pid);
      this._pesData.delete(pid);
    }
  }

  private _flushPES(): void {
    for (const pid of this._pids.keys()) {
      if (this._pesData.has(pid)) {
        this._processPES(pid);
        this._pesData.delete(pid);
      }
    }
  }

  private _flush(): void {
    this._flushPES();
    this._avcStream.flush(this);
    this._hevcStream.flush(this);
    this._aacStream.flush(this);

    // Correct the last sample duration for video
    if (this._videoTrack && this._videoTrack.samples.length > 1) {
      const samples = this._videoTrack.samples;
      let totalDuration = 0;
      for (let i = 0; i < samples.length - 1; i++) {
        totalDuration += samples[i].duration;
      }
      const avgDuration = Math.round(totalDuration / (samples.length - 1));
      samples[samples.length - 1].duration = avgDuration > 0 ? avgDuration : 3003;
    }

    // Correct the last sample duration for audio
    if (this._audioTrack && this._audioTrack.samples.length > 1) {
      const samples = this._audioTrack.samples;
      let totalDuration = 0;
      for (let i = 0; i < samples.length - 1; i++) {
        totalDuration += samples[i].duration;
      }
      const defaultDuration = Math.round(1024 * 90000 / this._audioTrack.sampleRate);
      const avgDuration = Math.round(totalDuration / (samples.length - 1));
      samples[samples.length - 1].duration = avgDuration > 0 ? avgDuration : defaultDuration;
    }
  }

  private _initVideoTrack(): DemuxedVideoTrack {
    if (!this._videoTrack) {

      this._videoTrack = {
        type: TrackTypes.VIDEO,
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

  addVideoSample(sample: DemuxedVideoSample): void {
    const track = this._initVideoTrack();
    if (track.samples.length > 0) {
      const last = track.samples[track.samples.length - 1];
      last.duration = sample.dts - last.dts;
      // Safety check: cap duration at 10 seconds to prevent extreme buffer ranges
      if (last.duration <= 0 || last.duration > 900000) {
        last.duration = 3003; // Default ~29.97fps
      }
    }
    track.samples.push(sample);
  }

  addAudioSample(sample: DemuxedAudioSample): void {
    const track = this._initAudioTrack();
    if (track.samples.length > 0) {
      const last = track.samples[track.samples.length - 1];
      last.duration = sample.dts - last.dts;
      // Safety check: cap duration to prevent extreme buffer ranges
      const defaultDuration = Math.round(1024 * 90000 / track.sampleRate);
      if (last.duration <= 0 || last.duration > 900000) {
        last.duration = defaultDuration;
      }
    }
    track.samples.push(sample);
  }

  setVideoMeta(width: number, height: number, sps: Uint8Array[], pps: Uint8Array[]): void {
    const track = this._initVideoTrack();
    if (width > 0) track.width = width;
    if (height > 0) track.height = height;
    if (sps.length > 0) track.sps = sps;
    if (pps.length > 0) track.pps = pps;

    if (track.sps.length > 0) {
      const s = track.sps[0];
      if (s.length >= 4) {
        const profile = s[1].toString(16).padStart(2, '0');
        const constraints = s[2].toString(16).padStart(2, '0');
        const level = s[3].toString(16).padStart(2, '0');
        track.codec = `avc1.${profile}${constraints}${level}`;
      }
    }
  }

  setVideoPPS(pps: Uint8Array): void {
    this._initVideoTrack().pps = [pps];
  }

  setVideoVPS(vps: Uint8Array): void {
    this._initVideoTrack().vps = [vps];
  }

  setAudioConfig(config: Uint8Array, sampleRate: number, channelCount: number): void {
    const track = this._initAudioTrack();
    track.config = config;
    track.sampleRate = sampleRate;
    track.channelCount = channelCount;
  }
}
