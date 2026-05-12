import { TSDemuxer } from './tsdemuxer';
import { AACDemuxer } from './aac-demuxer';
import { MP3Demuxer } from './mp3-demuxer';
import { Remuxer } from './remuxer';
import { PassThroughRemuxer } from './passthrough-remuxer';
import { CodecUtils } from '../utils/codecs';
import { TransmuxerMessages, type TransmuxerRequest, type TransmuxerResponse } from './transmuxer-types';

const tsDemuxer = new TSDemuxer();
const aacDemuxer = new AACDemuxer();
const mp3Demuxer = new MP3Demuxer();
const remuxer = new Remuxer();
const passThroughRemuxer = new PassThroughRemuxer();

const ctx: Worker = self as any;

ctx.onmessage = (e: MessageEvent<TransmuxerRequest>) => {
  const request = e.data;
  
  switch (request.type) {
    case TransmuxerMessages.INIT:
      // Initialization if needed
      break;
      
    case TransmuxerMessages.DEMUX: {
      if (!request.data) return;
      const data = request.data;
      let remuxResult;

      if (CodecUtils.isMP4(data)) {
        remuxResult = passThroughRemuxer.remux(data);
      } else if (data[0] === 0xff && (data[1] & 0xf0) === 0xf0) {
        // Potential AAC ADTS
        const demuxResult = aacDemuxer.demux(data, request.timeOffset || 0);
        remuxResult = remuxer.remux(demuxResult, request.baseDts || 0);
      } else if (data[0] === 0xff && (data[1] & 0xe0) === 0xe0) {
        // Potential MP3
        const demuxResult = mp3Demuxer.demux(data, request.timeOffset || 0);
        remuxResult = remuxer.remux(demuxResult, request.baseDts || 0);
      } else {
        // Assume MPEG-TS
        const demuxResult = tsDemuxer.demux(data, request.timeOffset || 0);
        remuxResult = remuxer.remux(demuxResult, request.baseDts || 0);
      }
      
      const response: TransmuxerResponse = {
        type: TransmuxerMessages.RESULT,
        id: request.id,
        remuxResult,
      };
      
      // Transfer buffers for performance — deduplicate to avoid neutering shared memory
      const seen = new Set<ArrayBuffer>();
      const transferables: Transferable[] = [];
      for (const key of ['initSegment', 'data', 'audioData', 'videoData'] as const) {
        const arr = remuxResult[key];
        if (arr && arr.buffer && !seen.has(arr.buffer as ArrayBuffer)) {
          seen.add(arr.buffer as ArrayBuffer);
          transferables.push(arr.buffer as ArrayBuffer);
        }
      }
      
      ctx.postMessage(response, transferables);
      break;
    }
    
    case TransmuxerMessages.RESET:
      remuxer.reset();
      break;
  }
};
