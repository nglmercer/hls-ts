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
  addEventListener(event: string, cb: any) {}
  removeEventListener(event: string, cb: any) {}
  static isTypeSupported(mime: string): boolean {
    return true;
  }
}

describe('BufferController', () => {
  beforeAll(() => {
    (globalThis as any).MediaSource = MockMediaSource;
    (globalThis as any).URL.createObjectURL = () => 'blob:test';
    (globalThis as any).URL.revokeObjectURL = () => {};
  });

  it('should create and destroy', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    bc.destroy();
  });

  it('should handle media attach', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    const video = { src: '' } as any;
    (bc as any)._onMediaAttached({ media: video });
    bc.destroy();
  });

  it('should handle media detach', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    (bc as any)._onMediaAttached({ media: { src: '' } as any });
    (bc as any)._onMediaDetached();
    bc.destroy();
  });

  it('should handle manifest parsed for codec info', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    let codecEvent: any = null;
    hls.on('bufferCodecs', (data: any) => { codecEvent = data; });
    (bc as any)._onManifestParsed({ levels: [{ codecSet: 'avc1.64001e,mp4a.40.2' }], audioTracks: [] });
    expect(codecEvent).not.toBeNull();
    bc.destroy();
  });

  it('should handle manifest parsed with no levels', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    let codecEvent = false;
    hls.on('bufferCodecs', () => { codecEvent = true; });
    (bc as any)._onManifestParsed({ levels: [], audioTracks: [] });
    expect(codecEvent).toBe(false);
    bc.destroy();
  });

  it('should handle buffer codecs without creating source buffers if media source not ready', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    (bc as any)._onBufferCodecs({ videoCodec: 'avc1.64001e' });
    bc.destroy();
  });

  it('should handle buffer appending with queuing', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    const data = new ArrayBuffer(100);
    (bc as any)._onBufferAppending({ data, type: 'video' });
    bc.destroy();
  });

  it('should handle buffer flushing', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    (bc as any)._onBufferFlushing({ startOffset: 0, endOffset: 10 });
    bc.destroy();
  });

  it('should handle media attach/detach cycle twice', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    const video = { src: '' } as any;
    (bc as any)._onMediaAttached({ media: video });
    (bc as any)._onMediaDetached();
    (bc as any)._onMediaAttached({ media: video });
    (bc as any)._onMediaDetached();
    bc.destroy();
  });
});
