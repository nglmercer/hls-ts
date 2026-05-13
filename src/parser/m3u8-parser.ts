import { PlaylistTypes, HlsTags } from '../types';
import type { LevelParsed, MediaPlaylist, DateRange } from '../types/level';

interface ParseResult {
  levels: LevelParsed[];
  audioTracks: MediaPlaylist[];
  subtitleTracks: MediaPlaylist[];
}

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
    parts?: Array<{
      sn: number;
      part: number;
      uri: string;
      duration: number;
      independent: boolean;
      byteRangeStart?: number;
      byteRangeEnd?: number;
      gap?: boolean;
    }>;
  }>;
  targetduration: number;
  version: number;
  startSN: number;
  endSN: number;
  live: boolean;
  type: string;
  initSegment: { url: string; byteRangeStart: number; byteRangeEnd: number } | null;
  dateranges: Array<{
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

export function parseMasterPlaylist(data: string, baseurl: string): ParseResult {
  const levels: LevelParsed[] = [];
  const audioTracks: MediaPlaylist[] = [];
  const subtitleTracks: MediaPlaylist[] = [];
  const lines = data.split('\n');

  let currentBandwidth = 0;
  let currentResolution = '';
  let currentCodecs = '';
  let currentVideoRange = '';
  let currentFrameRate = 0;
  let currentName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith(HlsTags.EXT_X_STREAM_INF)) {
      const attrs = parseAttributes(line.substring(HlsTags.EXT_X_STREAM_INF.length));
      currentBandwidth = parseInt(attrs['BANDWIDTH'] || attrs['AVERAGE-BANDWIDTH'] || '0');
      currentResolution = attrs['RESOLUTION'] || '';
      currentCodecs = attrs['CODECS'] || '';
      currentVideoRange = attrs['VIDEO-RANGE'] || '';
      currentFrameRate = parseFloat(attrs['FRAME-RATE'] || '0');
      currentName = attrs['NAME'] || '';
    } else if (line.startsWith(HlsTags.EXT_X_MEDIA)) {
      const attrs = parseAttributes(line.substring(HlsTags.EXT_X_MEDIA.length));
      const type = attrs['TYPE'];
      const playlist: MediaPlaylist = {
        type: type as MediaPlaylist['type'],
        groupId: attrs['GROUP-ID'] || '',
        name: attrs['NAME'] || '',
        url: resolveUrl(attrs['URI'] || '', baseurl),
        language: attrs['LANGUAGE'] || '',
        default: attrs['DEFAULT'] === 'YES',
        autoselect: attrs['AUTOSELECT'] === 'YES',
        forced: attrs['FORCED'] === 'YES',
        characteristics: attrs['CHARACTERISTICS'] || '',
      };
      if (type === PlaylistTypes.AUDIO) {
        audioTracks.push(playlist);
      } else if (type === PlaylistTypes.SUBTITLES) {
        subtitleTracks.push(playlist);
      }
    } else if (line && !line.startsWith('#')) {
      const [width, height] = currentResolution.split('x').map(Number);
      const codecSet = currentCodecs.split(',').map(c => c.trim()).join(',');
      levels.push({
        url: resolveUrl(line, baseurl),
        bitrate: currentBandwidth,
        width: width || 0,
        height: height || 0,
        audioCodec: '',
        videoCodec: '',
        codecSet,
        name: currentName,
        frameRate: currentFrameRate,
      });
      currentBandwidth = 0;
      currentResolution = '';
      currentCodecs = '';
      currentFrameRate = 0;
      currentName = '';
    }
  }

  return { levels, audioTracks, subtitleTracks };
}

export function parseMediaPlaylist(data: string, baseurl: string): PlaylistParseResult {
  const fragments: PlaylistParseResult['fragments'] = [];
  const dateranges: PlaylistParseResult['dateranges'] = [];
  const parts: PlaylistParseResult['fragments'][0]['parts'] = [];
  const lines = data.split('\n');
  let targetduration = 0;
  let version = 1;
  let startSN = 0;
  let endSN = 0;
  let live = true;
  let type: string = PlaylistTypes.VOD;
  let currentDuration = 0;
  let currentTitle = '';
  let currentByteRange = '';
  let currentProgramDateTime = 0;
  let initSegment: PlaylistParseResult['initSegment'] = null;
  let isEndlist = false;
  let tagList: string[][] = [];
  let sn = 0;
  let startTime = 0;
  let partTarget = 0;
  let partHoldBack = 0;
  let canBlockReload = false;
  let canSkipUntil = 0;
  let preloadHint: any = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    if (line.startsWith(HlsTags.EXT_X_TARGETDURATION)) {
      targetduration = parseInt(line.substring(HlsTags.EXT_X_TARGETDURATION.length));
    } else if (line.startsWith(HlsTags.EXT_X_VERSION)) {
      version = parseInt(line.substring(HlsTags.EXT_X_VERSION.length));
    } else if (line.startsWith(HlsTags.EXT_X_MEDIA_SEQUENCE)) {
      startSN = parseInt(line.substring(HlsTags.EXT_X_MEDIA_SEQUENCE.length));
      sn = startSN;
    } else if (line === HlsTags.EXT_X_ENDLIST) {
      isEndlist = true;
    } else if (line === HlsTags.EXT_X_DISCONTINUITY) {
      tagList.push(['EXT-X-DISCONTINUITY']);
    } else if (line.startsWith(HlsTags.EXT_X_KEY)) {
      const attrs = parseAttributes(line.substring(HlsTags.EXT_X_KEY.length));
      tagList.push(['EXT-X-KEY', attrs['METHOD'] || '', attrs['URI'] || '', attrs['IV'] || '', attrs['KEYFORMAT'] || '']);
    } else if (line.startsWith(HlsTags.EXT_X_PLAYLIST_TYPE)) {
      type = line.substring(HlsTags.EXT_X_PLAYLIST_TYPE.length).trim();
    } else if (line.startsWith(HlsTags.EXT_X_MAP)) {
      const attrs = parseAttributes(line.substring(HlsTags.EXT_X_MAP.length));
      const uri = resolveUrl(attrs['URI'] || '', baseurl);
      const byteRange = attrs['BYTERANGE'] || '';
      const [rangeStart, rangeEnd] = parseByteRange(byteRange);
      initSegment = { url: uri, byteRangeStart: rangeStart, byteRangeEnd: rangeEnd };
    } else if (line.startsWith(HlsTags.EXTINF)) {
      const infData = line.substring(HlsTags.EXTINF.length);
      const commaIdx = infData.indexOf(',');
      currentDuration = parseFloat(infData.substring(0, commaIdx !== -1 ? commaIdx : infData.length));
      currentTitle = commaIdx !== -1 ? infData.substring(commaIdx + 1) : '';
    } else if (line.startsWith(HlsTags.EXT_X_BYTERANGE)) {
      currentByteRange = line.substring(HlsTags.EXT_X_BYTERANGE.length);
    } else if (line.startsWith(HlsTags.EXT_X_PROGRAM_DATE_TIME)) {
      currentProgramDateTime = new Date(line.substring(HlsTags.EXT_X_PROGRAM_DATE_TIME.length)).getTime();
    } else if (line && !line.startsWith('#')) {
      const [byteStart, byteEnd] = parseByteRange(currentByteRange);
      const url = resolveUrl(line, baseurl);
      fragments.push({
        sn,
        start: startTime,
        duration: currentDuration,
        url,
        byteRangeStart: byteStart,
        byteRangeEnd: byteEnd,
        programDateTime: currentProgramDateTime,
        tagList: [...tagList],
        initSegment: initSegment,
        parts: parts.length > 0 ? [...parts] : undefined,
      });
      startTime += currentDuration;
      sn++;
      currentDuration = 0;
      currentTitle = '';
      currentByteRange = '';
      currentProgramDateTime = 0;
      tagList = [];
      parts.length = 0; // Clear parts for next fragment
    } else if (line.startsWith(HlsTags.EXT_X_DATERANGE)) {
      const attrString = line.substring(HlsTags.EXT_X_DATERANGE.length);
      const attrs = parseAttributes(attrString);
      const daterange: Partial<DateRange> = { attributes: {} };

      for (const [key, value] of Object.entries(attrs)) {
        const k = key.toUpperCase();
        if (k === 'ID') daterange.id = value;
        else if (k === 'CLASS') daterange.class = value;
        else if (k === 'START-DATE') daterange.startDate = value;
        else if (k === 'END-DATE') daterange.endDate = value;
        else if (k === 'DURATION') daterange.duration = parseFloat(value);
        else if (k === 'PLANNED-DURATION') daterange.plannedDuration = parseFloat(value);
        else if (k === 'SCTE35-CMD') daterange.scte35Cmd = value;
        else if (k === 'SCTE35-OUT') daterange.scte35Out = value;
        else if (k === 'SCTE35-IN') daterange.scte35In = value;
        else if (k === 'END-ON-NEXT') daterange.endOnNext = value === 'YES';
        else daterange.attributes![key] = value;
      }
      dateranges.push(daterange as DateRange);
    } else if (line.startsWith(HlsTags.EXT_X_PART)) {
      const attrs = parseAttributes(line.substring(HlsTags.EXT_X_PART.length));
      const uri = resolveUrl(attrs['URI'] || '', baseurl);
      const duration = parseFloat(attrs['DURATION'] || '0');
      const independent = attrs['INDEPENDENT'] === 'YES';
      const gap = attrs['GAP'] === 'YES';
      const [byteStart, byteEnd] = parseByteRange(attrs['BYTERANGE'] || '');
      
      parts.push({
        sn,
        part: parts.length,
        uri,
        duration,
        independent,
        gap,
        byteRangeStart: byteStart,
        byteRangeEnd: byteEnd,
      });
    } else if (line.startsWith(HlsTags.EXT_X_PART_INF)) {
      const attrs = parseAttributes(line.substring(HlsTags.EXT_X_PART_INF.length));
      partTarget = parseFloat(attrs['PART-TARGET'] || '0');
    } else if (line.startsWith(HlsTags.EXT_X_SERVER_CONTROL)) {
      const attrs = parseAttributes(line.substring(HlsTags.EXT_X_SERVER_CONTROL.length));
      canBlockReload = attrs['CAN-BLOCK-RELOAD'] === 'YES';
      canSkipUntil = parseFloat(attrs['CAN-SKIP-UNTIL'] || '0');
      partHoldBack = parseFloat(attrs['PART-HOLD-BACK'] || '0');
    } else if (line.startsWith(HlsTags.EXT_X_PRELOAD_HINT)) {
      const attrs = parseAttributes(line.substring(HlsTags.EXT_X_PRELOAD_HINT.length));
      preloadHint = {
        type: attrs['TYPE'] || 'PART',
        uri: resolveUrl(attrs['URI'] || '', baseurl),
        ...parseByteRange(attrs['BYTERANGE'] || ''),
      };
    }
  }

  endSN = sn - 1;
  live = !isEndlist;

  return { 
    fragments, 
    targetduration, 
    version, 
    startSN, 
    endSN, 
    live, 
    type, 
    initSegment, 
    dateranges,
    partTarget: partTarget || undefined,
    partHoldBack: partHoldBack || undefined,
    canBlockReload,
    canSkipUntil: canSkipUntil || undefined,
    preloadHint: preloadHint || undefined,
  };
}

const ATTR_RE = /([A-Z0-9-]+)\s*=\s*(?:"([^"]*)"|([^",\s]*))/g;

function parseAttributes(data: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(data)) !== null) {
    attrs[match[1]!] = match[2] || match[3] || '';
  }
  return attrs;
}

function parseByteRange(range: string): [number, number] {
  if (!range) return [0, 0];
  const parts = range.split('@');
  const length = parseInt(parts[0] || '0');
  const start = parts[1] ? parseInt(parts[1]) : 0;
  return [start, start + length];
}

function resolveUrl(url: string, baseurl: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = baseurl.endsWith('/') ? baseurl : baseurl.substring(0, baseurl.lastIndexOf('/') + 1);
  return base + url;
}
