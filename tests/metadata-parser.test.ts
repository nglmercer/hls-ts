import { expect, test, describe } from "bun:test";
import { parseMediaPlaylist } from "../src/parser/m3u8-parser";

describe("M3U8 Parser - Metadata", () => {
  test("should parse EXT-X-DATERANGE tags", () => {
    const manifest = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-DATERANGE:ID="ad1",CLASS="com.apple.ad",START-DATE="2023-01-01T00:00:00Z",DURATION=30.0,SCTE35-OUT=0xFC30250000000320001000
#EXTINF:10.0,
seg1.ts
#EXT-X-ENDLIST`;

    const result = parseMediaPlaylist(manifest, "http://test.com/");
    expect(result.dateranges).toHaveLength(1);
    const dr = result.dateranges[0];
    expect(dr.id).toBe("ad1");
    expect(dr.class).toBe("com.apple.ad");
    expect(dr.startDate).toBe("2023-01-01T00:00:00Z");
    expect(dr.duration).toBe(30.0);
    expect(dr.scte35Out).toBe("0xFC30250000000320001000");
  });
});
