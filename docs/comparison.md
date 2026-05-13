# hls-ts vs hls.js

This document provides a comparison between `hls-ts` and the industry-standard `hls.js`. While `hls-ts` is designed to be a lightweight, modern, and type-safe alternative, it does not yet aim for full feature parity with `hls.js`.

## Comparison Table

| Feature | `hls-ts` | `hls.js` |
| :--- | :--- | :--- |
| **Core Language** | Native TypeScript | Migrated TypeScript (Legacy JS roots) |
| **Bundle Size** | **Extremely Lightweight** | Large (due to features & legacy support) |
| **Architecture** | Modern Controller-based | Complex Controller-based |
| **MPEG-TS Support** | ✅ (Remuxed to fMP4) | ✅ (Remuxed to fMP4) |
| **fMP4 Support** | ✅ (Passthrough) | ✅ (Passthrough) |
| **HEVC (H.265)** | ✅ Supported | ✅ Supported |
| **Adaptive Bitrate** | ✅ EWMA Based | ✅ Advanced Throughput Estimation |
| **Web Workers** | ✅ Native Support | ✅ Native Support |
| **Multi-Audio** | ✅ Supported | ✅ Full Support |
| **Subtitles** | ✅ WebVTT & CEA-608 | ✅ WebVTT, CEA-608/708, IMSC1 |
| **DRM (Widevine/etc)** | ❌ Not Supported | ✅ Full EME Support |
| **LL-HLS** | ❌ Not Supported | ✅ Full Support |
| **Ad-Metadata (SCTE)** | ⚠️ (Parsing only) | ✅ Full Support |

## Key Differences

### 1. Type Safety & DX
`hls-ts` was built from the ground up in TypeScript. This results in a cleaner API surface and better developer experience for modern web applications. `hls.js`, while now using TypeScript, still carries significant legacy code and complex internal states.

### 2. Lightweight Focus
`hls-ts` is focused on the core HLS experience: playing video and audio reliably with ABR. By omitting complex features like DRM, multi-audio, and complex subtitle formats, it maintains a much smaller footprint.

### 3. Modern Browser Support
`hls-ts` targets modern browsers with robust MSE implementations. Unlike `hls.js`, it doesn't include the extensive list of "quirk fixes" for older browser versions or specific edge cases found in legacy MSE implementations.

## Advanced Features Breakdown

### 1. Digital Rights Management (DRM)
DRM is used to protect premium content from unauthorized copying. In the browser, this is handled via **Encrypted Media Extensions (EME)**.
- **Widevine**: Used by Chrome, Firefox, and Android.
- **FairPlay**: Apple's proprietary DRM for Safari and iOS.
- **PlayReady**: Microsoft's DRM used in Edge and Windows.
`hls.js` provides a complex `EMEController` to manage license requests, key rotation, and CDM (Content Decryption Module) communication. `hls-ts` currently does not support encrypted streams.

### 2. Low-Latency HLS (LL-HLS)
Standard HLS has a latency of 10-30 seconds. LL-HLS reduces this to **less than 3 seconds** by using:
- **Partial Segments**: Breaking standard segments into tiny chunks (L-segments).
- **Preload Hints**: Telling the player where the next data will be before it's ready.
- **Blocking Requests**: The server holds the request until the data is available.
Implementing LL-HLS requires a complete overhaul of the loading and buffering logic to handle rapid updates and "hungry" buffer management.

### 3. Ad Metadata (SCTE-35 & EMSG)
For professional broadcasting, metadata is used to signal ad breaks and interactive events.
- **SCTE-35**: Industry standard for signaling ad insertion points in the manifest (via `EXT-X-DATERANGE` or `EXT-X-CUE-OUT`).
- **EMSG**: In-band metadata timed to specific video frames in fMP4 streams.
These are critical for **Server-Side Ad Insertion (SSAI)** where the player needs to report when an ad started or hide the "seek" bar during commercials.

## Remaining Missing Features in `hls-ts`

If your project requires any of the following, you should stick with `hls.js` for now:

- **Digital Rights Management (DRM)**: Playing protected content.
- **Low-Latency HLS (LL-HLS)**: Ultra-low delay streaming.
- **Complex Metadata**: Parsing SCTE-35 ad markers or EMSG events.
- **Advanced Stall Recovery**: `hls.js` has more aggressive strategies for handling complex buffer gaps and legacy browser stalls.

## When to use `hls-ts`?
- You need a lightweight player for standard HLS/fMP4/TS streams.
- You prioritize a small bundle size and a modern, type-safe codebase.
- You want native support for Multi-audio and Subtitles without the bulk of `hls.js`.
- You are building a high-performance application targeting modern browsers.
