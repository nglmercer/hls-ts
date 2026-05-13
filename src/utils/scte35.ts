export enum SCTE35CommandType {
  SPLICE_NULL = 0x00,
  SPLICE_SCHEDULE = 0x04,
  SPLICE_INSERT = 0x05,
  TIME_SIGNAL = 0x06,
  BANDWIDTH_RESERVATION = 0x07,
  PRIVATE_COMMAND = 0xff,
}

export interface SCTE35Data {
  ptsAdjustment: number;
  commandType: SCTE35CommandType;
  commandName: string;
  spliceInsert?: {
    eventID: number;
    outOfNetworkIndicator: boolean;
    programSpliceFlag: boolean;
    durationFlag: boolean;
    spliceImmediateFlag: boolean;
    ptsTime?: number;
    breakDuration?: number;
    autoReturn?: boolean;
  };
  timeSignal?: {
    ptsTime: number;
  };
}

export class SCTE35Decoder {
  static decode(base64: string): SCTE35Data | null {
    try {
      const binary = atob(base64);
      const data = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        data[i] = binary.charCodeAt(i);
      }

      return this.decodeUint8(data);
    } catch (e) {
      return null;
    }
  }

  static decodeUint8(data: Uint8Array): SCTE35Data | null {
    if (data.length < 14) return null; // Min length for a header

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 0;

    // table_id (8 bits) - always 0xFC for splice_info_section
    const tableId = view.getUint8(offset++);
    if (tableId !== 0xFC) return null;

    // section_syntax_indicator (1), private_indicator (1), reserved (2), section_length (12)
    const b1 = view.getUint8(offset++);
    const b2 = view.getUint8(offset++);
    // const sectionLength = ((b1 & 0x0F) << 8) | b2;

    // protocol_version (8)
    const protocolVersion = view.getUint8(offset++);
    if (protocolVersion !== 0) return null;

    // encrypted_packet (1), encryption_algorithm (6), pts_adjustment (33)
    const b4 = view.getUint8(offset++);
    // const encrypted = (b4 & 0x80) !== 0;
    
    // Read 33-bit PTS adjustment
    const ptsAdjHigh = b4 & 0x01;
    const ptsAdjLow = view.getUint32(offset);
    offset += 4;
    const ptsAdjustment = (ptsAdjHigh * Math.pow(2, 32)) + ptsAdjLow;

    // cw_index (8), tier (12)
    offset += 1; // skip cw_index
    offset += 1; // skip tier part
    // const tier = ((view.getUint8(offset - 1) & 0x0F) << 8) | view.getUint8(offset++);

    // splice_command_length (12)
    const b12 = view.getUint8(offset++);
    const b13 = view.getUint8(offset++);
    // const commandLength = ((b12 & 0x0F) << 8) | b13;

    // splice_command_type (8)
    const commandType = view.getUint8(offset++) as SCTE35CommandType;
    
    const result: SCTE35Data = {
      ptsAdjustment,
      commandType,
      commandName: SCTE35CommandType[commandType] || 'UNKNOWN',
    };

    switch (commandType) {
      case SCTE35CommandType.SPLICE_INSERT:
        result.spliceInsert = this.parseSpliceInsert(view, offset);
        break;
      case SCTE35CommandType.TIME_SIGNAL:
        result.timeSignal = this.parseTimeSignal(view, offset);
        break;
    }

    return result;
  }

  private static parseSpliceInsert(view: DataView, offset: number): any {
    const eventID = view.getUint32(offset);
    offset += 4;

    const eventCancel = (view.getUint8(offset) & 0x80) !== 0;
    offset += 1;

    if (!eventCancel) {
      const b = view.getUint8(offset++);
      const outOfNetworkIndicator = (b & 0x80) !== 0;
      const programSpliceFlag = (b & 0x40) !== 0;
      const durationFlag = (b & 0x20) !== 0;
      const spliceImmediateFlag = (b & 0x10) !== 0;

      let ptsTime;
      if (programSpliceFlag && !spliceImmediateFlag) {
        ptsTime = this.readPTS(view, offset);
        offset += 5;
      }

      let breakDuration;
      let autoReturn;
      if (durationFlag) {
        const db = view.getUint8(offset++);
        autoReturn = (db & 0x80) !== 0;
        const durHigh = db & 0x01;
        const durLow = view.getUint32(offset);
        offset += 4;
        breakDuration = (durHigh * Math.pow(2, 32)) + durLow;
      }

      return {
        eventID,
        outOfNetworkIndicator,
        programSpliceFlag,
        durationFlag,
        spliceImmediateFlag,
        ptsTime,
        breakDuration,
        autoReturn,
      };
    }
    return { eventID, canceled: true };
  }

  private static parseTimeSignal(view: DataView, offset: number): any {
    const ptsTime = this.readPTS(view, offset);
    return { ptsTime };
  }

  private static readPTS(view: DataView, offset: number): number {
    const b = view.getUint8(offset);
    const hasPTS = (b & 0x80) !== 0;
    if (!hasPTS) return 0;

    const high = b & 0x01;
    const low = view.getUint32(offset + 1);
    return (high * Math.pow(2, 32)) + low;
  }
}
