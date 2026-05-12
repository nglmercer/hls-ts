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

// ─── AAC ADTS Stream Parser ────────────────────────────────────────────────

class AacStream {
  parse(data: Uint8Array, pts: number, dts: number, demuxer: TSDemuxer): void {
    if (data.length < 7) return;

    let offset = 0;
    while (offset + 7 <= data.length) {
      // Look for ADTS sync word: 0xFFF
      if (data[offset] !== 0xff || (data[offset + 1] & 0xf0) !== 0xf0) {
        offset++;
        continue;
      }

      const headerSize = (data[offset + 1] & 0x01) === 0 ? 9 : 7; // CRC present?
      const frameLength = ((data[offset + 3] & 0x03) << 11) |
                          (data[offset + 4] << 3) |
                          ((data[offset + 5] >> 5) & 0x07);

      if (frameLength < headerSize || offset + frameLength > data.length) {
        offset++;
        continue;
      }

      // Parse ADTS header fields
      const sampleRateIndex = (data[offset + 2] >> 2) & 0x0f;
      const channelConfig = ((data[offset + 2] & 0x01) << 2) | ((data[offset + 3] >> 6) & 0x03);
      const audioObjectType = ((data[offset + 2] >> 6) & 0x03) + 1;

      const sampleRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
      const sampleRate = sampleRates[sampleRateIndex] || 44100;

      // AudioSpecificConfig (2 bytes)
      const config = new Uint8Array([
        ((audioObjectType << 3) | (sampleRateIndex >> 1)),
        ((sampleRateIndex << 7) | (channelConfig << 3)),
      ]);

      demuxer.setAudioConfig(config, sampleRate, channelConfig || 2);

      // CRITICAL: Strip ADTS header — MP4 mdat expects raw AAC frames only
      const rawFrame = data.subarray(offset + headerSize, offset + frameLength);
      demuxer.addAudioSample({
        size: rawFrame.length,
        duration: Math.round(1024 * 90000 / sampleRate),
        dts,
        pts,
        data: rawFrame,
      });

      offset += frameLength;
      // Advance DTS/PTS for subsequent frames within this PES packet
      dts += Math.round(1024 * 90000 / sampleRate);
      pts += Math.round(1024 * 90000 / sampleRate);
    }
  }

  flush(_demuxer: TSDemuxer): void {}
}

// ─── H.264 AVC Stream Parser ───────────────────────────────────────────────

class AvcStream {
  private _naluData: Uint8Array[] = [];
  private _lastPts: number = 0;
  private _lastDts: number = 0;

  parse(data: Uint8Array, pts: number, dts: number, demuxer: TSDemuxer): void {
    const nalus = this._findNALUs(data);

    for (const nalu of nalus) {
      if (nalu.length === 0) continue;
      const naluType = nalu[0] & 0x1f;

      if (naluType === 7) {
        // SPS — extract width/height via Exp-Golomb
        const dims = parseSPS(nalu);
        demuxer.setVideoMeta(dims.width, dims.height, [nalu], []);
        continue;
      }

      if (naluType === 8) {
        // PPS
        demuxer.setVideoPPS(nalu);
        continue;
      }

      // Access unit delimiter — skip
      if (naluType === 9) continue;
      // SEI — skip
      if (naluType === 6) continue;

      // Slice NALUs (1=non-IDR, 5=IDR)
      if (naluType === 1 || naluType === 5) {
        // This starts a new access unit — flush previous
        if (this._naluData.length > 0) {
          this._emitSample(demuxer);
        }
        this._lastPts = pts;
        this._lastDts = dts;
      }

      this._naluData.push(nalu);
    }
  }

  flush(demuxer: TSDemuxer): void {
    if (this._naluData.length > 0) {
      this._emitSample(demuxer);
    }
  }

  private _emitSample(demuxer: TSDemuxer): void {
    if (this._naluData.length === 0) return;

    // Calculate total size: each NALU gets a 4-byte length prefix (AVCC format)
    const totalSize = this._naluData.reduce((s, n) => s + 4 + n.length, 0);
    const data = new Uint8Array(totalSize);
    let offset = 0;

    for (const nalu of this._naluData) {
      // Write 4-byte big-endian NALU length (AVCC format, not Annex-B)
      data[offset++] = (nalu.length >> 24) & 0xff;
      data[offset++] = (nalu.length >> 16) & 0xff;
      data[offset++] = (nalu.length >> 8) & 0xff;
      data[offset++] = nalu.length & 0xff;
      data.set(nalu, offset);
      offset += nalu.length;
    }

    const isKeyframe = this._naluData.some(n => (n[0] & 0x1f) === 5);

    demuxer.addVideoSample({
      size: data.length,
      duration: 3003, // Will be corrected by addVideoSample when next sample arrives
      dts: this._lastDts,
      pts: this._lastPts,
      keyframe: isKeyframe,
      data,
    });

    this._naluData = [];
  }

  private _findNALUs(data: Uint8Array): Uint8Array[] {
    const nalus: Uint8Array[] = [];
    let i = 0;
    let lastStart = -1;

    while (i < data.length - 2) {
      // Look for start codes: 00 00 01 or 00 00 00 01
      if (data[i] === 0x00 && data[i + 1] === 0x00) {
        let startCodeLen = 0;
        if (data[i + 2] === 0x01) {
          startCodeLen = 3;
        } else if (data[i + 2] === 0x00 && i + 3 < data.length && data[i + 3] === 0x01) {
          startCodeLen = 4;
        }

        if (startCodeLen > 0) {
          if (lastStart >= 0) {
            // Remove trailing zeros from previous NALU
            let end = i;
            while (end > lastStart && data[end - 1] === 0x00) end--;
            nalus.push(data.subarray(lastStart, end));
          }
          lastStart = i + startCodeLen;
          i += startCodeLen;
          continue;
        }
      }
      i++;
    }

    // Push the last NALU
    if (lastStart >= 0 && lastStart < data.length) {
      nalus.push(data.subarray(lastStart));
    }

    return nalus;
  }
}

// ─── SPS Parser (Exp-Golomb) ───────────────────────────────────────────────

function parseSPS(sps: Uint8Array): { width: number; height: number } {
  // Default fallback
  let width = 1920;
  let height = 1080;

  try {
    const reader = new ExpGolombReader(sps);
    // forbidden_zero_bit + nal_ref_idc + nal_unit_type = 1 byte
    reader.skipBits(8);

    const profileIdc = reader.readBits(8);
    reader.skipBits(8); // constraint_set flags + reserved
    reader.skipBits(8); // level_idc
    reader.readUEG(); // seq_parameter_set_id

    if (profileIdc === 100 || profileIdc === 110 || profileIdc === 122 ||
        profileIdc === 244 || profileIdc === 44 || profileIdc === 83 ||
        profileIdc === 86 || profileIdc === 118 || profileIdc === 128 ||
        profileIdc === 138 || profileIdc === 144) {
      const chromaFormatIdc = reader.readUEG();
      if (chromaFormatIdc === 3) {
        reader.skipBits(1); // separate_colour_plane_flag
      }
      reader.readUEG(); // bit_depth_luma_minus8
      reader.readUEG(); // bit_depth_chroma_minus8
      reader.skipBits(1); // qpprime_y_zero_transform_bypass_flag

      const seqScalingMatrixPresent = reader.readBits(1);
      if (seqScalingMatrixPresent) {
        const scalingListCount = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < scalingListCount; i++) {
          if (reader.readBits(1)) { // seq_scaling_list_present_flag
            const listSize = i < 6 ? 16 : 64;
            let lastScale = 8;
            let nextScale = 8;
            for (let j = 0; j < listSize; j++) {
              if (nextScale !== 0) {
                const deltaScale = reader.readSEG();
                nextScale = (lastScale + deltaScale + 256) % 256;
              }
              lastScale = nextScale === 0 ? lastScale : nextScale;
            }
          }
        }
      }
    }

    reader.readUEG(); // log2_max_frame_num_minus4
    const picOrderCntType = reader.readUEG();
    if (picOrderCntType === 0) {
      reader.readUEG(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      reader.skipBits(1); // delta_pic_order_always_zero_flag
      reader.readSEG(); // offset_for_non_ref_pic
      reader.readSEG(); // offset_for_top_to_bottom_field
      const numRefFrames = reader.readUEG();
      for (let i = 0; i < numRefFrames; i++) {
        reader.readSEG();
      }
    }

    reader.readUEG(); // max_num_ref_frames
    reader.skipBits(1); // gaps_in_frame_num_value_allowed_flag

    const picWidthInMbs = reader.readUEG() + 1;
    const picHeightInMapUnits = reader.readUEG() + 1;
    const frameMbsOnly = reader.readBits(1);

    if (!frameMbsOnly) {
      reader.skipBits(1); // mb_adaptive_frame_field_flag
    }

    reader.skipBits(1); // direct_8x8_inference_flag

    let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
    const frameCropping = reader.readBits(1);
    if (frameCropping) {
      cropLeft = reader.readUEG();
      cropRight = reader.readUEG();
      cropTop = reader.readUEG();
      cropBottom = reader.readUEG();
    }

    width = picWidthInMbs * 16 - 2 * cropLeft - 2 * cropRight;
    height = (2 - frameMbsOnly) * picHeightInMapUnits * 16 - 2 * cropTop - 2 * cropBottom;
  } catch {
    // If SPS parsing fails, return defaults
  }

  return { width: width || 1920, height: height || 1080 };
}

class ExpGolombReader {
  private data: Uint8Array;
  private bitOffset: number = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  readBits(n: number): number {
    let value = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = (this.bitOffset >> 3);
      const bitIdx = 7 - (this.bitOffset & 7);
      if (byteIdx < this.data.length) {
        value = (value << 1) | ((this.data[byteIdx] >> bitIdx) & 1);
      }
      this.bitOffset++;
    }
    return value;
  }

  skipBits(n: number): void {
    this.bitOffset += n;
  }

  readUEG(): number {
    let leadingZeros = 0;
    while (this.readBits(1) === 0 && leadingZeros < 32) {
      leadingZeros++;
    }
    if (leadingZeros === 0) return 0;
    return (1 << leadingZeros) - 1 + this.readBits(leadingZeros);
  }

  readSEG(): number {
    const value = this.readUEG();
    if (value & 1) {
      return (value + 1) >> 1;
    }
    return -(value >> 1);
  }
}
