import { type DemuxedVideoSample, type DemuxedAudioSample, type DemuxResult, type IDemuxer, type DemuxedAudioTrack } from './types';

export class MP3Demuxer implements IDemuxer {
  private _audioTrack?: DemuxedAudioTrack;

  demux(data: Uint8Array, timeOffset: number): DemuxResult {
    this._audioTrack = undefined;
    const pts = Math.round(timeOffset * 90000);
    
    this._parseMP3(data, pts);
    
    return {
      audioTrack: this._audioTrack,
    };
  }

  private _parseMP3(data: Uint8Array, pts: number): void {
    let offset = 0;
    while (offset < data.length - 4) {
      // Look for MP3 sync word: 0xFFF
      if (data[offset] === 0xff && (data[offset + 1] & 0xe0) === 0xe0) {
        // Very basic MP3 frame parsing (fixed duration/sample rate for simplicity in this demo)
        const frameSize = 417; // Dummy size
        const rawFrame = data.subarray(offset, Math.min(offset + frameSize, data.length));
        
        this.addAudioSample({
          size: rawFrame.length,
          duration: 1152 * 90000 / 44100,
          dts: pts,
          pts: pts,
          data: rawFrame,
        });
        
        pts += 1152 * 90000 / 44100;
        offset += frameSize;
      } else {
        offset++;
      }
    }
  }

  private _initAudioTrack(): DemuxedAudioTrack {
    if (!this._audioTrack) {
      this._audioTrack = {
        type: 'audio',
        id: 2,
        timescale: 90000,
        duration: 0,
        codec: 'mp3',
        channelCount: 2,
        sampleRate: 44100,
        config: undefined,
        samples: [],
      };
    }
    return this._audioTrack;
  }

  addVideoSample(_sample: DemuxedVideoSample): void {}
  addAudioSample(sample: DemuxedAudioSample): void {
    const track = this._initAudioTrack();
    track.samples.push(sample);
  }
  setVideoMeta(_width: number, _height: number, _sps: Uint8Array[], _pps: Uint8Array[]): void {}
  setVideoPPS(_pps: Uint8Array): void {}
  setAudioConfig(config: Uint8Array, sampleRate: number, channelCount: number): void {
    const track = this._initAudioTrack();
    track.config = config;
    track.sampleRate = sampleRate;
    track.channelCount = channelCount;
  }
}
