export interface ID3Tag {
  type: string;
  data: Uint8Array;
  pts: number;
}

export function parseID3PES(data: Uint8Array, pts: number): ID3Tag[] {
  const tags: ID3Tag[] = [];
  let offset = 0;
  while (offset + 10 <= data.length) {
    if (data[offset] === 0x49 && data[offset + 1] === 0x44 && data[offset + 2] === 0x33) {
      const version = data[offset + 3];
      const flags = data[offset + 4];
      const size = ((data[offset + 6] & 0x7F) << 21) |
                   ((data[offset + 7] & 0x7F) << 14) |
                   ((data[offset + 8] & 0x7F) << 7) |
                    (data[offset + 9] & 0x7F);
      const headerSize = (flags & 0x40) ? 20 : 10;
      const frameStart = offset + headerSize;
      const frameEnd = Math.min(frameStart + size, data.length);
      tags.push({ type: 'ID3', data: data.subarray(frameStart, frameEnd), pts });
      offset = frameEnd;
    } else {
      offset++;
    }
  }
  return tags;
}
