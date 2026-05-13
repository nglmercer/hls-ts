import { describe, expect, it } from 'bun:test';
import { SCTE35Decoder, SCTE35CommandType } from '../src/utils/scte35';

describe('SCTE35Decoder', () => {
  it('should decode a valid splice_insert command', () => {
    // A sample base64 SCTE-35 payload (Splice Insert)
    // /DAhAAAAAAAAAP/wEAUAAAMif+9/PAAAAAATiEIAAAAAAAARuYA=
    // 0xFC 0x30 0x21 0x00 0x00 0x00 0x00 0x00 0x00 0x00 0xFF 0xF0 ...
    // Note: this is a dummy base64 for testing the structure parser
    const base64 = '/DAlAAAAAAAAAP/wFAUAAAMif+9/PAAAAAATiEIAAAAANb/x6w==';
    const decoded = SCTE35Decoder.decode(base64);

    expect(decoded).not.toBeNull();
    expect(decoded?.commandType).toBe(SCTE35CommandType.SPLICE_INSERT);
    expect(decoded?.commandName).toBe('SPLICE_INSERT');
    expect(decoded?.spliceInsert).toBeDefined();
    expect(decoded?.spliceInsert?.eventID).toBeGreaterThan(0);
  });

  it('should return null for invalid base64', () => {
    const decoded = SCTE35Decoder.decode('not-base64-!!!');
    expect(decoded).toBeNull();
  });

  it('should return null for non-SCTE35 data', () => {
    // 0x00 table_id instead of 0xFC
    const data = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const decoded = SCTE35Decoder.decodeUint8(data);
    expect(decoded).toBeNull();
  });
});
