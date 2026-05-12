import { TransmuxerMessages, type TransmuxerRequest, type TransmuxerResponse } from './transmuxer-types';
import { InlineTransmuxer } from './inline-transmuxer';

export class TransmuxerController {
  private _worker: Worker | null = null;
  private _inline: InlineTransmuxer | null = null;
  private _requestId = 0;
  private _callbacks: Map<number, (res: TransmuxerResponse) => void> = new Map();
  private _useWorker: boolean = false;

  constructor() {
    this._initWorker();
  }

  private _initWorker() {
    try {
      const origin = (typeof window !== 'undefined' && window.location && window.location.origin) 
        ? window.location.origin 
        : 'http://localhost';
      const workerUrl = new URL('/transmuxer-worker.js', origin);
      if (typeof Worker === 'undefined') {
        throw new Error('Worker not supported');
      }
      this._worker = new Worker(workerUrl, { type: 'module' });
      this._worker.onmessage = (e: MessageEvent<TransmuxerResponse>) => {
        const response = e.data;
        const callback = this._callbacks.get(response.id);
        if (callback) {
          callback(response);
          this._callbacks.delete(response.id);
        }
      };
      this._useWorker = true;
    } catch (err) {
      console.warn('[TransmuxerController] Worker unavailable, using inline transmuxer', err);
      this._inline = new InlineTransmuxer();
      this._useWorker = false;
    }
  }

  transmux(data: Uint8Array, timeOffset: number, baseDts: number, discontinuity: boolean = false): Promise<TransmuxerResponse> {
    return new Promise((resolve) => {
      const id = this._requestId++;

      if (this._useWorker && this._worker) {
        this._callbacks.set(id, resolve);
        const request: TransmuxerRequest = {
          type: TransmuxerMessages.DEMUX,
          id,
          data,
          timeOffset,
          baseDts,
          discontinuity,
        };
        this._worker.postMessage(request, [data.buffer]);
      } else if (this._inline) {
        const response = this._inline.transmux(data, timeOffset, baseDts, discontinuity, id);
        resolve(response);
      }
    });
  }

  reset() {
    if (this._useWorker && this._worker) {
      this._worker.postMessage({ type: TransmuxerMessages.RESET, id: -1 });
    } else if (this._inline) {
      this._inline.reset();
    }
  }

  destroy() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    if (this._inline) {
      this._inline.destroy();
      this._inline = null;
    }
  }
}
