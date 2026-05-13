export interface LoaderStats {
  loaded: number;
  total: number;
  trequest: number;
  tfirst: number;
  tload: number;
  aborted: boolean;
  loading?: boolean;
}

export interface LoaderResponse<T> {
  url: string;
  data: T;
  stats: LoaderStats;
}

export interface LoaderContext {
  url: string;
  headers?: Record<string, string>;
}

export type LoaderOnSuccess<T> = (response: LoaderResponse<T>, stats: LoaderStats, context: LoaderContext) => void;
export type LoaderOnError = (error: { code: number; text: string }, context: LoaderContext) => void;
export type LoaderOnTimeout = (stats: LoaderStats, context: LoaderContext) => void;
export type LoaderOnProgress = (stats: LoaderStats, context: LoaderContext, data: string | ArrayBuffer) => void;
export type LoaderCallbacks<T> = {
  onSuccess: LoaderOnSuccess<T>;
  onError: LoaderOnError;
  onTimeout: LoaderOnTimeout;
  onProgress?: LoaderOnProgress;
};

export class PlaylistLoader {
  private _stats: LoaderStats;
  private _abortController: AbortController | null = null;

  constructor() {
    this._stats = this._createStats();
  }

  get stats(): LoaderStats {
    return this._stats;
  }

  load(context: LoaderContext, callbacks: LoaderCallbacks<string>): void {
    // Abort any in-flight request before starting a new one
    if (this._abortController) {
      this._abortController.abort();
    }
    this._stats = this._createStats();
    this._stats.trequest = performance.now();

    const controller = new AbortController();
    this._abortController = controller;
    const timeout = setTimeout(() => {
      controller.abort();
      callbacks.onTimeout(this._stats, context);
    }, 10000);

    fetch(context.url, {
      headers: context.headers,
      signal: controller.signal,
    })
      .then(async (response) => {
        clearTimeout(timeout);
        if (!response.ok) {
          callbacks.onError({ code: response.status, text: response.statusText }, context);
          return;
        }
        this._stats.tfirst = performance.now();
        const text = await response.text();
        this._stats.loaded = text.length;
        this._stats.total = text.length;
        this._stats.tload = performance.now();
        callbacks.onSuccess({ url: context.url, data: text, stats: this._stats }, this._stats, context);
      })
      .catch((err) => {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
          callbacks.onTimeout(this._stats, context);
        } else {
          callbacks.onError({ code: 0, text: err.message }, context);
        }
      });
  }

  abort(): void {
    this._stats.aborted = true;
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }

  private _createStats(): LoaderStats {
    return {
      loaded: 0,
      total: 0,
      trequest: 0,
      tfirst: 0,
      tload: 0,
      aborted: false,
      loading: false,
    };
  }
}
