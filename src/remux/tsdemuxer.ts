import {
  type DemuxedVideoTrack,
  type DemuxedAudioTrack,
  type DemuxedVideoSample,
  type DemuxedAudioSample,
  type DemuxResult,
  type IDemuxer,
} from './types';
import { AacStream } from './aac-stream';
import { AvcStream } from './avc-stream';

export * from './types';

const TS_PACKET_SIZE = 188;
const TS_SYNC_BYTE = 0x47;
const PID_PAT = 0x0000;

export class TSDemuxer implements IDemuxer {
  private _videoTrack?: DemuxedVideoTrack;
  private _audioTrack?: DemuxedAudioTrack;
  private _aacStream: AacStream;
  private _avcStream: AvcStream;
  private _pmtPid: number = -1;
  private _pids: Map<number, 'video' | 'audio'> = new Map();
  private _pesData: Map<number, Uint8Array[]> = new Map();

  constructor() {
    this._aacStream = new AacStream();
    this._avcStream = new AvcStream();
  }

  demux(data: Uint8Array, timeOffset: number): DemuxResult {
    this._videoTrack = undefined;
    this._audioTrack = undefined;

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
    };
  }

  private _parsePacket(packet: Uint8Array): void {
    const transportError = (packet[1] & 0x80) !== 0;
    if (transportError) return;

    const pid = ((packet[1] & 0x1f) << 8) | packet[2];
    const payloadUnitStart = (packet[1] & 0x40) !== 0;
    const hasAdaptation = (packet[3] & 0x20) !== 0;
    const hasPayload = (packet[3] & 0x10) !== 0;
    let payloadOffset = 4;

    if (hasAdaptation) {
      const adaptationLength = packet[4];
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

    const streamType = this._pids.get(pid);
    if (streamType) {
      this._collectPES(payload, pid, streamType, payloadUnitStart);
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
        // H.264 or H.265
        this._pids.set(elementaryPid, 'video');
      } else if (streamType === 0x0f || streamType === 0x11 || streamType === 0x03 || streamType === 0x04) {
        // AAC, AAC-LATM, MPEG1 Audio, MPEG2 Audio
        this._pids.set(elementaryPid, 'audio');
      }

      offset += 5 + esInfoLength; // Skip past ES_info descriptors
    }
  }

  private _collectPES(payload: Uint8Array, pid: number, type: 'video' | 'audio', unitStart: boolean): void {
    if (unitStart) {
      // Process any previously accumulated PES data for this PID
      if (this._pesData.has(pid)) {
        this._processPES(pid, type);
      }
      this._pesData.set(pid, [payload]);
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

    // Concatenate all parts
    const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
    const data = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of parts) {
      data.set(part, offset);
      offset += part.length;
    }

    // Verify PES start code
    if (data.length < 9) return;
    if (data[0] !== 0x00 || data[1] !== 0x00 || data[2] !== 0x01) return;

    // PES header
    const ptsDtsFlag = (data[7] >> 6) & 0x03;
    const pesHeaderDataLength = data[8];
    const pesHeaderLength = 9 + pesHeaderDataLength;
    let pts = 0;
    let dts = 0;

    if (ptsDtsFlag >= 2 && data.length >= 14) {
      pts = this._parsePTS(data, 9);
      if (ptsDtsFlag === 3 && data.length >= 19) {
        dts = this._parsePTS(data, 14);
      } else {
        dts = pts;
      }
    }

    if (pesHeaderLength >= data.length) return;
    const esData = data.subarray(pesHeaderLength);

    if (type === 'video') {
      this._avcStream.parse(esData, pts, dts, this);
    } else if (type === 'audio') {
      this._aacStream.parse(esData, pts, dts, this);
    }
  }

  private _parsePTS(data: Uint8Array, offset: number): number {
    // PTS is 33 bits spread across 5 bytes
    return (
      ((data[offset] & 0x0e) * 536870912) + // 2^29
      ((data[offset + 1] & 0xff) * 4194304) + // 2^22
      ((data[offset + 2] & 0xfe) * 16384) + // 2^14
      ((data[offset + 3] & 0xff) * 128) + // 2^7
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
    const track = this._initVideoTrack();
    if (track.samples.length > 0) {
      const last = track.samples[track.samples.length - 1];
      last.duration = sample.dts - last.dts;
      if (last.duration <= 0) last.duration = 3003; // Default ~29.97fps in 90kHz timescale
    }
    track.samples.push(sample);
  }

  addAudioSample(sample: DemuxedAudioSample): void {
    const track = this._initAudioTrack();
    if (track.samples.length > 0) {
      const last = track.samples[track.samples.length - 1];
      last.duration = sample.dts - last.dts;
      if (last.duration <= 0) last.duration = Math.round(1024 * 90000 / track.sampleRate);
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

  setAudioConfig(config: Uint8Array, sampleRate: number, channelCount: number): void {
    const track = this._initAudioTrack();
    track.config = config;
    track.sampleRate = sampleRate;
    track.channelCount = channelCount;
  }
}
