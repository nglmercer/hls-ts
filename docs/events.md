# Events

`hls-ts` is highly event-driven. You can listen to events using the `on` method of the `Hls` instance.

```typescript
import { Hls, Events } from 'hls-ts';

hls.on(Events.MANIFEST_PARSED, (data) => {
  console.log('Manifest parsed!', data);
});
```

## Media Events

| Event | Description |
| :--- | :--- |
| `MEDIA_ATTACHED` | Fired when the media element is successfully attached. |
| `MEDIA_DETACHED` | Fired when the media element is detached. |
| `MEDIA_SEEKING` | Fired when the media element starts seeking. |
| `MEDIA_SEEKED` | Fired when the media element has finished seeking. |

## Manifest Events

| Event | Description |
| :--- | :--- |
| `MANIFEST_LOADING` | Fired when the manifest starts loading. |
| `MANIFEST_LOADED` | Fired when the manifest file is loaded. |
| `MANIFEST_PARSED` | Fired when the manifest is parsed and levels are available. |

## Level Events

| Event | Description |
| :--- | :--- |
| `LEVEL_SWITCHING` | Fired when a quality level switch is initiated. |
| `LEVEL_SWITCHED` | Fired when a quality level switch is completed. |
| `LEVEL_LOADING` | Fired when a level playlist starts loading. |
| `LEVEL_LOADED` | Fired when a level playlist is loaded. |
| `LEVEL_UPDATED` | Fired when a level playlist is updated (for live streams). |

## Buffer Events

| Event | Description |
| :--- | :--- |
| `BUFFER_RESET` | Fired when the buffer is reset. |
| `BUFFER_CODECS` | Fired when codecs are detected. |
| `BUFFER_APPENDING` | Fired when data is being appended to the buffer. |
| `BUFFER_APPENDED` | Fired when data has been successfully appended. |
| `BUFFER_FLUSHING` | Fired when the buffer is being flushed. |
| `BUFFER_FLUSHED` | Fired when the buffer has been flushed. |

## Fragment Events

| Event | Description |
| :--- | :--- |
| `FRAG_LOADING` | Fired when a segment starts loading. |
| `FRAG_LOAD_PROGRESS` | Fired during segment loading progress. |
| `FRAG_LOADED` | Fired when a segment is loaded. |
| `FRAG_PARSED` | Fired when a segment is parsed and remuxed. |
| `FRAG_BUFFERED` | Fired when a segment is successfully appended to the buffer. |

## Other Events

| Event | Description |
| :--- | :--- |
| `ERROR` | Fired when an error occurs. |
| `DESTROYING` | Fired when the player instance is being destroyed. |
