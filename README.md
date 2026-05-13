# hls-ts

A modern, high-performance HTTP Live Streaming (HLS) client for the web, written in TypeScript. `hls-ts` provides a robust and flexible way to play HLS streams using Media Source Extensions (MSE).

## 🚀 Features

- **MSE Based Playback**: Seamless playback of MPEG-TS and fMP4 segments.
- **Adaptive Bitrate (ABR)**: Smoothly transitions between quality levels based on network conditions.
- **Worker-based Transmuxing**: Offloads heavy remuxing tasks to a background thread for butter-smooth UI.
- **Extensible Architecture**: Modular controller-based design for easy customization.
- **Full TypeScript Support**: Built with type safety in mind.
- **Robust Error Handling**: Automatic recovery and retry logic for network and media issues.

## 📦 Installation

```bash
npm install hls-ts
# or
bun add hls-ts
```

## 🛠️ Quick Start

```typescript
import { Hls } from 'hls-ts';

if (Hls.isSupported()) {
  const video = document.getElementById('video') as HTMLMediaElement;
  const hls = new Hls({
    debug: true,
    enableWorker: true
  });

  hls.loadSource('https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8');
  hls.attachMedia(video);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    video.play();
  });
}
```

## 📖 Documentation

Explore the detailed documentation to learn more about `hls-ts`:

- [**API Reference**](./docs/api.md) - Detailed guide on the `Hls` class and its methods.
- [**Configuration**](./docs/config.md) - Learn how to tune the player behavior.
- [**Events**](./docs/events.md) - Complete list of events emitted by the player.
- [**Architecture**](./docs/architecture.md) - Deep dive into the internal design and components.

## 🤝 Contributing

Contributions are welcome! Please check our [Contributing Guide](./CONTRIBUTING.md) for more details.

## 📄 License

This project is licensed under the MIT License.
