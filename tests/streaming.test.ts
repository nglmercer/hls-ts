import { TSDemuxer } from '../src/remux/tsdemuxer';
import { Remuxer } from '../src/remux/remuxer';

async function test() {
  console.log('Fetching Fragment 0...');
  const f0 = await fetch('https://test-streams.mux.dev/x36xhzz/url_0/url_462/193039199_mp4_h264_aac_hd_7.ts').then(r => r.arrayBuffer());
  console.log('Fetching Fragment 1 (Level 4)...');
  const f1 = await fetch('https://test-streams.mux.dev/x36xhzz/url_8/193039199_mp4_h264_aac_fhd_7.ts').then(r => r.arrayBuffer());

  const ts = new TSDemuxer();
  const remuxer = new Remuxer();

  console.log('--- Demuxing Fragment 0 ---');
  let res = ts.demux(new Uint8Array(f0), 0);
  remuxer.remux(res, 0);

  console.log('--- Simulating Level Switch ---');
  ts.discontinuity = true;
  remuxer.reset();

  console.log('--- Demuxing Fragment 1 ---');
  res = ts.demux(new Uint8Array(f1), 10);
  remuxer.remux(res, 10 * 90000);
}

test();
