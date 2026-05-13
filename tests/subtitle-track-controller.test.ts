import { expect, test, describe, spyOn, beforeEach } from "bun:test";
import { SubtitleTrackController } from "../src/controller/subtitle-track-controller";
import { Events } from "../src/types/events";
import { PlaylistTypes } from "../src/types/constants";

describe("SubtitleTrackController", () => {
  let hls: any;
  let controller: SubtitleTrackController;

  beforeEach(() => {
    hls = {
      trigger: (event: string, data?: any) => {},
      config: {}
    };
    spyOn(hls, "trigger");
    controller = new SubtitleTrackController(hls);
  });

  test("should populate tracks on manifest parsed", () => {
    const data = {
      subtitleTracks: [
        { name: "English", default: true, url: "eng.m3u8", type: PlaylistTypes.SUBTITLES },
        { name: "French", default: false, url: "fra.m3u8", type: PlaylistTypes.SUBTITLES }
      ]
    };
    
    controller._onManifestParsed(data as any);
    
    expect(controller.subtitleTracks).toHaveLength(2);
    expect(controller.subtitleTrack).toBe(-1); // Subtitles usually OFF by default
  });

  test("should switch subtitle tracks", () => {
    const data = {
      subtitleTracks: [
        { name: "English", default: true, url: "eng.m3u8", type: PlaylistTypes.SUBTITLES },
        { name: "French", default: false, url: "fra.m3u8", type: PlaylistTypes.SUBTITLES }
      ]
    };
    
    controller._onManifestParsed(data as any);
    controller.setSubtitleTrack(0);
    
    expect(controller.subtitleTrack).toBe(0);
    expect(hls.trigger).toHaveBeenCalledWith(Events.SUBTITLE_TRACK_SWITCH, { id: 0, track: data.subtitleTracks[0] });
  });
});
