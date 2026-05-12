import type { IDemuxer } from './types';
import { parseSPS } from './exp-golomb';

export class AvcStream {
  private _naluData: Uint8Array[] = [];
  private _lastPts: number = 0;
  private _lastDts: number = 0;

  private _hasSlice(): boolean {
    return this._naluData.some(n => {
      const type = n[0] & 0x1f;
      return type === 1 || type === 5;
    });
  }

  parse(data: Uint8Array, pts: number, dts: number, demuxer: IDemuxer): void {
    const nalus = this._findNALUs(data);

    for (const nalu of nalus) {
      if (nalu.length === 0) continue;
      const naluType = nalu[0] & 0x1f;

      if (naluType === 7) {
        const dims = parseSPS(nalu);
        demuxer.setVideoMeta(dims.width, dims.height, [nalu], []);
      } else if (naluType === 8) {
        demuxer.setVideoPPS(nalu);
      }

      let isNewAccessUnit = false;

      // Metadata NALUs indicate a new frame IF we already have a slice from the previous frame
      if (naluType === 9 || naluType === 7 || naluType === 8 || naluType === 6) {
        if (this._hasSlice()) {
          isNewAccessUnit = true;
        }
      } else if (naluType === 1 || naluType === 5) {
        // If it's a slice, check if it's the first slice of a picture
        const isFirstSlice = (nalu[1] & 0x80) !== 0;
        if (isFirstSlice && this._hasSlice()) {
          isNewAccessUnit = true;
        }
      }

      if (isNewAccessUnit) {
        this._emitSample(demuxer);
      }

      if (this._naluData.length === 0) {
        this._lastPts = pts;
        this._lastDts = dts;
      }

      this._naluData.push(nalu);
    }
  }

  flush(demuxer: IDemuxer): void {
    if (this._naluData.length > 0) {
      this._emitSample(demuxer);
    }
  }

  private _emitSample(demuxer: IDemuxer): void {
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
