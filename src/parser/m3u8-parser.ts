import type { LevelParsed, MediaPlaylist } from '../types/level';

interface ParseResult {
  levels: LevelParsed[];
  audioTracks: MediaPlaylist[];
  subtitleTracks: MediaPlaylist[];
}

interface PlaylistParseResult {
  fragments: Array<{
    sn: number;
    duration: number;
    start: number;
    url: string;
    byteRangeStart: number;
    byteRangeEnd: number;
    programDateTime: number;
    tagList: string[][];
  }>;
  targetDuration: number;
  version: number;
  startSN: number;
  endSN: number;
  live: boolean;
  type: string;
  initSegment: { url: string; byteRangeStart: number; byteRangeEnd: number } | null;
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
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributes(line.substring('#EXT-X-STREAM-INF:'.length));
      currentBandwidth = parseInt(attrs['BANDWIDTH'] || attrs['AVERAGE-BANDWIDTH'] || '0');
      currentResolution = attrs['RESOLUTION'] || '';
      currentCodecs = attrs['CODECS'] || '';
      currentVideoRange = attrs['VIDEO-RANGE'] || '';
      currentFrameRate = parseFloat(attrs['FRAME-RATE'] || '0');
      currentName = attrs['NAME'] || '';
    } else if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributes(line.substring('#EXT-X-MEDIA:'.length));
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
      if (type === 'AUDIO') {
        audioTracks.push(playlist);
      } else if (type === 'SUBTITLES') {
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
  const lines = data.split('\n');
  let targetDuration = 0;
  let version = 1;
  let startSN = 0;
  let endSN = 0;
  let live = true;
  let type = 'VOD';
  let currentDuration = 0;
  let currentTitle = '';
  let currentByteRange = '';
  let currentProgramDateTime = 0;
  let initSegment: PlaylistParseResult['initSegment'] = null;
  let isEndlist = false;
  let tagList: string[][] = [];
  let sn = 0;
  let startTime = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = parseInt(line.substring('#EXT-X-TARGETDURATION:'.length));
    } else if (line.startsWith('#EXT-X-VERSION:')) {
      version = parseInt(line.substring('#EXT-X-VERSION:'.length));
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      startSN = parseInt(line.substring('#EXT-X-MEDIA-SEQUENCE:'.length));
      sn = startSN;
    } else if (line === '#EXT-X-ENDLIST') {
      isEndlist = true;
    } else if (line === '#EXT-X-DISCONTINUITY') {
      tagList.push(['EXT-X-DISCONTINUITY']);
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line.substring('#EXT-X-KEY:'.length));
      tagList.push(['EXT-X-KEY', attrs['METHOD'] || '', attrs['URI'] || '', attrs['IV'] || '', attrs['KEYFORMAT'] || '']);
    } else if (line.startsWith('#EXT-X-PLAYLIST-TYPE:')) {
      type = line.substring('#EXT-X-PLAYLIST-TYPE:'.length);
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line.substring('#EXT-X-MAP:'.length));
      const uri = resolveUrl(attrs['URI'] || '', baseurl);
      const byteRange = attrs['BYTERANGE'] || '';
      const [rangeStart, rangeEnd] = parseByteRange(byteRange);
      initSegment = { url: uri, byteRangeStart: rangeStart, byteRangeEnd: rangeEnd };
    } else if (line.startsWith('#EXTINF:')) {
      const infData = line.substring('#EXTINF:'.length);
      const commaIdx = infData.indexOf(',');
      currentDuration = parseFloat(infData.substring(0, commaIdx !== -1 ? commaIdx : infData.length));
      currentTitle = commaIdx !== -1 ? infData.substring(commaIdx + 1) : '';
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      currentByteRange = line.substring('#EXT-X-BYTERANGE:'.length);
    } else if (line.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) {
      currentProgramDateTime = new Date(line.substring('#EXT-X-PROGRAM-DATE-TIME:'.length)).getTime();
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
      });
      startTime += currentDuration;
      sn++;
      currentDuration = 0;
      currentTitle = '';
      currentByteRange = '';
      currentProgramDateTime = 0;
      tagList = [];
    }
  }

  endSN = sn - 1;
  live = !isEndlist;

  return { fragments, targetDuration, version, startSN, endSN, live, type, initSegment };
}

function parseAttributes(data: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Z0-9-]+)\s*=\s*(?:"([^"]*)"|([^",\s]*))/g;
  let match;
  while ((match = re.exec(data)) !== null) {
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
