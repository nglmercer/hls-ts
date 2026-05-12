import type { RemuxResult } from './remuxer';

export class PassThroughRemuxer {
  remux(data: Uint8Array): RemuxResult {
    // Check if it's actually an MP4 fragment (starts with 'ftyp' or 'moof')
    const type = this._getBoxType(data, 4);
    if (type === 'ftyp' || type === 'moof' || type === 'styp') {
      return {
        data: data,
        // For fMP4, we might not have easy access to track info without parsing
        // but MSE can handle it if we just push it.
      };
    }
    return {};
  }

  private _getBoxType(data: Uint8Array, offset: number): string {
    return String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
  }
}
