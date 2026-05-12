import { describe, it, expect, beforeAll } from 'bun:test';
import { BufferController } from '../src/controller/buffer-controller';
import { Hls } from '../src/core/Hls';

class MockSourceBuffer {
  updating: boolean = false;
  appendBuffer(data: ArrayBuffer) {}
  remove(start: number, end: number) {}
  addEventListener(event: string, cb: any) {}
}

class MockMediaSource {
  readyState: string = 'open';
  sourceBuffers: MockSourceBuffer[] = [];
  addSourceBuffer(mime: string): MockSourceBuffer {
    const sb = new MockSourceBuffer();
    this.sourceBuffers.push(sb);
    return sb;
  }
  removeSourceBuffer(sb: MockSourceBuffer) {
    const idx = this.sourceBuffers.indexOf(sb);
    if (idx >= 0) this.sourceBuffers.splice(idx, 1);
  }
  endOfStream() {}
  addEventListener(event: string, cb: EventListener) {}
  removeEventListener(event: string, cb: EventListener) {}
  static isTypeSupported(mime: string): boolean {
    return true;
  }
}

describe('BufferController', () => {
  beforeAll(() => {
    (globalThis as unknown as { MediaSource: any }).MediaSource = MockMediaSource;
    (globalThis as unknown as { URL: { createObjectURL: Function; revokeObjectURL: Function } }).URL.createObjectURL = () => 'blob:test';
    (globalThis as unknown as { URL: { revokeObjectURL: Function } }).URL.revokeObjectURL = () => {};
  });

  it('should create and destroy', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    bc.destroy();
  });

  it('should handle media attach', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    const video = { src: '' } as unknown as HTMLVideoElement;
    (bc as unknown as { _onMediaAttached: (data: { media: HTMLVideoElement }) => void })._onMediaAttached({ media: video });
    bc.destroy();
  });

  it('should handle media detach', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    (bc as unknown as { _onMediaAttached: (data: { media: HTMLVideoElement }) => void })._onMediaAttached({ media: { src: '' } as unknown as HTMLVideoElement });
    (bc as unknown as { _onMediaDetached: () => void })._onMediaDetached();
    bc.destroy();
  });

  it('should handle manifest parsed for codec info', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    let codecEvent: { levels: any[] } | null = null;
    hls.on('bufferCodecs', (data: any) => { codecEvent = data; });
    (bc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({ levels: [{ codecSet: 'avc1.64001e,mp4a.40.2' }], audioTracks: [] });
    expect(codecEvent).not.toBeNull();
    bc.destroy();
  });

  it('should handle manifest parsed with no levels', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    let codecEvent = false;
    hls.on('bufferCodecs', () => { codecEvent = true; });
    (bc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({ levels: [], audioTracks: [] });
    expect(codecEvent).toBe(false);
    bc.destroy();
  });

  it('should handle buffer codecs without creating source buffers if media source not ready', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    (bc as unknown as { _onBufferCodecs: (data: any) => void })._onBufferCodecs({ videoCodec: 'avc1.64001e' });
    bc.destroy();
  });

  it('should handle buffer appending with queuing', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    const data = new ArrayBuffer(100);
    (bc as unknown as { _onBufferAppending: (data: any) => void })._onBufferAppending({ data, type: 'video' });
    bc.destroy();
  });

  it('should handle buffer flushing', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    (bc as unknown as { _onBufferFlushing: (data: any) => void })._onBufferFlushing({ startOffset: 0, endOffset: 10 });
    bc.destroy();
  });

  it('should handle media attach/detach cycle twice', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    const video = { src: '' } as unknown as HTMLVideoElement;
    (bc as unknown as { _onMediaAttached: (data: { media: HTMLVideoElement }) => void })._onMediaAttached({ media: video });
    (bc as unknown as { _onMediaDetached: () => void })._onMediaDetached();
    (bc as unknown as { _onMediaAttached: (data: { media: HTMLVideoElement }) => void })._onMediaAttached({ media: video });
    (bc as unknown as { _onMediaDetached: () => void })._onMediaDetached();
    bc.destroy();
  });
});
