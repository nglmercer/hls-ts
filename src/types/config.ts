import { BackoffTypes, type BackoffType } from './constants';

export interface LoadPolicyConfig {
  maxTimeToFirstByteMs: number;
  maxLoadTimeMs: number;
  timeoutRetry: RetryConfig;
  errorRetry: RetryConfig;
}

export interface RetryConfig {
  maxNumRetry: number;
  retryDelayMs: number;
  maxRetryDelayMs: number;
  backoff?: BackoffType;
}

export interface BufferConfig {
  maxBufferLength: number;
  maxBufferSize: number;
  maxBufferHole: number;
  backBufferLength: number;
}

export interface AbrConfig {
  abrEwmaFastLive: number;
  abrEwmaSlowLive: number;
  abrEwmaFastVoD: number;
  abrEwmaSlowVoD: number;
  abrBandWidthFactor: number;
  abrBandWidthUpFactor: number;
    abrMaxWithRealBitrate: boolean;
}

export interface DrmSystemConfig {
  licenseUrl?: string;
  serverCertificateUrl?: string;
  headers?: Record<string, string>;
  audioRobustness?: string;
  videoRobustness?: string;
}

export interface DrmConfig {
  widevine?: DrmSystemConfig;
  fairplay?: DrmSystemConfig;
  playready?: DrmSystemConfig;
}

export interface HlsConfig {
  debug: boolean;
  startLevel: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
  backBufferLength: number;
  liveSyncDurationCount: number;
  liveMaxLatencyDurationCount: number;
  enableWorker: boolean;
  defaultAudioCodec: string;
  manifestLoadPolicy: LoadPolicyConfig;
  playlistLoadPolicy: LoadPolicyConfig;
  fragLoadPolicy: LoadPolicyConfig;
  abrController: AbrConfig;
  startPosition: number;
  autoStartLoad: boolean;
  drm?: DrmConfig;
}

export const defaultConfig: HlsConfig = {
  debug: false,
  startLevel: -1,
  maxBufferLength: 30,
  maxMaxBufferLength: 600,
  backBufferLength: 30,
  liveSyncDurationCount: 3,
  liveMaxLatencyDurationCount: 6,
  enableWorker: true,
  defaultAudioCodec: '',
  manifestLoadPolicy: {
    maxTimeToFirstByteMs: 9000,
    maxLoadTimeMs: 100000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: 5, retryDelayMs: 3000, maxRetryDelayMs: 15000, backoff: BackoffTypes.LINEAR },
  },
  playlistLoadPolicy: {
    maxTimeToFirstByteMs: 9000,
    maxLoadTimeMs: 100000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: 5, retryDelayMs: 3000, maxRetryDelayMs: 15000, backoff: BackoffTypes.LINEAR },
  },
  fragLoadPolicy: {
    maxTimeToFirstByteMs: 9000,
    maxLoadTimeMs: 100000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: { maxNumRetry: 5, retryDelayMs: 3000, maxRetryDelayMs: 15000, backoff: 'linear' },
  },
  abrController: {
    abrEwmaFastLive: 3,
    abrEwmaSlowLive: 9,
    abrEwmaFastVoD: 3,
    abrEwmaSlowVoD: 9,
    abrBandWidthFactor: 0.95,
    abrBandWidthUpFactor: 0.7,
    abrMaxWithRealBitrate: false,
  },
  startPosition: -1,
  autoStartLoad: true,
  drm: {},
};
