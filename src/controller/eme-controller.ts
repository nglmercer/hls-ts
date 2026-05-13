import { Events } from '../types/events';
import type { Hls } from '../core/Hls';
import { Logger } from '../utils/logger';
import { ErrorTypes, ErrorDetails, type HlsError } from '../types';
import type { DrmSystemConfig } from '../types/config';

interface KeySystem {
  systemString: string;
  config: DrmSystemConfig;
}

export class EMEController {
  private hls: Hls;
  private _media: HTMLMediaElement | null = null;
  private logger = new Logger('EMEController');
  private _mediaKeys: MediaKeys | null = null;
  private _keySystemAccess: MediaKeySystemAccess | null = null;
  private _hasConfigured: boolean = false;
  private _sessions: MediaKeySession[] = [];

  constructor(hls: Hls) {
    this.hls = hls;
  }

  _onMediaAttached = (data: { media: HTMLMediaElement }): void => {
    this._media = data.media;
    this._media.addEventListener('encrypted', this._onEncrypted);
    this._attemptKeySystemAccess();
  };

  _onMediaDetached = (): void => {
    if (this._media) {
      this._media.removeEventListener('encrypted', this._onEncrypted);
      this._media.setMediaKeys(null).catch(() => {});
      this._media = null;
    }
    this._closeSessions();
    this._mediaKeys = null;
    this._keySystemAccess = null;
    this._hasConfigured = false;
  };

  _onManifestParsed = (): void => {
    this._attemptKeySystemAccess();
  };

  private async _attemptKeySystemAccess(): Promise<void> {
    if (!this._media || this._hasConfigured || !this.hls.config.drm) return;
    
    const drmConfig = this.hls.config.drm;
    const systemsToTry: KeySystem[] = [];

    if (drmConfig.widevine) systemsToTry.push({ systemString: 'com.widevine.alpha', config: drmConfig.widevine });
    if (drmConfig.playready) systemsToTry.push({ systemString: 'com.microsoft.playready', config: drmConfig.playready });
    // FairPlay requires a bit more custom logic for initData, but we can add the generic system string for now
    if (drmConfig.fairplay) systemsToTry.push({ systemString: 'com.apple.fps', config: drmConfig.fairplay });

    if (systemsToTry.length === 0) return;

    this._hasConfigured = true; // Prevent multiple concurrent attempts

    for (const sys of systemsToTry) {
      try {
        const config = this._buildMediaKeySystemConfiguration(sys.config);
        const access = await navigator.requestMediaKeySystemAccess(sys.systemString, [config]);
        
        this.logger.log(`KeySystemAccess supported for ${sys.systemString}`);
        this.hls.trigger(Events.KEY_SYSTEM_ACCESS_SUPPORTED, { keySystem: sys.systemString });
        
        this._keySystemAccess = access;
        const keys = await access.createMediaKeys();
        
        // If there's a server certificate, set it now
        if (sys.config.serverCertificateUrl) {
          await this._fetchAndSetServerCertificate(keys, sys.config.serverCertificateUrl);
        }

        this._mediaKeys = keys;
        
        if (this._media) {
          await this._media.setMediaKeys(keys);
        }
        
        // Successfully configured, no need to try others
        return;
      } catch (err) {
        this.logger.warn(`Failed to access key system ${sys.systemString}: ${(err as Error).message}`);
      }
    }

    this.logger.error('No supported DRM key system found');
    this.hls.trigger(Events.KEY_SYSTEM_ACCESS_DENIED);
  }

  private _buildMediaKeySystemConfiguration(config: DrmSystemConfig): MediaKeySystemConfiguration {
    return {
      initDataTypes: ['cenc', 'keyids', 'webm'],
      videoCapabilities: [
        { contentType: 'video/mp4; codecs="avc1.42E01E"', robustness: config.videoRobustness || '' }
      ],
      audioCapabilities: [
        { contentType: 'audio/mp4; codecs="mp4a.40.2"', robustness: config.audioRobustness || '' }
      ]
    };
  }

  private async _fetchAndSetServerCertificate(keys: MediaKeys, url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch certificate: ${response.status}`);
      const cert = await response.arrayBuffer();
      await keys.setServerCertificate(cert);
    } catch (err) {
      this.logger.error(`Error setting server certificate: ${(err as Error).message}`);
    }
  }

  private _onEncrypted = async (event: Event): Promise<void> => {
    const encEvent = event as MediaEncryptedEvent;
    if (!encEvent.initDataType || !encEvent.initData) return;

    if (!this._mediaKeys) {
      this.logger.warn('Received encrypted event but MediaKeys are not initialized');
      return;
    }

    try {
      const session = this._mediaKeys.createSession();
      this._sessions.push(session);
      
      session.addEventListener('message', this._onSessionMessage);
      
      await session.generateRequest(encEvent.initDataType, encEvent.initData);
      this.hls.trigger(Events.MEDIA_KEY_SESSION_CREATED, { session });
    } catch (err) {
      this.logger.error(`Failed to create session or generate request: ${(err as Error).message}`);
      this.hls.trigger(Events.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_LICENSE_REQUEST_FAILED,
        fatal: true,
        reason: (err as Error).message
      } as HlsError);
    }
  };

  private _onSessionMessage = async (event: Event): Promise<void> => {
    const msgEvent = event as MediaKeyMessageEvent;
    const session = msgEvent.target as MediaKeySession;
    
    // Find which config we are currently using based on the active KeySystemAccess
    const activeSystemString = this._keySystemAccess?.keySystem;
    let drmConfig: DrmSystemConfig | undefined;
    
    if (activeSystemString === 'com.widevine.alpha') drmConfig = this.hls.config.drm?.widevine;
    else if (activeSystemString === 'com.microsoft.playready') drmConfig = this.hls.config.drm?.playready;
    else if (activeSystemString === 'com.apple.fps') drmConfig = this.hls.config.drm?.fairplay;

    if (!drmConfig || !drmConfig.licenseUrl) {
      this.logger.error('No license URL configured for the active DRM system');
      return;
    }

    this.hls.trigger(Events.MEDIA_KEY_MESSAGE, { session, message: msgEvent.message, messageType: msgEvent.messageType });

    try {
      // Fetch the license
      const response = await fetch(drmConfig.licenseUrl, {
        method: 'POST',
        headers: drmConfig.headers || {},
        body: msgEvent.message
      });

      if (!response.ok) {
        throw new Error(`License request failed with status ${response.status}`);
      }

      const license = await response.arrayBuffer();
      await session.update(license);
      
      this.logger.log('MediaKeySession updated with license successfully');
      this.hls.trigger(Events.MEDIA_KEY_SESSION_UPDATED, { session });
    } catch (err) {
      this.logger.error(`Failed to fetch or update license: ${(err as Error).message}`);
      this.hls.trigger(Events.ERROR, {
        type: ErrorTypes.KEY_SYSTEM_ERROR,
        details: ErrorDetails.KEY_SYSTEM_LICENSE_REQUEST_FAILED,
        fatal: true,
        reason: (err as Error).message
      } as HlsError);
    }
  };

  private _closeSessions(): void {
    for (const session of this._sessions) {
      session.removeEventListener('message', this._onSessionMessage);
      session.close().catch(() => {});
    }
    this._sessions = [];
  }

  destroy(): void {
    this._onMediaDetached();
  }
}
