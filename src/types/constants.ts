export const TrackTypes = {
  VIDEO: 'video',
  AUDIO: 'audio',
} as const;

export type TrackType = (typeof TrackTypes)[keyof typeof TrackTypes];

export const SourceBufferModes = {
  SEGMENTS: 'segments',
  SEQUENCE: 'sequence',
} as const;

export type SourceBufferMode = (typeof SourceBufferModes)[keyof typeof SourceBufferModes];

export const BackoffTypes = {
  LINEAR: 'linear',
  EXPONENTIAL: 'exponential',
} as const;

export type BackoffType = (typeof BackoffTypes)[keyof typeof BackoffTypes];

export const PlaylistTypes = {
  MASTER: 'master',
  AUDIO: 'AUDIO',
  SUBTITLES: 'SUBTITLES',
  VIDEO: 'VIDEO',
  VOD: 'VOD',
  EVENT: 'EVENT',
  CLOSED_CAPTIONS: 'CLOSED-CAPTIONS',
} as const;

export type PlaylistType = (typeof PlaylistTypes)[keyof typeof PlaylistTypes];

export const HlsTags = {
  EXT_X_STREAM_INF: '#EXT-X-STREAM-INF:',
  EXT_X_MEDIA: '#EXT-X-MEDIA:',
  EXT_X_TARGETDURATION: '#EXT-X-TARGETDURATION:',
  EXT_X_VERSION: '#EXT-X-VERSION:',
  EXT_X_MEDIA_SEQUENCE: '#EXT-X-MEDIA-SEQUENCE:',
  EXT_X_ENDLIST: '#EXT-X-ENDLIST',
  EXT_X_DISCONTINUITY: '#EXT-X-DISCONTINUITY',
  EXT_X_KEY: '#EXT-X-KEY:',
  EXT_X_PLAYLIST_TYPE: '#EXT-X-PLAYLIST-TYPE:',
  EXT_X_MAP: '#EXT-X-MAP:',
  EXTINF: '#EXTINF:',
  EXT_X_BYTERANGE: '#EXT-X-BYTERANGE:',
  EXT_X_PROGRAM_DATE_TIME: '#EXT-X-PROGRAM-DATE-TIME:',
  EXT_X_DATERANGE: '#EXT-X-DATERANGE:',
} as const;

export const MediaSourceReadyStates = {
  OPEN: 'open',
  CLOSED: 'closed',
  ENDED: 'ended',
} as const;

export const MediaSourceEvents = {
  SOURCE_OPEN: 'sourceopen',
  SOURCE_ENDED: 'sourceended',
  SOURCE_CLOSE: 'sourceclose',
} as const;

export const SourceBufferEvents = {
  UPDATE_END: 'updateend',
  UPDATE_START: 'updatestart',
  UPDATE: 'update',
  ERROR: 'error',
  ABORT: 'abort',
} as const;

export const MimeTypes = {
  VIDEO_MP4: 'video/mp4',
  AUDIO_MP4: 'audio/mp4',
} as const;

export const DefaultCodecs = {
  AVC: 'avc1.42e01e',
} as const;
