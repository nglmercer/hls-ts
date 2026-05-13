import type { PlaylistType } from './constants';

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
export interface DateRange {
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
  // Calculated fields
  startTimeline?: number;
  endTimeline?: number;
  scte35Data?: any;
}

export interface Part {
  sn: number;
  part: number;
  uri: string;
  duration: number;
  independent: boolean;
  byteRangeStart?: number;
  byteRangeEnd?: number;
  gap?: boolean;
}

export interface PreloadHint {
  type: 'PART' | 'MAP';
  uri: string;
  byteRangeStart?: number;
  byteRangeEnd?: number;
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
  dateranges?: DateRange[];
  partTarget?: number;
  preloadHint?: PreloadHint;
  canBlockReload?: boolean;
  canSkipUntil?: number;
  partHoldBack?: number;
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
  parts?: Part[];
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
  type: PlaylistType;
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
