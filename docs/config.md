# Configuration

You can customize the behavior of `hls-ts` by passing a configuration object to the constructor.

```typescript
const hls = new Hls({
  debug: true,
  maxBufferLength: 60,
  enableWorker: true
});
```

## Available Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `debug` | `boolean` | `false` | Enable verbose logging in the console. |
| `enableWorker` | `boolean` | `true` | Enable worker-based transmuxing for better performance. |
| `maxBufferLength` | `number` | `30` | Maximum length of buffered data in seconds. |
| `maxMaxBufferLength` | `number` | `600` | Hard limit for `maxBufferLength`. |
| `backBufferLength` | `number` | `30` | Maximum length of buffered data to keep behind the playhead. |
| `startLevel` | `number` | `-1` | Initial quality level index (`-1` for auto). |
| `startPosition` | `number` | `-1` | Initial playback position in seconds (`-1` for default). |
| `autoStartLoad` | `boolean` | `true` | Automatically start loading when `loadSource` is called. |
| `liveSyncDurationCount` | `number` | `3` | Number of segments to keep for live synchronization. |

## Advanced Policies

### `manifestLoadPolicy` / `playlistLoadPolicy` / `fragLoadPolicy`

These policies control the loading behavior for different types of resources.

```typescript
{
  maxTimeToFirstByteMs: 9000,
  maxLoadTimeMs: 100000,
  timeoutRetry: { 
    maxNumRetry: 2, 
    retryDelayMs: 0, 
    maxRetryDelayMs: 0 
  },
  errorRetry: { 
    maxNumRetry: 5, 
    retryDelayMs: 3000, 
    maxRetryDelayMs: 15000, 
    backoff: 'linear' 
  }
}
```

## ABR Controller Config

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `abrEwmaFastLive` | `number` | `3` | Fast EWMA weight for live streams. |
| `abrEwmaSlowLive` | `number` | `9` | Slow EWMA weight for live streams. |
| `abrBandWidthFactor` | `number` | `0.95` | Multiplier applied to bandwidth estimate. |
| `abrBandWidthUpFactor` | `number` | `0.7` | Multiplier for upgrading quality. |
