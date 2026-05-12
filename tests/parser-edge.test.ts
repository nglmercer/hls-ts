import { describe, it, expect } from 'bun:test';
import { parseMasterPlaylist, parseMediaPlaylist } from '../src/parser/m3u8-parser';

describe('M3U8 Parser - edge cases', () => {
  it('should parse SUBTITLES media type', () => {
    const playlist = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",URI="subs.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000
video.m3u8`;
    const result = parseMasterPlaylist(playlist, 'http://example.com/');
    expect(result.subtitleTracks.length).toBe(1);
    expect(result.subtitleTracks[0].language).toBe('en');
  });

  it('should parse DISCONTINUITY tag', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-DISCONTINUITY
#EXTINF:10.000,
seg1.ts
#EXTINF:10.000,
seg2.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.fragments[0].tagList).toContainEqual(['EXT-X-DISCONTINUITY']);
  });

  it('should parse PLAYLIST-TYPE tag', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:10.000,
seg1.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.type).toBe('VOD');
  });

  it('should parse EXT-X-MAP init segment', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXT-X-MAP:URI="init.mp4",BYTERANGE="1000@0"
#EXTINF:10.000,
seg1.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.initSegment).toBeDefined();
    expect(result.initSegment!.url).toBe('http://example.com/init.mp4');
    expect(result.initSegment!.byteRangeStart).toBe(0);
    expect(result.initSegment!.byteRangeEnd).toBe(1000);
  });

  it('should parse EXT-X-BYTERANGE', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
#EXT-X-BYTERANGE:500@100
seg1.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.fragments[0].byteRangeStart).toBe(100);
    expect(result.fragments[0].byteRangeEnd).toBe(600);
  });

  it('should parse EXT-X-BYTERANGE without offset', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
#EXT-X-BYTERANGE:500
seg1.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.fragments[0].byteRangeStart).toBe(0);
    expect(result.fragments[0].byteRangeEnd).toBe(500);
  });

  it('should parse EXT-X-PROGRAM-DATE-TIME', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
#EXT-X-PROGRAM-DATE-TIME:2024-01-15T12:00:00Z
seg1.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.fragments[0].programDateTime).toBeGreaterThan(0);
  });

  it('should parse EXTINF with comma title', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,My Title
seg1.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/');
    expect(result.fragments[0].duration).toBe(10);
  });

  it('should handle relative URLs with subdirectory base', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
../segments/video.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/video/playlist.m3u8');
    expect(result.fragments[0].url).toBe('http://example.com/video/../segments/video.ts');
  });

  it('should handle absolute URLs', () => {
    const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10
#EXTINF:10.000,
http://cdn.example.com/seg.ts
#EXT-X-ENDLIST`;
    const result = parseMediaPlaylist(playlist, 'http://example.com/play.m3u8');
    expect(result.fragments[0].url).toBe('http://cdn.example.com/seg.ts');
  });

  it('should parse FRAME-RATE attribute', () => {
    const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1000000,FRAME-RATE=30.0,RESOLUTION=1280x720
video.m3u8`;
    const result = parseMasterPlaylist(playlist, 'http://example.com/');
    expect(result.levels[0].frameRate).toBe(30);
  });

  it('should parse AVERAGE-BANDWIDTH', () => {
    const playlist = `#EXTM3U
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1500000,RESOLUTION=640x480
video.m3u8`;
    const result = parseMasterPlaylist(playlist, 'http://example.com/');
    expect(result.levels[0].bitrate).toBe(1500000);
  });

  it('should parse NAME attribute', () => {
    const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=500000,NAME="720p"
video.m3u8`;
    const result = parseMasterPlaylist(playlist, 'http://example.com/');
    expect(result.levels[0].name).toBe('720p');
  });

  it('should parse VIDEO-RANGE attribute', () => {
    const playlist = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000,VIDEO-RANGE=PQ,RESOLUTION=1920x1080
hdr.m3u8`;
    const result = parseMasterPlaylist(playlist, 'http://example.com/');
    expect(result.levels[0].width).toBe(1920);
    expect(result.levels[0].height).toBe(1080);
  });
});
