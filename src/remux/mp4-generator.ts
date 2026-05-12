const UINT32_MAX = Math.pow(2, 32) - 1;

export interface MP4Track {
  id: number;
  type: 'video' | 'audio';
  timescale: number;
  duration: number;
  width?: number;
  height?: number;
  sps?: Uint8Array[];
  pps?: Uint8Array[];
  audioConfig?: Uint8Array;
  channelCount?: number;
  sampleRate?: number;
  codec: string;
}

export interface MP4Sample {
  size: number;
  duration: number;
  cts: number;
  flags: {
    isLeading: number;
    isDependedOn: number;
    hasRedundancy: number;
    degradPrio: number;
    dependsOn: number;
    isSync: boolean;
  };
  data: Uint8Array;
}

const BOX_TYPES: Record<string, number[]> = {
  ftyp: [0x66, 0x74, 0x79, 0x70],
  avc1: [0x61, 0x76, 0x63, 0x31],
  avcC: [0x61, 0x76, 0x63, 0x43],
  mp4a: [0x6d, 0x70, 0x34, 0x61],
  esds: [0x65, 0x73, 0x64, 0x73],
  mp3: [0x2e, 0x6d, 0x70, 0x33],
  ac3: [0x61, 0x63, 0x2d, 0x33],
  dac3: [0x64, 0x61, 0x63, 0x33],
  moov: [0x6d, 0x6f, 0x6f, 0x76],
  trak: [0x74, 0x72, 0x61, 0x6b],
  mdia: [0x6d, 0x64, 0x69, 0x61],
  mdhd: [0x6d, 0x64, 0x68, 0x64],
  hdlr: [0x68, 0x64, 0x6c, 0x72],
  minf: [0x6d, 0x69, 0x6e, 0x66],
  vmhd: [0x76, 0x6d, 0x68, 0x64],
  smhd: [0x73, 0x6d, 0x68, 0x64],
  dinf: [0x64, 0x69, 0x6e, 0x66],
  dref: [0x64, 0x72, 0x65, 0x66],
  stbl: [0x73, 0x74, 0x62, 0x6c],
  stsd: [0x73, 0x74, 0x73, 0x64],
  stts: [0x73, 0x74, 0x74, 0x73],
  stsc: [0x73, 0x74, 0x73, 0x63],
  stsz: [0x73, 0x74, 0x73, 0x7a],
  stco: [0x73, 0x74, 0x63, 0x6f],
  mvhd: [0x6d, 0x76, 0x68, 0x64],
  tkhd: [0x74, 0x6b, 0x68, 0x64],
  moof: [0x6d, 0x6f, 0x6f, 0x66],
  traf: [0x74, 0x72, 0x61, 0x66],
  tfhd: [0x74, 0x66, 0x68, 0x64],
  tfdt: [0x74, 0x66, 0x64, 0x74],
  trun: [0x74, 0x72, 0x75, 0x6e],
  mdat: [0x6d, 0x64, 0x61, 0x74],
  mvex: [0x6d, 0x76, 0x65, 0x78],
  trex: [0x74, 0x72, 0x65, 0x78],
  free: [0x66, 0x72, 0x65, 0x65],
};

function t(type: string): number[] {
  return BOX_TYPES[type] || [0, 0, 0, 0];
}

function box(type: number[] | Uint8Array, ...payloads: (Uint8Array)[]): Uint8Array {
  const typeArr = type instanceof Uint8Array ? type : new Uint8Array(type);
  let size = 8 + typeArr.length - 4;
  for (const p of payloads) size += p.byteLength;

  const result = new Uint8Array(size);
  const dv = new DataView(result.buffer);
  dv.setUint32(0, size);
  result.set(typeArr, 4);

  let offset = 8;
  for (const buf of payloads) {
    result.set(buf, offset);
    offset += buf.byteLength;
  }
  return result;
}

function w32(value: number): Uint8Array {
  const arr = new Uint8Array(4);
  new DataView(arr.buffer).setUint32(0, value);
  return arr;
}

function w64(value: number): Uint8Array {
  const arr = new Uint8Array(8);
  const dv = new DataView(arr.buffer);
  dv.setUint32(0, Math.floor(value / UINT32_MAX));
  dv.setUint32(4, value >>> 0);
  return arr;
}

function w16(value: number): Uint8Array {
  const arr = new Uint8Array(2);
  new DataView(arr.buffer).setUint16(0, value);
  return arr;
}

function w8(value: number): Uint8Array {
  return new Uint8Array([value]);
}

function w24(value: number): Uint8Array {
  return new Uint8Array([(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
}

function i16(value: number): Uint8Array {
  const arr = new Uint8Array(2);
  new DataView(arr.buffer).setInt16(0, value);
  return arr;
}

function i32(value: number): Uint8Array {
  const arr = new Uint8Array(4);
  new DataView(arr.buffer).setInt32(0, value);
  return arr;
}

function zeros(n: number): Uint8Array {
  return new Uint8Array(n);
}

function ftyp(): Uint8Array {
  return box(t('ftyp'),
    w32(0x69736f6d),
    w32(0x200),
    w32(0x69736f6d),
    w32(0x69736f32),
    w32(0x61766331),
    w32(0x68766331),
    w32(0x6d703461),
  );
}

function mvhd(track: MP4Track): Uint8Array {
  return box(t('mvhd'),
    w8(0), zeros(3),
    w32(0), w32(0),
    w32(track.timescale),
    w32(track.duration || 0),
    w32(0x00010000),
    w16(0x0100),
    zeros(10), zeros(36), zeros(24),
  );
}

function tkhd(track: MP4Track): Uint8Array {
  return box(t('tkhd'),
    w8(0), new Uint8Array([0x00, 0x00, 0x07]),
    w32(0),
    w32(0),
    w32(0), w32(0),
    w32(track.id),
    w32(0),
    w32(track.duration || 0),
    zeros(8),
    i16(0), i16(0),
    w16(track.type === 'audio' ? 0x0100 : 0),
    zeros(2), zeros(36),
    w32((track.width || 0) << 16),
    w32((track.height || 0) << 16),
  );
}

function mdhd(track: MP4Track): Uint8Array {
  return box(t('mdhd'),
    w8(0), zeros(3),
    w32(0), w32(0),
    w32(track.timescale),
    w32(track.duration || 0),
    w16(0x55c4),
    w16(0),
  );
}

function hdlr(handlerType: string, handlerName: string): Uint8Array {
  const typeBytes = handlerType.split('').map(c => c.charCodeAt(0));
  const nameBytes = handlerName.split('').map(c => c.charCodeAt(0));
  return box(t('hdlr'),
    w8(0), zeros(3),
    w32(0),
    new Uint8Array(typeBytes),
    w32(0), w32(0), w32(0),
    new Uint8Array([...nameBytes, 0]),
  );
}

function vmhd(): Uint8Array {
  return box(t('vmhd'), w8(0), new Uint8Array([0x00, 0x00, 0x01]), w16(0), zeros(8));
}

function smhd(): Uint8Array {
  return box(t('smhd'), w8(0), zeros(3), w16(0), w16(0));
}

function dref(): Uint8Array {
  return box(t('dref'), w8(0), zeros(3), w32(1),
    box(new Uint8Array([0x01, 0x00, 0x00, 0x00]), w8(0), zeros(3)),
  );
}

function stsd(track: MP4Track): Uint8Array {
  const entries: Uint8Array[] = [];
  if (track.type === 'video') {
    entries.push(avc1Box(track));
  } else {
    entries.push(mp4aBox(track));
  }
  return box(t('stsd'), w8(0), zeros(3), w32(entries.length), ...entries);
}

function avc1Box(track: MP4Track): Uint8Array {
  const spsArr: number[] = [];
  for (const s of track.sps || []) {
    spsArr.push((s.byteLength >>> 8) & 0xff, s.byteLength & 0xff, ...Array.from(s));
  }
  const ppsArr: number[] = [];
  for (const p of track.pps || []) {
    ppsArr.push((p.byteLength >>> 8) & 0xff, p.byteLength & 0xff, ...Array.from(p));
  }

  const firstSps = track.sps?.[0];
  const avcCData = [
    0x01,
    firstSps?.[3] ?? 0x64,
    firstSps?.[4] ?? 0x00,
    firstSps?.[5] ?? 0x1e,
    0xfc | 3,
    0xe0 | (track.sps?.length || 0),
    ...spsArr,
    track.pps?.length || 0,
    ...ppsArr,
  ];

  const avcC = box(t('avcC'), new Uint8Array(avcCData));

  return box(t('avc1'),
    zeros(6), w16(0),
    w16(0), w16(0),
    w32(0), w32(0), w32(0),
    w16(track.width || 0), w16(track.height || 0),
    w32(0x00480000), w32(0x00480000),
    w32(0), w16(1),
    zeros(32),
    i16(0x0018), i16(0xffff),
    avcC,
  );
}

function mp4aBox(track: MP4Track): Uint8Array {
  const sampleRate = track.sampleRate || track.timescale || 44100;
  const channels = track.channelCount || 2;

  let audioSpecificConfig = track.audioConfig;
  if (!audioSpecificConfig || audioSpecificConfig.length < 2) {
    const srIndex = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(sampleRate);
    const sr = srIndex >= 0 ? srIndex : 4;
    audioSpecificConfig = new Uint8Array([
      (2 << 3) | (sr >> 1),
      (sr << 7) | (channels << 3),
    ]);
  }

  const decoderConfig = [
    0x11, 0x90,
    ...Array.from(audioSpecificConfig),
  ];

  const decoderSpecificInfo = new Uint8Array([
    0x05, 0x80, 0x80, 0x80, decoderConfig.length,
    ...decoderConfig,
    0x06, 0x80, 0x80, 0x80, 0x01, 0x02,
  ]);

  const esds = box(t('esds'), new Uint8Array([
    0x03, 0x80, 0x80, 0x80, 0x22, 0x00, 0x00,
    0x04, 0x80, 0x80, 0x80, 0x17,
    0x40,
    ...Array.from(audioSpecificConfig),
    0x00, 0x00, 0x00, 0x00,
    ...decoderSpecificInfo,
  ]));

  return box(t('mp4a'),
    zeros(6), w16(0),
    w16(0), w16(0),
    zeros(4),
    w16(channels), w16(16),
    w16(0), w16(0),
    w32(sampleRate),
    esds,
  );
}

function stts(track: MP4Track, samples: MP4Sample[]): Uint8Array {
  if (samples.length === 0) return box(t('stts'), w8(0), zeros(3), w32(0));
  return box(t('stts'), w8(0), zeros(3), w32(1),
    w32(samples.length), w32(samples[0].duration),
  );
}

function stsc(): Uint8Array {
  return box(t('stsc'), w8(0), zeros(3), w32(0));
}

function stsz(samples: MP4Sample[]): Uint8Array {
  return box(t('stsz'), w8(0), zeros(3), w32(0), w32(samples.length),
    ...samples.map(s => w32(s.size)),
  );
}

function stco(): Uint8Array {
  return box(t('stco'), w8(0), zeros(3), w32(0));
}

function trex(track: MP4Track): Uint8Array {
  return box(t('trex'), w8(0), zeros(3), w32(track.id), w32(1), w32(0), w32(0), w32(0));
}

function tfhd(track: MP4Track, baseDataOffset: number): Uint8Array {
  return box(t('tfhd'), w8(0), new Uint8Array([0x02, 0x00, 0x00]),
    w32(track.id), w64(baseDataOffset),
  );
}

function tfdt(baseMediaDecodeTime: number): Uint8Array {
  return box(t('tfdt'), w8(1), zeros(3), w64(baseMediaDecodeTime));
}

function trun(samples: MP4Sample[], dataOffset: number): Uint8Array {
  const entries: Uint8Array[] = [];
  for (const s of samples) {
    entries.push(w32(s.size), w32(s.duration),
      w32(s.flags.isSync ? 0x02000000 : 0x01010000),
      w32(s.size), w32(s.cts),
    );
  }
  return box(t('trun'), w8(0), new Uint8Array([0x00, 0x07, 0x05]),
    w32(samples.length), i32(dataOffset), ...entries,
  );
}

export function initSegment(tracks: MP4Track[]): Uint8Array {
  const firstTrack = tracks[0];
  if (!firstTrack) return new Uint8Array(0);

  const moovBoxes: Uint8Array[] = [mvhd(firstTrack)];
  for (const track of tracks) {
    const stblBoxes: Uint8Array[] = [stsd(track), stts(track, []), stsc(), stsz([]), stco()];
    const handlerType = track.type === 'video' ? 'vide' : 'soun';
    const handlerName = track.type === 'video' ? 'VideoHandler' : 'SoundHandler';
    moovBoxes.push(
      box(t('trak'),
        tkhd(track),
        box(t('mdia'),
          mdhd(track),
          hdlr(handlerType, handlerName),
          box(t('minf'),
            track.type === 'video' ? vmhd() : smhd(),
            box(t('dinf'), dref()),
            box(t('stbl'), ...stblBoxes),
          ),
        ),
      ),
    );
  }
  moovBoxes.push(box(t('mvex'), ...tracks.map(t => trex(t))));
  return box(t('ftyp'), ftyp(), box(t('moov'), ...moovBoxes));
}

export function fragmentBox(track: MP4Track, samples: MP4Sample[], baseDts: number): { moof: Uint8Array; mdat: Uint8Array } {
  const dataSize = samples.reduce((sum, s) => sum + s.size, 0);
  const moofSize = 8 + 8 + 8 + 12 + 12 + 16 + 8 + samples.length * 20;
  const dataOffset = 8 + moofSize;

  const mdatBody = new Uint8Array(dataSize);
  let offset = 0;
  for (const s of samples) {
    mdatBody.set(s.data, offset);
    offset += s.size;
  }
  const mdat = box(t('mdat'), mdatBody);

  const trafBoxes: Uint8Array[] = [
    tfhd(track, moofSize),
    tfdt(baseDts),
    trun(samples, dataOffset),
  ];
  const moof = box(t('moof'), box(t('traf'), ...trafBoxes));

  return { moof, mdat };
}
