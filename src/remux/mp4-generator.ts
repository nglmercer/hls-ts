import { TrackTypes, type TrackType } from '../types';

const UINT32_MAX = Math.pow(2, 32) - 1;

export interface MP4Track {
  id: number;
  type: TrackType;
  timescale: number;
  duration: number;
  width?: number;
  height?: number;
  sps?: Uint8Array[];
  pps?: Uint8Array[];
  vps?: Uint8Array[];
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
  hev1: [0x68, 0x65, 0x76, 0x31],
  hvc1: [0x68, 0x76, 0x63, 0x31],
  hvcC: [0x68, 0x76, 0x63, 0x43],
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
  mfhd: [0x6d, 0x66, 0x68, 0x64],
  free: [0x66, 0x72, 0x65, 0x65],
};

function t(type: string): number[] {
  return BOX_TYPES[type] || [0, 0, 0, 0];
}

function box(type: number[] | Uint8Array, ...payloads: (Uint8Array)[]): Uint8Array {
  const typeArr = type instanceof Uint8Array ? type : new Uint8Array(type);
  let size = 8;
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
  const high = Math.floor(value / 0x100000000);
  const low = value >>> 0;
  dv.setUint32(0, high);
  dv.setUint32(4, low);
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
    new Uint8Array([0x69, 0x73, 0x6f, 0x6d]), // isom
    w32(1), // minor version
    new Uint8Array([0x69, 0x73, 0x6f, 0x6d]), // isom
    new Uint8Array([0x61, 0x76, 0x63, 0x31]), // avc1
    new Uint8Array([0x6d, 0x70, 0x34, 0x32]), // mp42
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
    zeros(10),
    new Uint8Array([
      0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00
    ]), // identity matrix
    zeros(24),
    w32(0xffffffff),
  );
}

function tkhd(track: MP4Track): Uint8Array {
  return box(t('tkhd'),
    w8(0), new Uint8Array([0x00, 0x00, 0x07]), // flags: enabled, in_movie, in_preview
    w32(0),
    w32(0),
    w32(track.id),
    w32(0),
    w32(track.duration || 0),
    zeros(8),
    w16(0), // layer
    w16(0), // alternate group
    w16(track.type === TrackTypes.AUDIO ? 0x0100 : 0), // volume
    zeros(2),
    new Uint8Array([
      0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00
    ]), // matrix
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
    w16(0x55c4), // language: und
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
    zeros(12),
    new Uint8Array([...nameBytes, 0]),
  );
}

function vmhd(): Uint8Array {
  return box(t('vmhd'), w8(0), new Uint8Array([0x00, 0x00, 0x01]), w16(0), zeros(6));
}

function smhd(): Uint8Array {
  return box(t('smhd'), w8(0), zeros(3), w16(0), w16(0));
}

function dref(): Uint8Array {
  return box(t('dref'), w8(0), zeros(3), w32(1),
    box(new Uint8Array([0x75, 0x72, 0x6c, 0x20]), w8(0), new Uint8Array([0x00, 0x00, 0x01])), // url  box with self-contained flag
  );
}

function stsd(track: MP4Track): Uint8Array {
  const entries: Uint8Array[] = [];
  if (track.type === TrackTypes.VIDEO) {
    const isHEVC = track.codec.startsWith('hev1') || track.codec.startsWith('hvc1');
    entries.push(isHEVC ? hvc1Box(track) : avc1Box(track));
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
    firstSps?.[1] ?? 0x64,
    firstSps?.[2] ?? 0x00,
    firstSps?.[3] ?? 0x1e,
    0xff,
    0xe0 | (track.sps?.length || 0),
    ...spsArr,
    track.pps?.length || 0,
    ...ppsArr,
  ];

  const avcC = box(t('avcC'), new Uint8Array(avcCData));

  return box(t('avc1'),
    zeros(6), w16(1),
    w16(0), w16(0),
    w32(0), w32(0), w32(0),
    w16(track.width || 0), w16(track.height || 0),
    w32(0x00480000), w32(0x00480000),
    w32(0), w16(1),
    zeros(32),
    w16(0x0018), w16(0xffff),
    avcC,
  );
}

function hvc1Box(track: MP4Track): Uint8Array {
  const sps = track.sps || [];
  const pps = track.pps || [];
  const vps = track.vps;

  const arrayData: number[] = [];
  // VPS
  if (vps && vps.length > 0) {
    arrayData.push(0xa0, (vps[0].byteLength >>> 8) & 0xff, vps[0].byteLength & 0xff);
    arrayData.push(...Array.from(vps[0]));
  }
  // SPS
  if (sps.length > 0) {
    arrayData.push(0xa1, (sps[0].byteLength >>> 8) & 0xff, sps[0].byteLength & 0xff);
    arrayData.push(...Array.from(sps[0]));
  }
  // PPS
  if (pps.length > 0) {
    arrayData.push(0xa2, (pps[0].byteLength >>> 8) & 0xff, pps[0].byteLength & 0xff);
    arrayData.push(...Array.from(pps[0]));
  }

  const firstSps = sps[0];
  const hvcCData = [
    0x01,
    (firstSps?.[1] ?? 0) > 1 ? 0x20 : 0x00,
    firstSps?.[1] ? (firstSps[1] & 0x1f) : 1,
    0x00, 0x00, 0x00, 0x00,
    0xf0, 0x00, 0xfc, 0xfd,
    0xf8, 0xf8, 0x00, 0x00, 0x0f,
    0x03,
    firstSps?.[12] ?? 30,
    0x01, 0x00, 0x01,
    0x02,
    ...arrayData,
  ];

  const hvcC = box(t('hvcC'), new Uint8Array(hvcCData));

  const codecBoxType = track.codec.startsWith('hev1') ? t('hev1') : t('hvc1');
  return box(codecBoxType,
    zeros(6), w16(1),
    w16(0), w16(0),
    w32(0), w32(0), w32(0),
    w16(track.width || 0), w16(track.height || 0),
    w32(0x00480000), w32(0x00480000),
    w32(0), w16(1),
    zeros(32),
    w16(0x0018), w16(0xffff),
    hvcC,
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

  const esds = box(t('esds'), new Uint8Array([
    0x00, 0x00, 0x00, 0x00, // version 0
    0x03, // ES_DescriptorTag
    0x80, 0x80, 0x80, // optional bits
    0x20 + audioSpecificConfig.length, // length
    0x00, 0x01, // ES_ID
    0x00, // streamPriority
    0x04, // DecoderConfigDescrTag
    0x80, 0x80, 0x80,
    0x12 + audioSpecificConfig.length, // length
    0x40, // objectTypeId (Audio ISO/IEC 14496-3)
    0x15, // streamType (AudioStream)
    0x00, 0x00, 0x00, // bufferSizeDB
    0x00, 0x00, 0x00, 0x00, // maxBitrate
    0x00, 0x00, 0x00, 0x00, // avgBitrate
    0x05, // AudioSpecificConfigTag
    0x80, 0x80, 0x80,
    audioSpecificConfig.length, // length
    ...Array.from(audioSpecificConfig),
    0x06, // SLConfigDescrTag
    0x80, 0x80, 0x80,
    0x01, // length
    0x02, // predefined
  ]));

  return box(t('mp4a'),
    zeros(6), w16(1),
    w16(0), w16(0),
    zeros(4),
    w16(channels), w16(16),
    w16(0), w16(0),
    w32(sampleRate << 16),
    esds,
  );
}

function stts(): Uint8Array {
  return box(t('stts'), w8(0), zeros(3), w32(0));
}

function stsc(): Uint8Array {
  return box(t('stsc'), w8(0), zeros(3), w32(0));
}

function stsz(): Uint8Array {
  return box(t('stsz'), w8(0), zeros(3), w32(0), w32(0));
}

function stco(): Uint8Array {
  return box(t('stco'), w8(0), zeros(3), w32(0));
}

function trex(track: MP4Track): Uint8Array {
  return box(t('trex'), w8(0), zeros(3), w32(track.id), w32(1), w32(0), w32(0), w32(0));
}

function tfhd(track: MP4Track): Uint8Array {
  // flags: default-base-is-moof (0x020000)
  return box(t('tfhd'), w8(0), new Uint8Array([0x02, 0x00, 0x00]), w32(track.id));
}

function tfdt(baseMediaDecodeTime: number): Uint8Array {
  return box(t('tfdt'), w8(1), zeros(3), w64(baseMediaDecodeTime));
}

// Returns {data, dataOffsetFieldPos} — position of the data_offset field in the trun box
function trun(samples: MP4Sample[], dataOffset: number): { data: Uint8Array; dataOffsetFieldPos: number } {
  const flags = 0x001 | 0x100 | 0x200 | 0x400 | 0x800;
  const entries: Uint8Array[] = [];
  for (const s of samples) {
    entries.push(
      w32(s.duration),
      w32(s.size),
      w32(s.flags.isSync ? 0x02000000 : 0x01010000),
      i32(s.cts),
    );
  }
  const entriesData = box(t('trun'), w8(0), w24(flags),
    w32(samples.length), i32(dataOffset), ...entries,
  );
  return {
    data: entriesData,
    dataOffsetFieldPos: 20, // box header(8) + version(1) + flags(3) + sample_count(4) = 16, + offset of i32(dataOffset) within the box
  };
}

export function initSegment(tracks: MP4Track[]): Uint8Array {
  const ftypBox = ftyp();
  const firstTrack = tracks[0];
  if (!firstTrack) return new Uint8Array(0);

  const moovBoxes: Uint8Array[] = [mvhd(firstTrack)];
  for (const track of tracks) {
    const stblBoxes: Uint8Array[] = [stsd(track), stts(), stsc(), stsz(), stco()];
    const handlerType = track.type === TrackTypes.VIDEO ? 'vide' : 'soun';
    const handlerName = track.type === TrackTypes.VIDEO ? 'VideoHandler' : 'SoundHandler';
    moovBoxes.push(
      box(t('trak'),
        tkhd(track),
        box(t('mdia'),
          mdhd(track),
          hdlr(handlerType, handlerName),
          box(t('minf'),
            track.type === TrackTypes.VIDEO ? vmhd() : smhd(),
            box(t('dinf'), dref()),
            box(t('stbl'), ...stblBoxes),
          ),
        ),
      ),
    );
  }
  moovBoxes.push(box(t('mvex'), ...tracks.map(t => trex(t))));
  const moovBox = box(t('moov'), ...moovBoxes);

  const result = new Uint8Array(ftypBox.length + moovBox.length);
  result.set(ftypBox);
  result.set(moovBox, ftypBox.length);
  return result;
}

export function fragmentBox(track: MP4Track, samples: MP4Sample[], baseDts: number, sequenceNumber?: number): { moof: Uint8Array; mdat: Uint8Array } {

  const mfhdBox = box(t('mfhd'), w8(0), zeros(3), w32(sequenceNumber ?? 0));
  const tfhdBox = tfhd(track);
  const tfdtBox = tfdt(baseDts);

  // Pre-compute the trun data_offset field position to avoid linear scan later.
  // Layout within moof: moof header(8) + mfhd + traf header(8) + tfhd + tfdt + trun
  // Within trun: header(8) + version(1) + flags(3) + sample_count(4) + data_offset(4)
  const moofPrefixSize = 8 + mfhdBox.byteLength + 8 + tfhdBox.byteLength + tfdtBox.byteLength;
  const trunPrefixSize = 8 + 1 + 3 + 4; // trun header + version + flags + sample_count
  const trunDataOffsetPos = moofPrefixSize + trunPrefixSize;

  const trunResult = trun(samples, 0); // placeholder data_offset
  const moof = box(t('moof'), mfhdBox,
    box(t('traf'), tfhdBox, tfdtBox, trunResult.data),
  );

  const dataSize = samples.reduce((sum, s) => sum + s.size, 0);
  const mdatBody = new Uint8Array(dataSize);
  let offset = 0;
  for (const s of samples) {
    mdatBody.set(s.data, offset);
    offset += s.size;
  }
  const mdat = box(t('mdat'), mdatBody);

  const actualDataOffset = moof.byteLength + 8; // moof size + mdat header (8)
  const dv = new DataView(moof.buffer, moof.byteOffset, moof.byteLength);
  dv.setInt32(trunDataOffsetPos, actualDataOffset);

  return { moof, mdat };
}

