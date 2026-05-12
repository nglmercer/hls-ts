# HLS.ts vs HLS.js Comparative Report

## Summary

| Area | Status | Critical Gaps |
|------|--------|---------------|
| **Seek** | BROKEN | No seek handler, no fragment relocation, no buffer flush on seek |
| **Live streaming** | BROKEN | No playlist refresh interval, no live edge logic, no sliding window |
| **Buffer Management** | Partial | Single SourceBuffer for all tracks; needs audio/video split |
| **Playlist Parsing** | Partial | Missing #EXT-X-KEY (AES-128), all LL-HLS tags |
| **API Surface** | Partial | Missing startLoad/stopLoad, currentLevel, audioTrack |
| **Fragment Loading** | Buggy | No Range header for byte-range fMP4 segments |
| **Error Recovery** | Partial | Wrong URL reloaded, stale recovery state |
| **Codec Support** | Good | H.264/HEVC + AAC/MP3; missing AC-3 demuxer, Opus |

---

## 1. SEEK — BROKEN

StreamController has zero seek-related code. No `seeking`/`seeked` listeners.
Fragment queue continues from current position — seeks to minute 5 still load from minute 0.

### Missing
- No handler for media `seeking` / `seeked` events
- `_fragQueue` never flushed on seek
- No `findFragmentByPTS()` binary search to locate target fragment
- No `BUFFER_FLUSHING` emitted — abandoned time ranges stay in SourceBuffer
- No `_seeking` flag — loading continues during seek
- No keyframe/IDR-based seeking

### Required Changes

**`src/controller/stream-controller.ts`** — Add:
```typescript
_onSeeking = (): void => {
  this._seeking = true;
  this._fragQueue = [];
  this._fragmentLoader.abort();
  this._transmuxer.reset();
  // Flush old buffer range
  const targetTime = this._media?.currentTime ?? 0;
  this.hls.trigger(Events.BUFFER_FLUSHING, { startOffset: 0, endOffset: Math.max(0, targetTime - 1) });
};

_onSeeked = (): void => {
  if (!this._media) return;
  const targetTime = this._media.currentTime;
  const level = this._levelController.currentLevel;
  if (!level?.details) return;
  
  const frag = this._findFragmentByPTS(targetTime, level.details.fragments);
  if (frag) {
    this._fragQueue = [frag];
    this._baseDts = Math.round(frag.start * 90000);
  }
  this._seeking = false;
  this._loadNextFragment();
};

_findFragmentByPTS(time: number, fragments: Fragment[]): Fragment | null {
  if (fragments.length === 0) return null;
  let lo = 0, hi = fragments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const f = fragments[mid];
    if (time < f.start) hi = mid - 1;
    else if (time > f.start + f.duration) lo = mid + 1;
    else return f;
  }
  return fragments[Math.min(lo, fragments.length - 1)] ?? null;
}
```

**`src/core/Hls.ts`** — Wire events:
```typescript
this._media.addEventListener('seeking', () => this.trigger(Events.MEDIA_SEEKING));
this._media.addEventListener('seeked', () => this.trigger(Events.MEDIA_SEEKED));
this.on(Events.MEDIA_SEEKING, sc._onSeeking);
this.on(Events.MEDIA_SEEKED, sc._onSeeked);
```

---

## 2. LIVE STREAMING — BROKEN

Playlists loaded once by `LevelController._loadLevel()`, never refreshed.
Player consumes the snapshot, then stalls forever.

### Missing
- No playlist refresh interval (`setInterval` at `targetDuration / 2`)
- No sliding window update (add new fragments, remove old)
- No live edge detection (starts from fragment 0, not near `endSN`)
- No `liveSyncPosition` calculation
- No `nudgeOffset` for time synchronization
- `LevelDetails.availabilityDelay` hardcoded to 0

### Required Changes

**`src/controller/level-controller.ts`**:
```typescript
private _livePollInterval: any = null;

_startLivePolling(targetDuration: number): void {
  const interval = Math.max(targetDuration / 2, 500);
  this._livePollInterval = setInterval(() => {
    if (this._currentLevel) this._loadLevel(this._currentLevel);
  }, interval);
}

_onLevelLoaded = (data) => {
  // ... existing fragment building ...
  // Merge new fragments, remove old ones outside liveBackBufferLength
  // Detect ENDLIST → VOD transition: clearInterval(this._livePollInterval)
};
```

**`src/types/config.ts`** — Add `liveSyncDurationCount: 3`, `liveBackBufferLength: 30`

---

## 3. BUFFER MANAGEMENT

**Required**:
- Split into `_sourceBufferVideo` + `_sourceBufferAudio` with separate queues
- Add `timestampOffset` management for discontinuity/seek
- Add `appendWindowStart`/`appendWindowEnd` for seek/live

---

## 4. FRAGMENT LOADING — BUG

FragmentLoader never sends `Range` headers. Broken for fMP4 byte-range segments.

**Fix** in `_doLoad()`:
```typescript
if (frag.byteRangeEnd > 0) {
  context.headers = { 'Range': `bytes=${frag.byteRangeStart}-${frag.byteRangeEnd - 1}` };
}
```

---

## 5. PLAYLIST PARSING — MISSING TAGS

| Priority | Tag | 
|----------|-----|
| CRITICAL | `#EXT-X-KEY` — AES-128: METHOD, URI, IV, KEYFORMAT |
| HIGH | `#EXT-X-START`, `#EXT-X-SKIP`, `#EXT-X-PART`, `#EXT-X-PRELOAD-HINT`, `#EXT-X-SERVER-CONTROL` |
| MEDIUM | `#EXT-X-DATERANGE`, `#EXT-X-GAP`, `#EXT-X-INDEPENDENT-SEGMENTS` |

Bug: `#EXT-X-DISCONTINUITY` before first `#EXTINF` is lost when `tagList = []` resets.

---

## 6. API SURFACE — MISSING

**`src/core/Hls.ts`**: `startLoad()`, `stopLoad()`, `recoverMediaError()`, `get/set currentLevel`, `get/set nextLevel`, `get/set audioTrack`, `get bandwidthEstimate`, `get liveSyncPosition`

**`src/types/config.ts`**: `startPosition`, `autoStartLoad`, `liveSyncDurationCount`

---

## 7. ERROR RECOVERY BUGS

1. Network error reloads master manifest URL instead of fragment URL
2. `_recoveryStates` Map grows unbounded (never cleared)
3. `_mediaSwapCount` never reset — recovery permanently dead after 3 swaps
4. Missing `KEY_SYSTEM_ERROR` case in switch statement

---

## Implementation Priority

1. **Seek** — Blocks basic VOD navigation
2. **Fragment byte-range loading** — Blocks fMP4 streams
3. **API surface** — startLoad/stopLoad, currentLevel, audioTrack
4. **Error recovery bugs** — Wrong URL, stale state
5. **Live streaming** — Refresh, live edge
6. **Buffer split** — Separate audio/video
7. **Playlist tags** — #EXT-X-KEY, LL-HLS

---

## Deferred

AES-128 decryption, LL-HLS full support, AC-3 demuxer, Opus, CEA-608 wiring, ID3 wiring, audio track switching, subtitle/VTT, HE-AAC SBR, FRAG_LOAD_PROGRESS, SCTE-35
