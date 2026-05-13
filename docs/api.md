# API Reference

The `Hls` class is the main entry point for the library. It manages the lifecycle of the player, coordinate controllers, and emits events.

## `Hls` Class

### Constructor

```typescript
new Hls(config?: Partial<HlsConfig>)
```
Creates a new `Hls` instance with optional configuration.

### Static Methods

#### `Hls.isSupported(): boolean`
Returns `true` if the browser supports Media Source Extensions (MSE).

### Instance Methods

#### `loadSource(url: string): void`
Loads the HLS master playlist or media playlist from the given URL.

#### `attachMedia(media: HTMLMediaElement): void`
Attaches an HTML `<video>` or `<audio>` element to the player.

#### `detachMedia(): void`
Detaches the current media element and stops playback.

#### `destroy(): void`
Completely destroys the player instance, releasing all resources and removing event listeners.

#### `startLoad(startPosition: number = -1): void`
Starts or resumes loading segments. If `startPosition` is provided, it overrides the default start position.

#### `stopLoad(): void`
Stops loading segments.

#### `seekTo(time: number): void`
Seeks to a specific time in the stream.

#### `recoverMediaError(): void`
Attempts to recover from a non-fatal media error.

### Properties

| Property | Type | Description |
| :--- | :--- | :--- |
| `config` | `HlsConfig` | The current configuration (read-only). |
| `levels` | `Level[]` | Available quality levels. |
| `currentLevel` | `number` | Get or set the current quality level index. `-1` for auto-switch. |
| `bandwidthEstimate` | `number` | Current estimated bandwidth in bits/s. |
| `url` | `string \| null` | The URL of the currently loaded stream. |
| `media` | `HTMLMediaElement \| null` | The currently attached media element. |

### Event Methods

#### `on(event: string, handler: Function): void`
Registers an event listener.

#### `once(event: string, handler: Function): void`
Registers an event listener that runs only once.

#### `off(event: string, handler: Function): void`
Removes an event listener.
