import type { DemuxResult } from './types';
import type { RemuxResult } from './remuxer';

export enum TransmuxerMessages {
  INIT = 'init',
  DEMUX = 'demux',
  REMUX = 'remux',
  RESULT = 'result',
  RESET = 'reset',
}

export interface TransmuxerRequest {
  type: TransmuxerMessages;
  id: number;
  data?: Uint8Array;
  timeOffset?: number;
  baseDts?: number;
  discontinuity?: boolean;
}

export interface TransmuxerResponse {
  type: TransmuxerMessages.RESULT;
  id: number;
  demuxResult?: DemuxResult;
  remuxResult?: RemuxResult;
}
