import { BackoffTypes, type BackoffType } from '../types';
import type { Fragment, FragmentStats } from '../types/level';

interface CacheEntry {
  data: ArrayBuffer;
  stats: FragmentStats;
  lastAccess: number;
}

interface LoaderContext {
  url: string;
  frag: Fragment;
  headers?: Record<string, string>;
}

interface LoaderResponse {
  url: string;
  data: ArrayBuffer;
  stats: FragmentStats;
}

type LoaderOnSuccess = (response: LoaderResponse, stats: FragmentStats, context: LoaderContext) => void;
type LoaderOnError = (error: { code: number; text: string }, context: LoaderContext) => void;
type LoaderOnTimeout = (stats: FragmentStats, context: LoaderContext) => void;
type LoaderOnProgress = (stats: FragmentStats, context: LoaderContext, data: ArrayBuffer) => void;

interface LoaderCallbacks {
  onSuccess: LoaderOnSuccess;
  onError: LoaderOnError;
  onTimeout: LoaderOnTimeout;
  onProgress?: LoaderOnProgress;
}

interface RetryConfig {
  maxNumRetry: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  backoff?: BackoffType;
}

export class FragmentLoader {
  private _stats: FragmentStats;
  private _retryCount: number = 0;
  private _retryConfig: RetryConfig;
  private _timeoutMs: number;
  private _abortController: AbortController | null = null;
  private _requestGen: number = 0;
  private static _cache: Map<string, CacheEntry> = new Map();
  private static _cacheMaxSize = 50;
  private _sessionRetryCount: number = 0;
  private _sessionMaxRetries: number = 5;

  constructor(retryConfig?: RetryConfig, timeoutMs: number = 30000) {
    this._retryConfig = retryConfig || {
      maxNumRetry: 2,
      retryDelayMs: 1000,
      maxRetryDelayMs: 10000,
      backoff: BackoffTypes.EXPONENTIAL,
    };
    this._timeoutMs = timeoutMs;
    this._stats = this._createStats();
  }

  get stats(): FragmentStats {
    return this._stats;
  }

  load(context: LoaderContext, callbacks: LoaderCallbacks): void {
    const cacheKey = context.url;
    const cached = FragmentLoader._cache.get(cacheKey);
    if (cached) {
      if (cached.data.byteLength === 0) {
        FragmentLoader._cache.delete(cacheKey);
      } else {
        cached.lastAccess = Date.now();
        const stats = this._createStats();
        stats.trequest = cached.stats.trequest;
        stats.tfirst = cached.stats.tfirst;
        stats.tload = performance.now();
        stats.loaded = cached.data.byteLength;
        stats.total = cached.data.byteLength;
        this._stats = stats;
        callbacks.onSuccess(
          { url: context.url, data: cached.data.slice(0), stats },
          stats,
          context,
        );
        return;
      }
    }
    this.abort();
    this._loadWithRetry(context, callbacks);
  }

  private _storeCache(url: string, data: ArrayBuffer, stats: FragmentStats): void {
    if (data.byteLength === 0) return;
    if (FragmentLoader._cache.size >= FragmentLoader._cacheMaxSize) {
      let oldestKey = '';
      let oldestTime = Infinity;
      for (const [key, entry] of FragmentLoader._cache) {
        if (entry.lastAccess < oldestTime) {
          oldestTime = entry.lastAccess;
          oldestKey = key;
        }
      }
      if (oldestKey) FragmentLoader._cache.delete(oldestKey);
    }
    FragmentLoader._cache.set(url, { data: data.slice(0), stats, lastAccess: Date.now() });
  }

  abort(): void {
    this._stats.aborted = true;
    if (this._abortController) {
      this._abortController.abort();
    }
  }

  private _loadWithRetry(context: LoaderContext, callbacks: LoaderCallbacks): void {
    if (this._sessionRetryCount >= this._sessionMaxRetries) {
      callbacks.onError({ code: 0, text: 'Max session retries exceeded' }, context);
      return;
    }
    const gen = ++this._requestGen;
    this._stats = this._createStats();
    this._stats.loading = true;
    this._stats.trequest = performance.now();
    this._retryCount = 0;
    this._abortController = new AbortController();

    const timeout = setTimeout(() => {
      this._stats.aborted = true;
      this._abortController?.abort();
      this._stats.loading = false;
      this._stats.tload = performance.now();
      callbacks.onTimeout(this._stats, context);
    }, this._timeoutMs);

    fetch(context.url, {
      headers: context.headers,
      signal: this._abortController.signal,
    })
      .then(async (response) => {
        clearTimeout(timeout);
        if (gen !== this._requestGen) return;
        if (!response.ok) {
          this._stats.loading = false;
          callbacks.onError({ code: response.status, text: response.statusText }, context);
          return;
        }
        this._stats.tfirst = performance.now();

        const reader = response.body?.getReader();
        if (!reader) {
          const data = await response.arrayBuffer();
          this._stats.loaded = data.byteLength;
          this._stats.total = data.byteLength;
          this._stats.tload = performance.now();
          this._stats.loading = false;
          this._storeCache(context.url, data, this._stats);
          this._sessionRetryCount = 0;
          callbacks.onSuccess(
            { url: context.url, data, stats: this._stats },
            this._stats,
            context,
          );
          return;
        }

        const chunks: Uint8Array[] = [];
        let totalLength = 0;

        const pump = (): Promise<void> => {
          return reader.read().then(({ done, value }) => {
            if (done) {
              const combined = new Uint8Array(totalLength);
              let offset = 0;
              for (const chunk of chunks) {
                combined.set(chunk, offset);
                offset += chunk.byteLength;
              }
              this._stats.loaded = totalLength;
              this._stats.total = totalLength;
              this._stats.tload = performance.now();
              this._stats.loading = false;
              const resultData = combined.buffer as ArrayBuffer;
              this._storeCache(context.url, resultData, this._stats);
              this._sessionRetryCount = 0;
              callbacks.onSuccess(
                { url: context.url, data: resultData, stats: this._stats },
                this._stats,
                context,
              );
              return;
            }
            chunks.push(value);
            totalLength += value.byteLength;
            this._stats.loaded = totalLength;
            if (callbacks.onProgress) {
              callbacks.onProgress(this._stats, context, value.buffer as ArrayBuffer);
            }
            return pump();
          });
        };

        await pump();
      })
      .catch((err) => {
        clearTimeout(timeout);
        this._stats.loading = false;
        if (err.name === 'AbortError') {
          if (!this._stats.aborted) {
            callbacks.onTimeout(this._stats, context);
          }
        } else if (this._retryCount < this._retryConfig.maxNumRetry) {
          this._retryCount++;
          this._sessionRetryCount++;
          const delay = this._getRetryDelay();
          const retryGen = ++this._requestGen;
          setTimeout(() => {
            if (retryGen !== this._requestGen) return;
            this._loadWithRetry(context, callbacks);
          }, delay);
        } else {
          this._sessionRetryCount++;
          callbacks.onError({ code: 0, text: err.message }, context);
        }
      });
  }

  private _getRetryDelay(): number {
    const base = this._retryConfig.retryDelayMs;
    if (this._retryConfig.backoff === BackoffTypes.EXPONENTIAL) {
      return Math.min(base * Math.pow(2, this._retryCount), this._retryConfig.maxRetryDelayMs);
    }
    return Math.min(base * this._retryCount, this._retryConfig.maxRetryDelayMs);
  }

  private _createStats(): FragmentStats {
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
