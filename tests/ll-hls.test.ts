import { describe, expect, it } from 'bun:test';
import { parseMediaPlaylist } from '../src/parser/m3u8-parser';

describe('LL-HLS Parser', () => {
  it('should parse EXT-X-PART and EXT-X-SERVER-CONTROL tags', () => {
    const playlist = `
#EXTM3U
#EXT-X-TARGETDURATION:4
#EXT-X-VERSION:6
#EXT-X-SERVER-CONTROL:CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=1.0,CAN-SKIP-UNTIL=12.0
#EXT-X-PART-INF:PART-TARGET=0.2
#EXT-X-MEDIA-SEQUENCE:1
#EXT-X-PART:DURATION=0.200,URI="part0.ts"
#EXT-X-PART:DURATION=0.200,URI="part1.ts"
#EXTINF:0.400,
seg1.ts
#EXT-X-PRELOAD-HINT:TYPE=PART,URI="part2.ts"
`;

    const result = parseMediaPlaylist(playlist, 'http://test.com/');

    // Server Control
    expect(result.canBlockReload).toBe(true);
    expect(result.partHoldBack).toBe(1.0);
    expect(result.canSkipUntil).toBe(12.0);
    expect(result.partTarget).toBe(0.2);

    // Fragments and Parts
    expect(result.fragments.length).toBe(1);
    const frag = result.fragments[0];
    expect(frag.url).toBe('http://test.com/seg1.ts');
    expect(frag.parts?.length).toBe(2);
    expect(frag.parts?.[0].uri).toBe('http://test.com/part0.ts');
    expect(frag.parts?.[1].duration).toBe(0.2);

    // Preload Hint
    expect(result.preloadHint).toBeDefined();
    expect(result.preloadHint?.type).toBe('PART');
    expect(result.preloadHint?.uri).toBe('http://test.com/part2.ts');
  });
});
