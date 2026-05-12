export const ErrorTypes = {
  NETWORK_ERROR: 'networkError',
  MEDIA_ERROR: 'mediaError',
  KEY_SYSTEM_ERROR: 'keySystemError',
  MUX_ERROR: 'muxError',
  OTHER_ERROR: 'otherError',
} as const;

export type ErrorType = (typeof ErrorTypes)[keyof typeof ErrorTypes];

export const ErrorDetails = {
  KEY_SYSTEM_NO_KEYS: 'keySystemNoKeys',
  KEY_SYSTEM_NO_ACCESS: 'keySystemNoAccess',
  KEY_SYSTEM_NO_SESSION: 'keySystemNoSession',
  KEY_SYSTEM_NO_CONFIGURED_LICENSE: 'keySystemNoConfiguredLicense',
  KEY_SYSTEM_LICENSE_REQUEST_FAILED: 'keySystemLicenseRequestFailed',
  MANIFEST_LOAD_ERROR: 'manifestLoadError',
  MANIFEST_LOAD_TIMEOUT: 'manifestLoadTimeout',
  MANIFEST_PARSING_ERROR: 'manifestParsingError',
  MANIFEST_INCOMPATIBLE_CODECS_ERROR: 'manifestIncompatibleCodecsError',
  LEVEL_LOAD_ERROR: 'levelLoadError',
  LEVEL_LOAD_TIMEOUT: 'levelLoadTimeout',
  LEVEL_SWITCH_ERROR: 'levelSwitchError',
  AUDIO_TRACK_LOAD_ERROR: 'audioTrackLoadError',
  AUDIO_TRACK_LOAD_TIMEOUT: 'audioTrackLoadTimeout',
  FRAG_LOAD_ERROR: 'fragLoadError',
  FRAG_LOAD_TIMEOUT: 'fragLoadTimeout',
  FRAG_DECRYPT_ERROR: 'fragDecryptError',
  FRAG_PARSING_ERROR: 'fragParsingError',
  BUFFER_APPEND_ERROR: 'bufferAppendError',
  BUFFER_ADD_CODEC_ERROR: 'bufferAddCodecError',
  BUFFER_INCOMPATIBLE_CODECS_ERROR: 'bufferIncompatibleCodecsError',
  BUFFER_FULL_ERROR: 'bufferFullError',
  INTERNAL_EXCEPTION: 'internalException',
} as const;

export type ErrorDetail = (typeof ErrorDetails)[keyof typeof ErrorDetails];

export interface HlsError {
  type: ErrorType;
  details: ErrorDetail;
  fatal: boolean;
  reason: string;
  buffer?: number;
  bytes?: number;
  url?: string;
  frag?: { url: string; sn: number; level: number };
  parent?: { url: string };
}
