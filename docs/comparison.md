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
| **Ad-Metadata (SCTE)** | ❌ Not Supported | ✅ Full Support |

## Key Differences

### 1. Type Safety & DX
`hls-ts` was built from the ground up in TypeScript. This results in a cleaner API surface and better developer experience for modern web applications. `hls.js`, while now using TypeScript, still carries significant legacy code and complex internal states.

### 2. Lightweight Focus
`hls-ts` is focused on the core HLS experience: playing video and audio reliably with ABR. By omitting complex features like DRM, multi-audio, and complex subtitle formats, it maintains a much smaller footprint.

### 3. Modern Browser Support
`hls-ts` targets modern browsers with robust MSE implementations. Unlike `hls.js`, it doesn't include the extensive list of "quirk fixes" for older browser versions or specific edge cases found in legacy MSE implementations.

## Missing Features in `hls-ts`

If your project requires any of the following, you should stick with `hls.js` for now:

- **Alternative Audio Tracks**: Switching between different language tracks or audio descriptions.
- **WebVTT Subtitles**: Support for external or side-loaded text tracks.
- **Digital Rights Management (DRM)**: Playing protected content via Widevine, PlayReady, or FairPlay.
- **Low-Latency HLS (LL-HLS)**: Ultra-low delay streaming (requires specialized server support).
- **Complex Metadata**: Parsing SCTE-35 ad markers or EMSG events for interactive features.
- **Advanced Stall Recovery**: `hls.js` has more aggressive strategies for handling complex buffer gaps and browser-specific stalls.

## When to use `hls-ts`?
- You need a lightweight player for standard HLS/fMP4 streams.
- You prioritize a small bundle size and a modern TypeScript codebase.
- You don't need complex features like DRM or Multi-audio.
- You are building a high-performance application where every kilobyte counts.
