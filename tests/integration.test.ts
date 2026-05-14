import { describe, it, expect, spyOn } from 'bun:test';
import { Hls } from '../src/core/Hls';
import { Events, ErrorTypes, type HlsError } from '../src/types';
import { BufferController } from '../src/controller/buffer-controller';

describe('Hls Integration', () => {
  it('should emit MEDIA_ATTACHED when attachMedia is called', () => {
    const hls = new Hls();
    let eventData: { media: HTMLVideoElement } | null = null;
    hls.on(Events.MEDIA_ATTACHED, (data: { media: HTMLMediaElement }) => { eventData = data as { media: HTMLVideoElement }; });
    const video = { 
      src: '',
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLVideoElement;
    hls.attachMedia(video);
    expect(eventData).not.toBeNull();
    expect(eventData!.media).toBe(video);
  });

  it('should emit MEDIA_DETACHED when detachMedia is called', () => {
    const hls = new Hls();
    let emitted = false;
    hls.on(Events.MEDIA_DETACHED, () => { emitted = true; });
    hls.detachMedia();
    expect(emitted).toBe(true);
  });

  it('should emit DESTROYING when destroy is called', () => {
    const hls = new Hls();
    let emitted = false;
    hls.on(Events.DESTROYING, () => { emitted = true; });
    hls.destroy();
    expect(emitted).toBe(true);
  });

  it('should clear media and url on destroy', () => {
    const hls = new Hls();
    hls.loadSource('http://example.com/manifest.m3u8');
    hls.attachMedia({ 
      src: '',
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as HTMLVideoElement);
    hls.destroy();
    expect(hls.media).toBeNull();
    expect(hls.url).toBeNull();
  });

  it('should not emit after destroy', () => {
    const hls = new Hls();
    let count = 0;
    hls.on(Events.MANIFEST_LOADING, () => count++);
    hls.destroy();
    hls.trigger(Events.MANIFEST_LOADING, { url: 'test.m3u8' });
    expect(count).toBe(0);
  });

  it('should merge userConfig with defaults', () => {
    const hls = new Hls({ startLevel: 5, debug: true });
    expect(hls.config.startLevel).toBe(5);
    expect(hls.config.debug).toBe(true);
    expect(hls.config.maxBufferLength).toBe(30);
  });

  it('should have static defaultConfig', () => {
    expect(Hls.defaultConfig).toBeUndefined();
    const prevDefault = Hls.defaultConfig;
    (Hls as unknown as { defaultConfig: any }).defaultConfig = { startLevel: 2 } as any;
    const hls = new Hls();
    expect(hls.config.startLevel).toBe(2);
    expect(hls.config.maxBufferLength).toBe(30);
    Hls.defaultConfig = prevDefault;
  });

  it('should provide levels accessor', () => {
    const hls = new Hls();
    expect(hls.levels).toEqual([]);
  });

  it('should flag event on error trigger', () => {
    const hls = new Hls();
    let errorEvent: HlsError | null = null;
    hls.on(Events.ERROR, (data: HlsError) => { errorEvent = data; });
    hls.trigger(Events.ERROR, { type: ErrorTypes.NETWORK_ERROR, details: 'manifestLoadError', fatal: true, reason: 'test' });
    expect(errorEvent).not.toBeNull();
    expect(errorEvent!.type).toBe('networkError');
    expect(errorEvent!.fatal).toBe(true);
  });

  it('should support level events lifecycle', () => {
    const hls = new Hls();
    const events: string[] = [];
    hls.on(Events.MANIFEST_LOADING, () => events.push('loading'));
    hls.on(Events.MANIFEST_LOADED, () => events.push('loaded'));
    hls.on(Events.MANIFEST_PARSED, () => events.push('parsed'));

    hls.trigger(Events.MANIFEST_LOADING, { url: 'test.m3u8' });
hls.trigger(Events.MANIFEST_LOADED, {
       data: '',
       levels: [],
       audioTracks: [],
       subtitleTracks: [],
       url: 'http://example.com/media.m3u8',
     });
     hls.trigger(Events.MANIFEST_PARSED, {
       levels: [],
       audioTracks: [],
       subtitleTracks: [],
       url: 'http://example.com/media.m3u8',
     });

    expect(events).toEqual(['loading', 'loaded', 'parsed']);
  });
});

describe('BufferController construction', () => {
  it('should create and destroy', () => {
    const hls = new Hls();
    const bc = new BufferController(hls);
    bc.destroy();
  });
});
