interface LoaderStats {
  loaded: number;
  total: number;
  trequest: number;
  tfirst: number;
  tload: number;
  aborted: boolean;
  loading: boolean;
}

interface LoaderResponse<T> {
  url: string;
  data: T;
  stats: LoaderStats;
}

interface LoaderContext {
  url: string;
  headers?: Record<string, string>;
}

type LoaderOnSuccess<T> = (response: LoaderResponse<T>, stats: LoaderStats, context: LoaderContext) => void;
type LoaderOnError = (error: { code: number; text: string }, context: LoaderContext) => void;
type LoaderOnTimeout = (stats: LoaderStats, context: LoaderContext) => void;
type LoaderOnProgress = (stats: LoaderStats, context: LoaderContext, data: string | ArrayBuffer) => void;
type LoaderCallbacks<T> = {
  onSuccess: LoaderOnSuccess<T>;
  onError: LoaderOnError;
  onTimeout: LoaderOnTimeout;
  onProgress?: LoaderOnProgress;
};

export class PlaylistLoader {
  private _stats: LoaderStats;

  constructor() {
    this._stats = this._createStats();
  }

  get stats(): LoaderStats {
    return this._stats;
  }

  load(context: LoaderContext, callbacks: LoaderCallbacks<string>): void {
    this._stats = this._createStats();
    this._stats.trequest = performance.now();

    const controller = new AbortController();
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
