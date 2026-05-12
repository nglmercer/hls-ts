export interface Level {
  id: number;
  url: string;
  bitrate: number;
  width: number;
  height: number;
  audioCodec: string;
  videoCodec: string;
  codecSet: string;
  name: string;
  frameRate: number;
  details?: LevelDetails;
}

export interface LevelDetails {
  version: number;
  targetduration: number;
  totalduration: number;
  startSN: number;
  endSN: number;
  fragStart: number;
  fragments: Fragment[];
  live: boolean;
  type: string;
  updated: number;
  advanced: boolean;
  availabilityDelay: number;
}

export interface Fragment {
  url: string;
  sn: number;
  level: number;
  duration: number;
  start: number;
  cc: number;
  byteRangeStart: number;
  byteRangeEnd: number;
  programDateTime: number;
  initSegment: { url: string; byteRangeStart: number; byteRangeEnd: number } | null;
  tagList: string[][];
  stats: FragmentStats;
}

export interface FragmentStats {
  loaded: number;
  total: number;
  trequest: number;
  tfirst: number;
  tload: number;
  aborted: boolean;
  loading: boolean;
}

export interface LevelParsed {
  url: string;
  bitrate: number;
  width: number;
  height: number;
  audioCodec: string;
  videoCodec: string;
  codecSet: string;
  name: string;
  frameRate: number;
}

export interface MediaPlaylist {
  type: 'AUDIO' | 'SUBTITLES' | 'CLOSED-CAPTIONS';
  groupId: string;
  name: string;
  url: string;
  language: string;
  default: boolean;
  autoselect: boolean;
  forced: boolean;
  characteristics: string;
}

export interface ManifestData {
  levels: LevelParsed[];
  audioTracks: MediaPlaylist[];
  subtitleTracks: MediaPlaylist[];
  url: string;
}
