import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { FragmentLoader } from '../src/loader/fragment-loader';

const originalFetch = globalThis.fetch;

function mockFetch(response: Partial<Response> | Error): void {
  (globalThis as any).fetch = async () => {
    if (response instanceof Error) throw response;
    return response as Response;
  };
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

describe('FragmentLoader - fetch mocking', () => {
  beforeEach(() => {
    restoreFetch();
  });

  afterAll(() => {
    restoreFetch();
  });

  it('should trigger onError for non-ok response', async () => {
    mockFetch({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    } as Response);

    const loader = new FragmentLoader({ maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 });
    const result = await new Promise<any>((resolve) => {
      loader.load(
        { url: 'http://test.com/seg.ts', frag: {} as any },
        {
          onSuccess: () => resolve({ type: 'success' }),
          onError: (err) => resolve({ type: 'error', code: err.code, text: err.text }),
          onTimeout: () => resolve({ type: 'timeout' }),
        },
      );
    });
    expect(result.type).toBe('error');
    expect(result.code).toBe(404);
  });

  it('should trigger non-streaming onSuccess (no reader)', async () => {
    const data = new Uint8Array([0x00, 0x01, 0x02]);
    mockFetch({
      ok: true,
      status: 200,
      body: null,
      arrayBuffer: async () => data.buffer as ArrayBuffer,
    } as any);

    const loader = new FragmentLoader({ maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 });
    const result = await new Promise<any>((resolve) => {
      loader.load(
        { url: 'http://test.com/seg.ts', frag: {} as any },
        {
          onSuccess: (response) => resolve({ type: 'success', size: response.data.byteLength }),
          onError: () => resolve({ type: 'error' }),
          onTimeout: () => resolve({ type: 'timeout' }),
        },
      );
    });
    expect(result.type).toBe('success');
    expect(result.size).toBe(3);
  });

  it('should trigger streaming onSuccess with ReadableStream', async () => {
    const chunk1 = new Uint8Array([0x01, 0x02]);
    const chunk2 = new Uint8Array([0x03, 0x04]);

    let readCount = 0;
    const reader: ReadableStreamDefaultReader = {
      read: async () => {
        readCount++;
        if (readCount === 1) return { done: false, value: chunk1 };
        if (readCount === 2) return { done: false, value: chunk2 };
        return { done: true, value: undefined };
      },
      cancel: async () => {},
      releaseLock: () => {},
      closed: Promise.resolve(undefined),
    } as any;

    const body: ReadableStream = { getReader: () => reader } as any;

    mockFetch({
      ok: true,
      status: 200,
      body,
    } as any);

    const loader = new FragmentLoader({ maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 });
    const result = await new Promise<any>((resolve) => {
      loader.load(
        { url: 'http://test.com/seg.ts', frag: {} as any },
        {
          onSuccess: (response) => resolve({ type: 'success', size: response.data.byteLength }),
          onError: () => resolve({ type: 'error' }),
          onTimeout: () => resolve({ type: 'timeout' }),
        },
      );
    });
    expect(result.type).toBe('success');
    expect(result.size).toBe(4);
  });

  it('should trigger onProgress during streaming', async () => {
    const chunk = new Uint8Array([0xaa, 0xbb]);
    let readCount = 0;
    const reader: ReadableStreamDefaultReader = {
      read: async () => {
        readCount++;
        if (readCount === 1) return { done: false, value: chunk };
        return { done: true, value: undefined };
      },
      cancel: async () => {},
      releaseLock: () => {},
      closed: Promise.resolve(undefined),
    } as any;

    const body: ReadableStream = { getReader: () => reader } as any;
    mockFetch({ ok: true, status: 200, body } as any);

    const loader = new FragmentLoader({ maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 });
    let progressCalled = false;
    const result = await new Promise<any>((resolve) => {
      loader.load(
        { url: 'http://test.com/seg.ts', frag: {} as any },
        {
          onSuccess: () => resolve({ type: 'success' }),
          onError: () => resolve({ type: 'error' }),
          onTimeout: () => resolve({ type: 'timeout' }),
          onProgress: () => { progressCalled = true; },
        },
      );
    });
    expect(result.type).toBe('success');
    expect(progressCalled).toBe(true);
  });

  it('should trigger onError via catch with retry exhaustion', async () => {
    mockFetch(new Error('Network failure'));

    const loader = new FragmentLoader(
      { maxNumRetry: 0, retryDelayMs: 0, maxRetryDelayMs: 0 },
    );
    const result = await new Promise<any>((resolve) => {
      loader.load(
        { url: 'http://test.com/seg.ts', frag: {} as any },
        {
          onSuccess: () => resolve({ type: 'success' }),
          onError: (err) => resolve({ type: 'error', text: err.text }),
          onTimeout: () => resolve({ type: 'timeout' }),
        },
      );
    });
    expect(result.type).toBe('error');
  });

  it('should retry on fetch error and eventually succeed', async () => {
    let attempts = 0;
    (globalThis as any).fetch = async () => {
      attempts++;
      if (attempts === 1) throw new Error('First attempt failed');
      return { ok: true, status: 200, body: null, arrayBuffer: async () => new ArrayBuffer(1) } as any;
    };

    const loader = new FragmentLoader(
      { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0, backoff: 'linear' },
      5000,
    );
    const result = await new Promise<any>((resolve) => {
      loader.load(
        { url: 'http://test.com/seg.ts', frag: {} as any },
        {
          onSuccess: () => resolve({ type: 'success', attempts }),
          onError: () => resolve({ type: 'error' }),
          onTimeout: () => resolve({ type: 'timeout' }),
        },
      );
    });
    expect(result.type).toBe('success');
    expect(result.attempts).toBe(2);
  });

  it('should compute exponential backoff delay', () => {
    const loader = new FragmentLoader(
      { maxNumRetry: 5, retryDelayMs: 1000, maxRetryDelayMs: 10000, backoff: 'exponential' },
    );
    // Access private _getRetryDelay method
    const getDelay = (loader as any)._getRetryDelay.bind(loader);
    (loader as any)._retryCount = 0;
    expect(getDelay()).toBe(1000);
    (loader as any)._retryCount = 1;
    expect(getDelay()).toBe(2000);
    (loader as any)._retryCount = 2;
    expect(getDelay()).toBe(4000);
    (loader as any)._retryCount = 3;
    expect(getDelay()).toBe(8000);
    (loader as any)._retryCount = 4;
    expect(getDelay()).toBe(10000); // capped at maxRetryDelayMs
  });

  it('should compute linear backoff delay', () => {
    const loader = new FragmentLoader(
      { maxNumRetry: 5, retryDelayMs: 1000, maxRetryDelayMs: 5000, backoff: 'linear' },
    );
    const getDelay = (loader as any)._getRetryDelay.bind(loader);
    (loader as any)._retryCount = 1;
    expect(getDelay()).toBe(1000);
    (loader as any)._retryCount = 3;
    expect(getDelay()).toBe(3000);
    (loader as any)._retryCount = 10;
    expect(getDelay()).toBe(5000); // capped
  });
});
