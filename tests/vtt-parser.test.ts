import { expect, test, describe } from "bun:test";
import { parseVTT } from "../src/utils/vtt-parser";

describe("VTT Parser", () => {
  test("should parse a simple VTT file", () => {
    const vtt = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello world

00:00:05.000 --> 00:00:09.000
This is a test
of multi-line cues.
`;
    const cues = parseVTT(vtt);
    expect(cues).toHaveLength(2);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBe(4);
    expect(cues[0].text).toBe("Hello world");
    
    expect(cues[1].start).toBe(5);
    expect(cues[1].end).toBe(9);
    expect(cues[1].text).toBe("This is a test\nof multi-line cues.");
  });

  test("should handle hours in timestamps", () => {
    const vtt = `WEBVTT

01:02:03.456 --> 01:02:05.000
Long time ago...
`;
    const cues = parseVTT(vtt);
    expect(cues[0].start).toBe(3600 + 120 + 3.456);
    expect(cues[0].end).toBe(3600 + 120 + 5);
  });
});
