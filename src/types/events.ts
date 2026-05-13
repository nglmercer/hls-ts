import { TrackType } from './constants';
import type { Level, LevelDetails, Fragment, Part, MediaPlaylist, ManifestData, LevelParsed } from './level';
import type { HlsError } from './errors';

export const Events = {
  MEDIA_ATTACHED: 'mediaAttached',
  MEDIA_DETACHED: 'mediaDetached',
  MEDIA_SEEKING: 'mediaSeeking',
  MEDIA_SEEKED: 'mediaSeeked',
  BUFFER_RESET: 'bufferReset',
  BUFFER_CODECS: 'bufferCodecs',
  BUFFER_APPENDING: 'bufferAppending',
  BUFFER_APPENDED: 'bufferAppended',
  BUFFER_FLUSHING: 'bufferFlushing',
  BUFFER_FLUSHED: 'bufferFlushed',
  MANIFEST_LOADING: 'manifestLoading',
  MANIFEST_LOADED: 'manifestLoaded',
  MANIFEST_PARSED: 'manifestParsed',
  LEVEL_SWITCHING: 'levelSwitching',
  LEVEL_SWITCHED: 'levelSwitched',
  LEVEL_LOADING: 'levelLoading',
  LEVEL_LOADED: 'levelLoaded',
  LEVEL_UPDATED: 'levelUpdated',
  FRAG_LOADING: 'fragLoading',
  FRAG_LOAD_PROGRESS: 'fragLoadProgress',
  FRAG_LOADED: 'fragLoaded',
  FRAG_DECRYPTED: 'fragDecrypted',
  FRAG_PARSING_INIT_SEGMENT: 'fragParsingInitSegment',
  FRAG_PARSING_DATA: 'fragParsingData',
  FRAG_PARSED: 'fragParsed',
  FRAG_BUFFERED: 'fragBuffered',
  AUDIO_TRACKS_UPDATED: 'audioTracksUpdated',
  AUDIO_TRACK_SWITCHING: 'audioTrackSwitching',
  AUDIO_TRACK_SWITCHED: 'audioTrackSwitched',
  SUBTITLE_TRACKS_UPDATED: 'subtitleTracksUpdated',
  SUBTITLE_TRACK_SWITCH: 'subtitleTrackSwitch',
  FRAG_PARSING_METADATA: 'fragParsingMetadata',
  DATERANGE_ENTERED: 'daterangeEntered',
  DATERANGE_EXITED: 'daterangeExited',
  METADATA_FOUND: 'metadataFound',
  KEY_SYSTEM_ACCESS_SUPPORTED: 'keySystemAccessSupported',
  KEY_SYSTEM_ACCESS_DENIED: 'keySystemAccessDenied',
  MEDIA_KEY_SESSION_CREATED: 'mediaKeySessionCreated',
  MEDIA_KEY_MESSAGE: 'mediaKeyMessage',
  MEDIA_KEY_SESSION_UPDATED: 'mediaKeySessionUpdated',
  MEDIA_KEY_ERROR: 'mediaKeyError',
  ERROR: 'hlsError',
  DESTROYING: 'hlsDestroying',
} as const;

export type Event = (typeof Events)[keyof typeof Events];

// ---------------------------------------------------------------------------
// Local payload interfaces (avoids circular deps with remux/parser modules)
// ---------------------------------------------------------------------------

/** Payload for BUFFER_CODECS */
export interface CodecInfo {
  videoCodec?: string;
  audioCodec?: string;
}

/** Replay of LoaderStats so types/events.ts stays self-contained */
export interface FragmentLoadStats {
  loaded: number;
  total: number;
  trequest: number;
  tfirst: number;
  tload: number;
  aborted: boolean;
  loading: boolean;
}

/** Minimal shape matching RemuxResult used in FRAG_PARSING_INIT_SEGMENT */
export interface RemuxResult {
  initSegment?: Uint8Array;
  data?: Uint8Array;
  audioData?: Uint8Array;
  videoData?: Uint8Array;
  videoTrack?: { id: number; type: TrackType; timescale: number; codec: string; width?: number; height?: number; sps: Uint8Array[]; pps: Uint8Array[]; samples: Array<{ size: number; duration: number; dts: number; pts: number; keyframe: boolean; data: Uint8Array }> };
  audioTrack?: { id: number; type: TrackType; timescale: number; codec: string; channelCount?: number; sampleRate?: number; config?: Uint8Array; samples: Array<{ size: number; duration: number; dts: number; pts: number; data: Uint8Array }> };
  metadata?: Array<{ pts: number; data: Uint8Array }>;
}

/** Shape of the expanded data object the parser produces for LEVEL_LOADED. */
export interface PlaylistParseResult {
  fragments: Array<{
    sn: number;
    duration: number;
    start: number;
    url: string;
    byteRangeStart: number;
    byteRangeEnd: number;
    programDateTime: number;
    tagList: string[][];
    initSegment: { url: string; byteRangeStart: number; byteRangeEnd: number } | null;
    parts?: Part[];
  }>;
  targetduration: number;
  version: number;
  startSN: number;
  endSN: number;
  live: boolean;
  type: string;
  initSegment: { url: string; byteRangeStart: number; byteRangeEnd: number } | null;
  dateranges?: Array<{
    id: string;
    class?: string;
    startDate: string;
    endDate?: string;
    duration?: number;
    plannedDuration?: number;
    scte35Cmd?: string;
    scte35Out?: string;
    scte35In?: string;
    endOnNext?: boolean;
    attributes: Record<string, string>;
  }>;
  partTarget?: number;
  partHoldBack?: number;
  canBlockReload?: boolean;
  canSkipUntil?: number;
  preloadHint?: {
    type: 'PART' | 'MAP';
    uri: string;
    byteRangeStart?: number;
    byteRangeEnd?: number;
  };
}

// ---------------------------------------------------------------------------
// Event payload map – single source of truth for every event's data shape
// ---------------------------------------------------------------------------

export type HlsEventPayloads = {
  [Events.MEDIA_ATTACHED]: { media: HTMLMediaElement };
  [Events.MEDIA_DETACHED]: void;
  [Events.MEDIA_SEEKING]: void;
  [Events.MEDIA_SEEKED]: void;
  [Events.BUFFER_RESET]: void;
  [Events.BUFFER_CODECS]: CodecInfo;
  [Events.BUFFER_APPENDING]: { data: ArrayBuffer; type: TrackType };
  [Events.BUFFER_APPENDED]: void;
  [Events.BUFFER_FLUSHING]: { startOffset: number; endOffset: number; type?: TrackType };
  [Events.BUFFER_FLUSHED]: void;
  [Events.MANIFEST_LOADING]: { url: string };
  [Events.MANIFEST_LOADED]: ManifestData & { data: string };
  [Events.MANIFEST_PARSED]: ManifestData;
  [Events.LEVEL_SWITCHING]: { level: number };
  [Events.LEVEL_SWITCHED]: { level: number };
  [Events.LEVEL_LOADING]: { url: string; level?: Level };
  [Events.LEVEL_LOADED]: { url: string; data: string } & PlaylistParseResult;
  [Events.LEVEL_UPDATED]: { level: Level; details: LevelDetails };
  [Events.FRAG_LOADING]: { frag: Fragment; part?: Part };
  [Events.FRAG_LOAD_PROGRESS]: { frag: Fragment; part?: Part; stats: FragmentLoadStats };
  [Events.FRAG_LOADED]: { frag: Fragment; part?: Part; stats: FragmentLoadStats };
  [Events.FRAG_DECRYPTED]: { frag: Fragment };
  [Events.FRAG_PARSING_INIT_SEGMENT]: { frag: Fragment; tracks: RemuxResult };
  [Events.FRAG_PARSING_DATA]: { frag: Fragment; data: Uint8Array; type: TrackType };
  [Events.FRAG_PARSED]: { frag: Fragment };
  [Events.FRAG_BUFFERED]: { frag: Fragment };
  [Events.AUDIO_TRACKS_UPDATED]: { audioTracks: MediaPlaylist[] };
  [Events.AUDIO_TRACK_SWITCHING]: { id: number; track: MediaPlaylist | null };
  [Events.AUDIO_TRACK_SWITCHED]: { id: number; track: MediaPlaylist | null };
  [Events.SUBTITLE_TRACKS_UPDATED]: { subtitleTracks: MediaPlaylist[] };
  [Events.SUBTITLE_TRACK_SWITCH]: { id: number; track: MediaPlaylist | null };
  [Events.FRAG_PARSING_METADATA]: { frag: Fragment; samples: Array<{ pts: number; data: Uint8Array }> };
  [Events.DATERANGE_ENTERED]: any;    // see metadata-controller for rich typing
  [Events.DATERANGE_EXITED]: any;
  [Events.METADATA_FOUND]: any;
  [Events.KEY_SYSTEM_ACCESS_SUPPORTED]: { keySystem: string };
  [Events.KEY_SYSTEM_ACCESS_DENIED]: void;
  [Events.MEDIA_KEY_SESSION_CREATED]: { session: MediaKeySession };
  [Events.MEDIA_KEY_MESSAGE]: { session: MediaKeySession; message: Uint8Array; messageType: string };
  [Events.MEDIA_KEY_SESSION_UPDATED]: { session: MediaKeySession };
  [Events.MEDIA_KEY_ERROR]: void;
  [Events.ERROR]: HlsError;
  [Events.DESTROYING]: void;
};