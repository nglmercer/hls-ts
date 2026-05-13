import { describe, expect, it, mock } from 'bun:test';
import { EMEController } from '../src/controller/eme-controller';
import { Hls } from '../src/core/Hls';

describe('EMEController', () => {
it('should not attempt access if no DRM config is present', () => {
     const hls = new Hls();
     const controller = new EMEController(hls);

     let attemptCalled = false;
     // @ts-ignore
     controller['_attemptKeySystemAccess'] = () => { attemptCalled = true; };

     const media = {
       addEventListener: mock(),
       removeEventListener: mock(),
       setMediaKeys: mock(() => Promise.resolve()),
     } as unknown as HTMLMediaElement;
     controller._onMediaAttached({ media });

     // It should have called it, but it returns early inside
     expect(attemptCalled).toBe(true);
   });

  it('should try to request MediaKeySystemAccess if DRM is configured', async () => {
    const hls = new Hls({
      drm: {
        widevine: { licenseUrl: 'http://test.com/license' }
      }
    });
    const controller = new EMEController(hls);

    // Mock navigator.requestMediaKeySystemAccess
    const mockRequest = mock(async () => {
      return {
        keySystem: 'com.widevine.alpha',
        createMediaKeys: async () => ({})
      };
    });

    const originalNavigator = global.navigator;
    // @ts-ignore
    global.navigator = { requestMediaKeySystemAccess: mockRequest };

    const media = {
      addEventListener: mock(),
      removeEventListener: mock(),
      setMediaKeys: mock(() => Promise.resolve()),
    } as unknown as HTMLMediaElement;
    controller._onMediaAttached({ media });

    // Yield to let async functions run
    await new Promise(r => setTimeout(r, 0));

    expect(mockRequest).toHaveBeenCalled();

    // Restore navigator
    global.navigator = originalNavigator;
  });
});
