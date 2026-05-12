export interface CaptionData {
  pts: number;
  data: Uint8Array;
}

export function parseSEICaptions(seiNalu: Uint8Array, pts: number): CaptionData | null {
  let offset = 1;
  while (offset < seiNalu.length - 1) {
    let payloadType = 0;
    while (seiNalu[offset] === 0xFF) {
      payloadType += 255;
      offset++;
    }
    payloadType += seiNalu[offset];
    offset++;

    let payloadSize = 0;
    while (offset < seiNalu.length && seiNalu[offset] === 0xFF) {
      payloadSize += 255;
      offset++;
    }
    if (offset >= seiNalu.length) break;
    payloadSize += seiNalu[offset];
    offset++;

    if (offset + payloadSize > seiNalu.length) break;

    // SEI payload type 4: user_data_registered_itu_t_t35 (contains CEA-608)
    if (payloadType === 4 && payloadSize >= 10) {
      // Check for ATSC user data identifier (GA94)
      const ituCode = (seiNalu[offset + 0] << 24) | (seiNalu[offset + 1] << 16) |
                      (seiNalu[offset + 2] << 8) | seiNalu[offset + 3];
      if (ituCode === 0x47413934) {
        const userDataType = seiNalu[offset + 4];
        if (userDataType === 0x03) {
          const ccData = seiNalu.subarray(offset + 5, offset + payloadSize);
          if (ccData.length >= 3 && ccData[0] === 0xFC && (ccData[1] & 0xFC) === 0xFC) {
            return { pts, data: ccData };
          }
        }
      }
    }
    offset += payloadSize;
  }
  return null;
}
