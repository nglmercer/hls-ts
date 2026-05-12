export class CodecUtils {
  static isTypeSupported(mime: string): boolean {
    return (typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(mime));
  }

  static getAudioCodec(config: Uint8Array): string {
    // Basic AAC codec detection
    // profile is 5 bits, srIndex 4 bits, channelConfig 4 bits
    const profile = (config[0] >> 3) & 0x1f;
    return `mp4a.40.${profile}`;
  }

  static getVideoCodec(sps: Uint8Array): string {
    if (sps.length < 4) return 'avc1.42e01e';
    const profile = sps[1].toString(16).padStart(2, '0');
    const constraints = sps[2].toString(16).padStart(2, '0');
    const level = sps[3].toString(16).padStart(2, '0');
    return `avc1.${profile}${constraints}${level}`;
  }

  static isMP4(data: Uint8Array): boolean {
    if (data.length < 8) return false;
    const type = String.fromCharCode(data[4], data[5], data[6], data[7]);
    return type === 'ftyp' || type === 'moof' || type === 'styp' || type === 'sidx';
  }
}
