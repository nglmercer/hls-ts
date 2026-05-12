I'll provide a roadmap for building an HLS streaming library similar to HLS.js using Bun.

---

# Roadmap: Building an HLS Streaming Library with Bun

## Phase 1: Project Setup & Foundation

**Goal**: Set up the Bun project structure and basic tooling.

1. Initialize Bun project:
   ```bash
   bun init
   bun add typescript @types/node
   ```

2. Configure TypeScript with `tsconfig.json` similar to HLS.js's setup [1](#0-0) 

3. Set up project structure:
   ```
   src/
   ├── core/
   ├── controller/
   ├── loader/
   ├── parser/
   ├── remux/
   ├── utils/
   └── types/
   ```

4. Configure Bun build scripts in `package.json` [2](#0-1) 

## Phase 2: Core Architecture & Event System

**Goal**: Build the foundational event-driven architecture.

1. Create event system using EventEmitter pattern [3](#0-2) 

2. Implement core `Hls` class with:
   - Configuration management [4](#0-3) 
   - Event emitter integration
   - Component registration system

3. Define configuration interface similar to `HlsConfig` [5](#0-4) 

## Phase 3: Playlist Parsing

**Goal**: Implement M3U8 manifest parsing.

1. Create M3U8 parser for:
   - Master playlists (multivariant)
   - Media playlists (levels) [6](#0-5) 

2. Parse HLS tags:
   - `#EXT-X-VERSION`, `#EXT-X-TARGETDURATION` [7](#0-6) 
   - `#EXTINF`, `#EXT-X-BYTERANGE`
   - `#EXT-X-KEY` for encryption

3. Implement playlist loader using Bun's `fetch` API

## Phase 4: Fragment Loading

**Goal**: Build network layer for media segment downloading.

1. Create fragment loader with:
   - XHR/Fetch wrapper using Bun
   - Retry policies and timeout handling [8](#0-7) 

2. Implement load policy system:
   - `fragLoadPolicy`
   - `manifestLoadPolicy`
   - `playlistLoadPolicy` [9](#0-8) 

3. Add progress tracking and statistics

## Phase 5: Media Processing Pipeline

**Goal**: Implement demuxing and remuxing.

1. Create demuxers for:
   - MPEG-2 Transport Stream (TS)
   - Fragmented MP4 (fMP4) [10](#0-9) 

2. Implement remuxers to convert to MP4:
   - MP4 generator for video (AVC/HEVC) [11](#0-10) 
   - MP4 generator for audio (AAC/MP3) [12](#0-11) 

3. Add Web Worker support for async processing [13](#0-12) 

## Phase 6: Buffer Management

**Goal**: Implement MediaSource buffer handling.

1. Create BufferController to:
   - Initialize SourceBuffer with codecs [14](#0-13) 
   - Append MP4 boxes to buffer
   - Handle buffer flushing

2. Implement buffer configuration:
   - `maxBufferLength`
   - `backBufferLength`
   - `maxBufferSize` [15](#0-14) 

## Phase 7: Stream Controllers

**Goal**: Build playback management system.

1. Implement StreamController for:
   - Fragment sequencing
   - Buffer level monitoring
   - Playback coordination [16](#0-15) 

2. Create LevelController for:
   - Quality level management
   - Level switching logic

3. Add audio/subtitle track controllers [17](#0-16) 

## Phase 8: Adaptive Bitrate (ABR)

**Goal**: Implement quality selection algorithm.

1. Create AbrController with:
   - Bandwidth estimation using EWMA [18](#0-17) 
   - Buffer health monitoring
   - Quality level selection

2. Configure ABR parameters:
   - `abrEwmaFastLive`, `abrEwmaSlowLive`
   - `abrBandWidthFactor` [19](#0-18) 

## Phase 9: Error Handling & Recovery

**Goal**: Build robust error management.

1. Implement error types:
   - Network errors
   - Media errors
   - MUX errors [20](#0-19) 

2. Add recovery mechanisms:
   - Automatic retry with backoff
   - Media error recovery
   - Codec fallback

## Phase 10: Browser Integration

**Goal**: Create HTML5 video element integration.

1. Implement `attachMedia()` method [21](#0-20) 

2. Add MSE support detection:
   - `isSupported()` check
   - `isMSESupported()` check [22](#0-21) 

3. Create basic usage example:
   ```javascript
   const hls = new Hls(config);
   hls.loadSource(url);
   hls.attachMedia(videoElement);
   ```

## Phase 11: Testing & Optimization

**Goal**: Ensure reliability and performance.

1. Set up test framework:
   - Unit tests for controllers
   - Integration tests for pipeline
   - Use Bun's test runner

2. Add performance optimizations:
   - Enable Web Workers by default [23](#0-22) 
   - Implement progressive loading
   - Add low-latency mode support

3. Create demo page for testing [24](#0-23) 

## Phase 12: Documentation & Build

**Goal**: Prepare for distribution.

1. Generate TypeScript type definitions
2. Create API documentation
3. Configure Bun build for distribution
4. Add feature flags for build variants (light/full) [25](#0-24) 

---

## Notes

This roadmap is based on the HLS.js architecture which uses a modular, event-driven design with controllers, loaders, and processors [26](#0-25) . The main differences when using Bun would be:

- Use Bun's native `fetch` instead of XHR loaders
- Use Bun's test runner instead of Karma
- Use Bun's build system instead of Rollup
- Leverage Bun's faster TypeScript processing

The core architecture (controllers, event system, media pipeline) remains conceptually similar. HLS.js supports VOD & Live playlists, multiple codecs (H.264, H.265, AAC, MP3), AES-128 decryption, and DRM through EME [27](#0-26)  - you may want to prioritize features based on your requirements.

Wiki pages you might want to explore:
- [HLS.js Overview (video-dev/hls.js)](/wiki/video-dev/hls.js#1)
- [Library Configuration (video-dev/hls.js)](/wiki/video-dev/hls.js#1.1)

### Citations

**File:** package.json (L17-28)
```json
  "exports": {
    ".": {
      "import": "./dist/hls.mjs",
      "require": "./dist/hls.js"
    },
    "./light": {
      "import": "./dist/hls.light.mjs",
      "require": "./dist/hls.light.js"
    },
    "./dist/*": "./dist/*",
    "./package.json": "./package.json"
  },
```

**File:** package.json (L36-45)
```json
  "scripts": {
    "build": "rollup --config && npm run build:types",
    "build:ci": "rollup --config && tsc --build tsconfig-lib.json && api-extractor run && npm run build:copy-types && es-check",
    "build:debug": "rollup --config --configType full --configType demo",
    "build:watch": "rollup --config --configType full --configType demo --watch",
    "build:types": "tsc --build tsconfig-lib.json && api-extractor run --local && npm run build:copy-types",
    "build:copy-types": "cp ./dist/hls.d.ts ./dist/hls.d.mts && cp ./dist/hls.d.ts ./dist/hls.js.d.ts",
    "dev": "run-p build:watch serve",
    "serve": "http-server -o /demo .",
    "docs": "doctoc ./docs/API.md && api-documenter markdown -i api-extractor -o api-extractor/api-documenter && rm api-extractor/api-documenter/index.md && npm run docs-md-to-html",
```

**File:** src/hls.ts (L69-111)
```typescript
export default class Hls implements HlsEventEmitter {
  private static defaultConfig: HlsConfig | undefined;

  /**
   * The runtime configuration used by the player. At instantiation this is combination of `hls.userConfig` merged over `Hls.DefaultConfig`.
   */
  public readonly config: HlsConfig;

  /**
   * The configuration object provided on player instantiation.
   */
  public readonly userConfig: Partial<HlsConfig>;

  /**
   * The logger functions used by this player instance, configured on player instantiation.
   */
  public readonly logger: ILogger;

  private coreComponents: ComponentAPI[];
  private networkControllers: NetworkComponentAPI[];
  private _emitter: HlsEventEmitter = new EventEmitter();
  private _autoLevelCapping: number = -1;
  private _maxHdcpLevel: HdcpLevel = null;
  private abrController: AbrComponentAPI;
  private bufferController: BufferController;
  private capLevelController: CapLevelController;
  private latencyController: LatencyController;
  private levelController: LevelController;
  private streamController: StreamController;
  private audioStreamController?: AudioStreamController;
  private subtititleStreamController?: SubtitleStreamController;
  private audioTrackController?: AudioTrackController;
  private subtitleTrackController?: SubtitleTrackController;
  private interstitialsController?: InterstitialsController;
  private gapController: GapController;
  private emeController?: EMEController;
  private cmcdController?: CMCDController;
  private _media: HTMLMediaElement | null = null;
  private _url: string | null = null;
  private _sessionId?: string;
  private triggeringException?: boolean;
  private started: boolean = false;

```

**File:** src/hls.ts (L119-131)
```typescript
  /**
   * Check if the required MediaSource Extensions are available.
   */
  static isMSESupported(): boolean {
    return isMSESupported();
  }

  /**
   * Check if MediaSource Extensions are available and isTypeSupported checks pass for any baseline codecs.
   */
  static isSupported(): boolean {
    return isSupported();
  }
```

**File:** src/hls.ts (L233-237)
```typescript
    const streamController = (this.streamController = new StreamController(
      this,
      fragmentTracker,
      keyLoader,
    ));
```

**File:** docs/design.md (L12-21)
```markdown
## Design principle

design idea is pretty simple :

- main functionalities are split into several subsystems
- all subsystems are instantiated by the Hls instance.
- each subsystem heavily relies on events for internal/external communications.
- Events are handled using [EventEmitter3](https://github.com/primus/eventemitter3)
- bundled for the browser by [rollup](https://rollupjs.org/)

```

**File:** docs/design.md (L28-29)
```markdown
- [src/events.ts][]
  - definition of Hls.Events
```

**File:** docs/design.md (L32-38)
```markdown
- [src/controller/abr-controller.ts][]
  - in charge of determining auto quality level.
  - auto quality switch algorithm is bitrate based : fragment loading bitrate is monitored and smoothed using 2 exponential weighted moving average (a fast one, to adapt quickly on bandwidth drop and a slow one, to avoid ramping up too quickly on bandwidth increase)
  - in charge of **monitoring fragment loading speed** (by monitoring the amount of data received from fragment loader `stats.loaded` counter)
  - "expected time of fragment load completion" is computed using "fragment loading instant bandwidth".
  - this time is compared to the "expected time of buffer starvation".
  - if we have less than 2 fragments buffered and if "expected time of fragment load completion" is bigger than "expected time of buffer starvation" and also bigger than duration needed to load fragment at next quality level (determined by auto quality switch algorithm), current fragment loading is aborted, and a FRAG_LOAD_EMERGENCY_ABORTED event is triggered. this event will be handled by stream-controller.
```

**File:** docs/design.md (L49-51)
```markdown
    - once FRAG_PARSED is received and all segments have been appended (BUFFER_APPENDED) then audio stream controller will recheck whether it needs to buffer more data.
- [src/controller/audio-track-controller.ts][]
  - audio track controller is handling alternate audio track set/get ((re)loading tracks/switching)
```

**File:** docs/design.md (L52-59)
```markdown
- [src/controller/buffer-controller.ts][]
  - in charge of:
    - resetting media buffer upon BUFFER_RESET event reception
    - initializing [SourceBuffer](http://www.w3.org/TR/media-source/#sourcebuffer) with appropriate codecs info upon BUFFER_CODECS event reception
    - appending MP4 boxes in [SourceBuffer](http://www.w3.org/TR/media-source/#sourcebuffer) upon BUFFER_APPENDING
    - trigger BUFFER_APPENDED event upon successful buffer appending
    - flushing specified buffer range upon reception of BUFFER_FLUSHING event
    - trigger BUFFER_FLUSHED event upon successful buffer flushing
```

**File:** README.md (L14-16)
```markdown
It works by transmuxing MPEG-2 Transport Stream and AAC/MP3 streams into ISO BMFF (MP4) fragments.
Transmuxing is performed asynchronously using a [Web Worker] when available in the browser.
HLS.js also supports HLS + fmp4, as announced during [WWDC2016](https://developer.apple.com/videos/play/wwdc2016/504/).
```

**File:** README.md (L33-60)
```markdown
## Features

- VOD & Live playlists
  - DVR support on Live playlists
- Fragmented MP4 container
- MPEG-2 TS container
  - ITU-T Rec. H.264 and ISO/IEC 14496-10 Elementary Stream
  - ITU-T Rec. H.265 and ISO/IEC 23008-2 Elementary Stream
  - ISO/IEC 13818-7 ADTS AAC Elementary Stream
  - ISO/IEC 11172-3 / ISO/IEC 13818-3 (MPEG-1/2 Audio Layer III) Elementary Stream
  - ATSC A/52 / AC-3 / Dolby Digital Elementary Stream
  - Packetized metadata (ID3v2.3.0) Elementary Stream
- AAC container (audio only streams)
- MPEG Audio container (MPEG-1/2 Audio Layer III audio only streams)
- Timed Metadata for HTTP Live Streaming (ID3 format carried in MPEG-2 TS, Emsg in CMAF/Fragmented MP4, and DATERANGE playlist tags)
- AES-128 decryption
- "identity" format SAMPLE-AES decryption of MPEG-2 TS segments only
- Encrypted media extensions (EME) support for DRM (digital rights management)
  - FairPlay, PlayReady, Widevine CDMs with fmp4 segments
- Level capping based on HTMLMediaElement resolution, dropped-frames, and HDCP-Level
- CEA-608/708 captions
- WebVTT subtitles
- Alternate Audio Track Rendition (Master Playlist with Alternative Audio) for VoD and Live playlists
- Adaptive streaming
  - Manual & Auto Quality Switching
    - 3 Quality Switching modes are available (controllable through API means)
      - Instant switching (immediate quality switch at current video position)
      - Smooth switching (quality switch for next loaded fragment)
```

**File:** README.md (L91-114)
```markdown
- `#EXTM3U` (ignored)
- `#EXT-X-INDEPENDENT-SEGMENTS` (ignored)
- `#EXT-X-VERSION=<n>` (value is ignored)
- `#EXTINF:<duration>,[<title>]`
- `#EXT-X-ENDLIST`
- `#EXT-X-MEDIA-SEQUENCE=<n>`
- `#EXT-X-TARGETDURATION=<n>`
- `#EXT-X-DISCONTINUITY`
- `#EXT-X-DISCONTINUITY-SEQUENCE=<n>`
- `#EXT-X-BITRATE`
- `#EXT-X-BYTERANGE=<n>[@<o>]`
- `#EXT-X-MAP:<attribute-list>`
- `#EXT-X-KEY:<attribute-list>` (`KEYFORMAT="identity",METHOD=SAMPLE-AES` is only supports with MPEG-2 TS segments)
- `#EXT-X-PROGRAM-DATE-TIME:<attribute-list>`
- `#EXT-X-START:TIME-OFFSET=<n>`
- `#EXT-X-SERVER-CONTROL:<attribute-list>`
- `#EXT-X-PART-INF:PART-TARGET=<n>`
- `#EXT-X-PART:<attribute-list>`
- `#EXT-X-SKIP:<attribute-list>` Delta Playlists
- `#EXT-X-RENDITION-REPORT:<attribute-list>`
- `#EXT-X-DATERANGE:<attribute-list>` Metadata
  - HLS EXT-X-DATERANGE Schema for Interstitials
- `#EXT-X-DEFINE:<attribute-list>` Variable Import and Substitution (`NAME,VALUE,IMPORT,QUERYPARAM` attributes)
- `#EXT-X-GAP` (Skips loading GAP segments and parts. Skips playback of unbuffered program containing only GAP content and no suitable alternates. See [#2940](https://github.com/video-dev/hls.js/issues/2940))
```

**File:** README.md (L272-280)
```markdown
## Demo

### Latest Release

[https://hlsjs.video-dev.org/demo](https://hlsjs.video-dev.org/demo)

### Master

[https://hlsjs-dev.video-dev.org/demo](https://hlsjs-dev.video-dev.org/demo)
```

**File:** docs/API.md (L242-272)
```markdown
### Second step: instantiate Hls object and bind it to `<video>` element

Let's

- create a `<video>` element
- create a new HLS object
- bind video element to this HLS object

```html
<script src="https://cdn.jsdelivr.net/npm/hls.js@1"></script>

<video id="video"></video>
<script>
  if (Hls.isSupported()) {
    var video = document.getElementById('video');

    // If you are using the ESM version of the library (hls.mjs), you
    // should specify the "workerPath" config option here if you want
    // web workers to be used. Note that bundlers (such as webpack)
    // will likely use the ESM version by default.
    var hls = new Hls();

    // bind them together
    hls.attachMedia(video);
    // MEDIA_ATTACHED event is fired by hls object once MediaSource is ready
    hls.on(Hls.Events.MEDIA_ATTACHED, function () {
      console.log('video and hls.js are now bound together !');
    });
  }
</script>
```
```

**File:** docs/API.md (L317-328)
```markdown
- Error Types:
  - `Hls.ErrorTypes.NETWORK_ERROR` for network related errors
  - `Hls.ErrorTypes.MEDIA_ERROR` for media/video related errors
  - `Hls.ErrorTypes.KEY_SYSTEM_ERROR` for EME related errors
  - `Hls.ErrorTypes.MUX_ERROR` for demuxing/remuxing related errors
  - `Hls.ErrorTypes.OTHER_ERROR` for all other errors
- Error Details:
  - refer to [Errors details](#Errors)
- Error is `fatal`:
  - `false` if error is not fatal, HLS.js will try to recover.
  - `true` if error is fatal, all attempts to recover have been performed. See [LoadPolicies](#fragloadpolicy--keyloadpolicy--certloadpolicy--playlistloadpolicy--manifestloadpolicy--steeringmanifestloadpolicy--interstitialAssetListLoadPolicy) details on how to configure retries.

```

**File:** docs/API.md (L423-439)
```markdown
  fragLoadPolicy: {
    default: {
      maxTimeToFirstByteMs: 9000,
      maxLoadTimeMs: 100000,
      timeoutRetry: {
        maxNumRetry: 2,
        retryDelayMs: 0,
        maxRetryDelayMs: 0,
      },
      errorRetry: {
        maxNumRetry: 5,
        retryDelayMs: 3000,
        maxRetryDelayMs: 15000,
        backoff: 'linear',
      },
    },
  },
```

**File:** src/remux/mp4-generator.ts (L597-662)
```typescript
  static avc1(track: DemuxedAVC1) {
    let sps: number[] = [];
    let pps: number[] = [];
    let i;
    let data;
    let len;
    // assemble the SPSs

    for (i = 0; i < track.sps.length; i++) {
      data = track.sps[i];
      len = data.byteLength;
      sps.push((len >>> 8) & 0xff);
      sps.push(len & 0xff);

      // SPS
      sps = sps.concat(Array.prototype.slice.call(data));
    }

    // assemble the PPSs
    for (i = 0; i < track.pps.length; i++) {
      data = track.pps[i];
      len = data.byteLength;
      pps.push((len >>> 8) & 0xff);
      pps.push(len & 0xff);

      pps = pps.concat(Array.prototype.slice.call(data));
    }

    const avcc = MP4.box(
      MP4.types.avcC,
      new Uint8Array(
        [
          0x01, // version
          sps[3], // profile
          sps[4], // profile compat
          sps[5], // level
          0xfc | 3, // lengthSizeMinusOne, hard-coded to 4 bytes
          0xe0 | track.sps.length, // 3bit reserved (111) + numOfSequenceParameterSets
        ]
          .concat(sps)
          .concat([
            track.pps.length, // numOfPictureParameterSets
          ])
          .concat(pps),
      ),
    ); // "PPS"
    const width = track.width;
    const height = track.height;
    const hSpacing = track.pixelRatio[0];
    const vSpacing = track.pixelRatio[1];

    return MP4.box(
      MP4.types.avc1,













```

**File:** src/remux/mp4-generator.ts (L839-857)
```typescript
  static mp4a(track: DemuxedAudioTrack) {
    return MP4.box(
      MP4.types.mp4a,
      MP4.audioStsd(track),
      MP4.box(MP4.types.esds, MP4.esds(track)),
    );
  }

  static mp3(track: DemuxedAudioTrack) {
    return MP4.box(MP4.types['.mp3'], MP4.audioStsd(track));
  }

  static ac3(track: DemuxedAudioTrack) {
    return MP4.box(
      MP4.types['ac-3'],
      MP4.audioStsd(track),
      MP4.box(MP4.types.dac3, track.config as Uint8Array),
    );
  }
```
