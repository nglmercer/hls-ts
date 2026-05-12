import type { IDemuxer } from './types';

export class AacStream {
  parse(data: Uint8Array, pts: number, dts: number, demuxer: IDemuxer): void {
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

  flush(_demuxer: IDemuxer): void {}
}
