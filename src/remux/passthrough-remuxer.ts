import type { RemuxResult } from './remuxer';

export interface EmsgData {
  schemeIdUri: string;
  value: string;
  timescale: number;
  presentationTimeDelta: number;
  eventDuration: number;
  id: number;
  messageData: Uint8Array;
}

export class PassThroughRemuxer {
  remux(data: Uint8Array, baseDts: number): RemuxResult {
    const metadata: Array<{ pts: number; data: any }> = [];
    
    // Scan for emsg boxes in the fMP4 fragment
    this._findEmsgBoxes(data, (emsg) => {
      // Calculate PTS based on baseDts + presentationTimeDelta
      // presentationTimeDelta is relative to the segment start or absolute depending on version
      const pts = baseDts + (emsg.presentationTimeDelta * 90000 / emsg.timescale);
      metadata.push({ pts, data: emsg });
    });

    const boxType = this._getBoxType(data, 4);
    if (boxType === 'ftyp' || boxType === 'moof' || boxType === 'styp') {
      return {
        data: data,
        metadata: metadata.length > 0 ? metadata : undefined,
      };
    }
    return {};
  }

  private _findEmsgBoxes(data: Uint8Array, callback: (emsg: EmsgData) => void): void {
    let offset = 0;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    while (offset < data.length - 8) {
      const size = view.getUint32(offset);
      const type = this._getBoxType(data, offset + 4);

      if (type === 'emsg') {
        const emsg = this._parseEmsg(data.subarray(offset + 8, offset + size));
        if (emsg) callback(emsg);
      } else if (type === 'moof' || type === 'traf') {
        // Recurse into containers if needed, but emsg is usually top-level or in traf
        // For simplicity, we just scan linearly since emsg is small
      }

      if (size <= 0) break;
      offset += size;
    }
  }

  private _parseEmsg(data: Uint8Array): EmsgData | null {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const version = view.getUint8(0);
    let offset = 4; // Skip flags

    let schemeIdUri = '';
    let value = '';
    let timescale = 0;
    let presentationTimeDelta = 0;
    let eventDuration = 0;
    let id = 0;

    const readString = () => {
      let str = '';
      while (offset < data.length && data[offset] !== 0) {
        str += String.fromCharCode(data[offset++]);
      }
      offset++; // skip null
      return str;
    };

    if (version === 0) {
      schemeIdUri = readString();
      value = readString();
      timescale = view.getUint32(offset);
      presentationTimeDelta = view.getUint32(offset + 4);
      eventDuration = view.getUint32(offset + 8);
      id = view.getUint32(offset + 12);
      offset += 16;
    } else if (version === 1) {
      timescale = view.getUint32(offset);
      offset += 4;
      // presentationTimeDelta is 64-bit in version 1
      const high = view.getUint32(offset);
      const low = view.getUint32(offset + 4);
      presentationTimeDelta = (high * 0x100000000) + low;
      offset += 8;
      eventDuration = view.getUint32(offset);
      id = view.getUint32(offset + 4);
      offset += 8;
      schemeIdUri = readString();
      value = readString();
    } else {
      return null;
    }

    const messageData = data.slice(offset);

    return {
      schemeIdUri,
      value,
      timescale,
      presentationTimeDelta,
      eventDuration,
      id,
      messageData,
    };
  }

  private _getBoxType(data: Uint8Array, offset: number): string {
    if (offset + 4 > data.length) return '';
    return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
  }
}
