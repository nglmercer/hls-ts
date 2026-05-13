import { expect, test, describe, spyOn, beforeEach } from "bun:test";
import { AudioTrackController } from "../src/controller/audio-track-controller";
import { Events } from "../src/types/events";
import { PlaylistTypes } from "../src/types/constants";

describe("AudioTrackController", () => {
  let hls: any;
  let controller: AudioTrackController;

  beforeEach(() => {
    hls = {
      trigger: (event: string, data?: any) => {},
      config: {}
    };
    spyOn(hls, "trigger");
    controller = new AudioTrackController(hls);
  });

  test("should populate tracks on manifest parsed", () => {
    const data = {
      audioTracks: [
        { name: "English", default: true, url: "eng.m3u8", type: PlaylistTypes.AUDIO },
        { name: "Spanish", default: false, url: "esp.m3u8", type: PlaylistTypes.AUDIO }
      ]
    };
    
    controller._onManifestParsed(data as any);
    
    expect(controller.audioTracks).toHaveLength(2);
    expect(controller.audioTrack).toBe(0); // Default track
  });

  test("should switch audio tracks", () => {
    const data = {
      audioTracks: [
        { name: "English", default: true, url: "eng.m3u8", type: PlaylistTypes.AUDIO },
        { name: "Spanish", default: false, url: "esp.m3u8", type: PlaylistTypes.AUDIO }
      ]
    };
    
    controller._onManifestParsed(data as any);
    controller.setAudioTrack(1);
    
    expect(controller.audioTrack).toBe(1);
    expect(hls.trigger).toHaveBeenCalledWith(Events.AUDIO_TRACK_SWITCHING, { id: 1, track: data.audioTracks[1] });
    expect(hls.trigger).toHaveBeenCalledWith(Events.AUDIO_TRACK_SWITCHED, { id: 1, track: data.audioTracks[1] });
  });

  test("should handle no audio tracks", () => {
    controller._onManifestParsed({ audioTracks: [] } as any);
    expect(controller.audioTracks).toHaveLength(0);
    expect(controller.audioTrack).toBe(-1);
  });
});
