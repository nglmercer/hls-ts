# Architecture

`hls-ts` is designed with a modular architecture where different responsibilities are offloaded to specialized controllers.

## Core Components

The `Hls` class acts as the central hub, coordinating the following controllers:

### 🎮 Controllers

- **`StreamController`**: The brain of the player. It monitors playback position and decides which segment to load next.
- **`BufferController`**: Manages the MediaSource and SourceBuffers. It handles data appending and buffer eviction (flushing).
- **`LevelController`**: Manages quality levels and level switching logic.
- **`AbrController`**: Adaptive Bitrate controller. It estimates bandwidth using EWMA (Exponential Weighted Moving Average) and suggests the best quality level.
- **`GapController`**: Detects and jumps over small gaps in the buffer to prevent stalls.
- **`ErrorController`**: Centralized error management and recovery strategies.
- **`CapLevelController`**: Caps the maximum quality level based on the media element's size or user constraints.

### 📥 Loaders

- **`PlaylistLoader`**: Handles fetching of M3U8 manifest files.
- **`FragmentLoader`**: Handles fetching of media segments (TS/fMP4).

### ⚙️ Remuxing & Parsing

- **`M3U8 Parser`**: Parses HLS playlists into structured data objects.
- **`TSDemuxer`**: Demuxes MPEG-TS packets into elementary streams (AVC/AAC).
- **`Remuxer`**: Packets elementary streams into ISO BMFF (fMP4) boxes for MSE consumption.
- **`MP4Generator`**: Low-level utility for generating MP4 boxes (Ftyp, Moov, Moof, Mdat).

## Data Flow

1. **Manifest Loading**: `PlaylistLoader` fetches the master manifest.
2. **Parsing**: `M3U8 Parser` extracts quality levels.
3. **Level Selection**: `AbrController` selects the initial level.
4. **Segment Fetching**: `StreamController` requests a segment, `FragmentLoader` fetches it.
5. **Transmuxing**: If the segment is MPEG-TS, it's sent to the `TSDemuxer` and then `Remuxer`. This often happens in a **Web Worker**.
6. **Buffering**: `BufferController` appends the remuxed fMP4 data to the browser's `SourceBuffer`.
7. **Playback**: The browser's `<video>` element plays the buffered data.
