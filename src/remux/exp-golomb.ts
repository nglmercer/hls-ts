export class ExpGolombReader {
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
      if (byteIdx >= this.data.length) {
        throw new Error('EOF');
      }
      value = (value << 1) | ((this.data[byteIdx] >> bitIdx) & 1);
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
    const res = value >> 1;
    return res === 0 ? 0 : -res;
  }
}

export function parseSPS(sps: Uint8Array): { width: number; height: number } {
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
    
    if (isNaN(width) || width <= 0 || isNaN(height) || height <= 0) {
      return { width: 1920, height: 1080 };
    }
  } catch {
    return { width: 1920, height: 1080 };
  }

  return { width: width || 1920, height: height || 1080 };
}
