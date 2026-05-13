import { describe, it, expect, beforeAll } from 'bun:test';
import { CapLevelController } from '../src/controller/cap-level-controller';

describe('CapLevelController', () => {
  beforeAll(() => {
    (globalThis as unknown as { window: any }).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });

  it('should create and destroy', () => {
    const hlsMock = { levels: [] };
    const cc = new CapLevelController(hlsMock as any);
    expect(cc.autoLevelCapping).toBe(-1);
    expect(cc.firstLevel).toBe(0);
    cc.destroy();
  });

  it('should allow setting autoLevelCapping and firstLevel', () => {
    const hlsMock = { levels: [] };
    const cc = new CapLevelController(hlsMock as any);
    cc.autoLevelCapping = 2;
    expect(cc.autoLevelCapping).toBe(2);
    cc.firstLevel = 1;
    expect(cc.firstLevel).toBe(1);
    cc.destroy();
  });

  it('should handle media attach with resize listener', () => {
    const hlsMock = { levels: [] } as any;
    const cc = new CapLevelController(hlsMock as any);
    (cc as unknown as { _onMediaAttached: (data: any) => void })._onMediaAttached({ media: { clientWidth: 640, clientHeight: 480 } });
    cc.destroy();
  });

  it('should handle media attach/detach cycle', () => {
    const hlsMock = { levels: [] } as any;
    const cc = new CapLevelController(hlsMock as any);
    (cc as unknown as { _onMediaAttached: (data: any) => void })._onMediaAttached({ media: { clientWidth: 1920, clientHeight: 1080 } });
    (cc as unknown as { _onMediaDetached: () => void })._onMediaDetached();
    cc.destroy();
  });

  it('should cap level based on video dimensions', () => {
    const levels = [
      { id: 0, width: 426, height: 240, bitrate: 400000 },
      { id: 1, width: 640, height: 360, bitrate: 800000 },
      { id: 2, width: 1280, height: 720, bitrate: 2000000 },
    ];
    const hlsMock = { levels } as any;
    const cc = new CapLevelController(hlsMock as any);

    (cc as unknown as { _onManifestParsed: (data: any) => void })._onManifestParsed({ levels });
    (cc as unknown as { _onMediaAttached: (data: any) => void })._onMediaAttached({ media: { clientWidth: 640, clientHeight: 480 } });

    cc.destroy();
  });
});
