import { TransmuxerMessages, type TransmuxerRequest, type TransmuxerResponse } from './transmuxer-types';
import type { DemuxResult } from './types';
import type { RemuxResult } from './remuxer';

export class TransmuxerController {
  private _worker: Worker | null = null;
  private _requestId = 0;
  private _callbacks: Map<number, (res: TransmuxerResponse) => void> = new Map();

  constructor() {
    this._initWorker();
  }

  private _initWorker() {
    try {
      // The worker is bundled and served at /transmuxer-worker.js by the demo server
      const workerUrl = new URL('/transmuxer-worker.js', window.location.origin);
      this._worker = new Worker(workerUrl, { type: 'module' });
      this._worker.onmessage = (e: MessageEvent<TransmuxerResponse>) => {
        const response = e.data;
        const callback = this._callbacks.get(response.id);
        if (callback) {
          callback(response);
          this._callbacks.delete(response.id);
        }
      };
    } catch (err) {
      console.warn('[TransmuxerController] Failed to create worker, falling back to main thread (not implemented yet)', err);
    }
  }

  transmux(data: Uint8Array, timeOffset: number, baseDts: number): Promise<TransmuxerResponse> {
    return new Promise((resolve) => {
      const id = this._requestId++;
      this._callbacks.set(id, resolve);

      const request: TransmuxerRequest = {
        type: TransmuxerMessages.DEMUX,
        id,
        data,
        timeOffset,
        baseDts,
      };

      if (this._worker) {
        this._worker.postMessage(request, [data.buffer]);
      }
    });
  }

  reset() {
    if (this._worker) {
      this._worker.postMessage({ type: TransmuxerMessages.RESET, id: -1 });
    }
  }

  destroy() {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }
}
