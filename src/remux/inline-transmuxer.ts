import { TSDemuxer } from './tsdemuxer';
import { AACDemuxer } from './aac-demuxer';
import { MP3Demuxer } from './mp3-demuxer';
import { Remuxer } from './remuxer';
import { PassThroughRemuxer } from './passthrough-remuxer';
import { CodecUtils } from '../utils/codecs';
import type { TransmuxerResponse } from './transmuxer-types';

export class InlineTransmuxer {
  private _tsDemuxer: TSDemuxer;
  private _aacDemuxer: AACDemuxer;
  private _mp3Demuxer: MP3Demuxer;
  private _remuxer: Remuxer;
  private _passThroughRemuxer: PassThroughRemuxer;

  constructor() {
    this._tsDemuxer = new TSDemuxer();
    this._aacDemuxer = new AACDemuxer();
    this._mp3Demuxer = new MP3Demuxer();
    this._remuxer = new Remuxer();
    this._passThroughRemuxer = new PassThroughRemuxer();
  }

  transmux(data: Uint8Array, timeOffset: number, baseDts: number, discontinuity: boolean, id: number): TransmuxerResponse {
    let remuxResult;

    if (discontinuity) {
      this._tsDemuxer.discontinuity = true;
      this._aacDemuxer.discontinuity = true;
    }

    if (CodecUtils.isMP4(data)) {
      remuxResult = this._passThroughRemuxer.remux(data);
    } else if (data[0] === 0xff && (data[1] & 0xf0) === 0xf0) {
      const demuxResult = this._aacDemuxer.demux(data, timeOffset);
      remuxResult = this._remuxer.remux(demuxResult, baseDts);
    } else if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) {
      const demuxResult = this._mp3Demuxer.demux(data, timeOffset);
      remuxResult = this._remuxer.remux(demuxResult, baseDts);
    } else {
      const demuxResult = this._tsDemuxer.demux(data, timeOffset);
      remuxResult = this._remuxer.remux(demuxResult, baseDts);
    }

    return {
      type: 'result' as any,
      id,
      remuxResult,
    };
  }

  reset(): void {
    this._remuxer.reset();
  }

  destroy(): void {
    // Nothing to clean up - just drop references
  }
}
