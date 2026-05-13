import { TransmuxerMessages, type TransmuxerRequest, type TransmuxerResponse } from './transmuxer-types';
import { InlineTransmuxer } from './inline-transmuxer';
import { Logger } from '../utils/logger';

interface QueuedMessage {
  request: TransmuxerRequest;
  transferables: Transferable[];
}

export class TransmuxerController {
  private _worker: Worker | null = null;
  private _inline: InlineTransmuxer | null = null;
  private _requestId = 0;
  private _callbacks: Map<number, (res: TransmuxerResponse) => void> = new Map();
  private _useWorker: boolean = false;
  private _workerReady: boolean = false;
  private _pendingQueue: QueuedMessage[] = [];
  private logger = new Logger('TransmuxerController');

  constructor(enableWorker: boolean = true) {
    if (enableWorker) {
      this._initWorker();
    } else {
      this._inline = new InlineTransmuxer();
      this._useWorker = false;
    }
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
        // Handle READY handshake
        if ((response as any).type === TransmuxerMessages.INIT) {
          this._workerReady = true;
          this._flushPendingQueue();
          return;
        }
        const callback = this._callbacks.get(response.id);
        if (callback) {
          callback(response);
          this._callbacks.delete(response.id);
        }
      };
      this._worker.onerror = (err) => {
        this.logger.warn('Worker error, falling back to inline transmuxer', err);
        this._worker?.terminate();
        this._worker = null;
        this._useWorker = false;
        this._inline = new InlineTransmuxer();
        // Resolve any pending callbacks with inline transmuxer
        this._flushPendingAsInline();
      };
      this._useWorker = true;
      // The worker may be ready immediately (same-origin script), but we still
      // queue messages until we confirm. Send an INIT ping.
      this._workerReady = false;
      this._worker.postMessage({ type: TransmuxerMessages.INIT, id: -1 });
    } catch (err) {
      this.logger.warn('Worker unavailable, using inline transmuxer', err);
      this._inline = new InlineTransmuxer();
      this._useWorker = false;
    }
  }

  private _flushPendingQueue(): void {
    for (const { request, transferables } of this._pendingQueue) {
      this._worker?.postMessage(request, transferables);
    }
    this._pendingQueue = [];
  }

  private _flushPendingAsInline(): void {
    for (const { request } of this._pendingQueue) {
      if (request.type === TransmuxerMessages.DEMUX && request.data && this._inline) {
        const response = this._inline.transmux(
          request.data, request.timeOffset || 0, request.baseDts || 0,
          request.discontinuity || false, request.id,
        );
        const callback = this._callbacks.get(request.id);
        if (callback) {
          callback(response);
          this._callbacks.delete(request.id);
        }
      }
    }
    this._pendingQueue = [];
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
        const transferables: Transferable[] = [data.buffer as ArrayBuffer];
        if (this._workerReady) {
          this._worker.postMessage(request, transferables);
        } else {
          this._pendingQueue.push({ request, transferables });
        }
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
