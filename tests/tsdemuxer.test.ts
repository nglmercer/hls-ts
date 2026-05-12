import { describe, it, expect } from 'bun:test';
import { TSDemuxer } from '../src/remux/tsdemuxer';

function createTSPacket(
  pid: number,
  payloadUnitStart: boolean,
  payload: Uint8Array,
  adaptationField?: Uint8Array,
  isPsi?: boolean,
): Uint8Array {
  const pkt = new Uint8Array(188);
  pkt.fill(0xff);
  pkt[0] = 0x47;
  pkt[1] = (payloadUnitStart ? 0x40 : 0x00) | ((pid >> 8) & 0x1f);
  pkt[2] = pid & 0xff;

  let headerEnd = 4;
  if (adaptationField) {
    pkt[3] = 0x60;
    pkt[4] = adaptationField.length;
    pkt.set(adaptationField, 5);
    headerEnd += 1 + adaptationField.length;
  } else {
    pkt[3] = payloadUnitStart ? 0x50 : 0x10;
  }

  let payloadOffset = headerEnd;

  // Pointer field only for PSI tables (PAT/PMT), not PES packets
  if (payloadUnitStart && isPsi) {
    pkt[payloadOffset] = 0x00;
    payloadOffset++;
  }

  const space = 188 - payloadOffset;
  const toCopy = Math.min(payload.length, space);
  pkt.set(payload.subarray(0, toCopy), payloadOffset);
  return pkt;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeSectionData(
  tableId: number,
  sectionData: Uint8Array,
  privateBits: number = 0,
): Uint8Array {
  const sectionLength = sectionData.length + 5 + 4; // data + table_id/len/flags + CRC
  const header = new Uint8Array([
    tableId,
    (privateBits << 6) | 0x30 | ((sectionLength >> 8) & 0x0f),
    sectionLength & 0xff,
    0x00, 0x00, // transport_stream_id / program_number
    0xc1, // version, current_next
    0x00, // section_number
    0x00, // last_section_number
  ]);
  const result = new Uint8Array(header.length + sectionData.length + 4);
  result.set(header);
  result.set(sectionData, header.length);
  const crc = crc32(result.subarray(0, result.length - 4));
  const dv = new DataView(result.buffer);
  dv.setUint32(result.length - 4, crc);
  return result;
}

function makePAT(programNumber: number, pmtPid: number): Uint8Array {
  const data = new Uint8Array([
    (programNumber >> 8) & 0xff,
    programNumber & 0xff,
    0xe0 | ((pmtPid >> 8) & 0x1f),
    pmtPid & 0xff,
  ]);
  return makeSectionData(0x00, data);
}

function makePMT(
  pcrPid: number,
  streams: Array<{ streamType: number; pid: number }>,
): Uint8Array {
  const programInfo = new Uint8Array(4); // all zeros = no descriptor
  const streamData: number[] = [];
  for (const s of streams) {
    streamData.push(s.streamType, 0xe0 | ((s.pid >> 8) & 0x1f), s.pid & 0xff, 0x00, 0x00);
  }
  const data = new Uint8Array([
    0xe0 | ((pcrPid >> 8) & 0x1f),
    pcrPid & 0xff,
    (programInfo.length >> 8) & 0x0f,
    programInfo.length & 0xff,
    ...programInfo,
    ...streamData,
  ]);
  return makeSectionData(0x02, data, 1);
}

function makePESHeader(streamId: number, pts: number, dataLength: number): Uint8Array {
  const header = new Uint8Array(14);
  header[0] = 0x00;
  header[1] = 0x00;
  header[2] = 0x01;
  header[3] = streamId;
  header[4] = (dataLength >> 8) & 0xff;
  header[5] = dataLength & 0xff;
  header[6] = 0x80; // PTS only
  header[7] = 0x80; // header length = 5 (not 128?)
  header[8] = 5; // header data length remaining
  // PTS: 5 bytes
  header[9] = 0x21 | ((pts >> 29) & 0x0e);
  header[10] = (pts >> 22) & 0xff;
  header[11] = 0x01 | ((pts >> 14) & 0xfe);
  header[12] = (pts >> 7) & 0xff;
  header[13] = 0x01 | ((pts << 1) & 0xfe);
  return header;
}

describe('TSDemuxer', () => {
  it('should demux a TS file with PAT/PMT and video PES', () => {
    const demuxer = new TSDemuxer();

    const videoPid = 0x101;
    const audioPid = 0x102;
    const pmtPid = 0x1000;

    const patPayload = makePAT(1, pmtPid);
    const patPacket = createTSPacket(0x0000, true, patPayload, undefined, true);

    const pmtPayload = makePMT(videoPid, [
      { streamType: 0x1b, pid: videoPid },
      { streamType: 0x0f, pid: audioPid },
    ]);
    const pmtPacket = createTSPacket(pmtPid, true, pmtPayload, undefined, true);

    const naluData = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1e, 0xac, // SPS
      0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x10, // IDR slice
    ]);
    const pesHeader = makePESHeader(0xe0, 90000, 0);
    const videoPayload = new Uint8Array(pesHeader.length + naluData.length);
    videoPayload.set(pesHeader);
    videoPayload.set(naluData, pesHeader.length);
    const videoPacket = createTSPacket(videoPid, true, videoPayload);

    const tsData = new Uint8Array(patPacket.length + pmtPacket.length + videoPacket.length);
    tsData.set(patPacket, 0);
    tsData.set(pmtPacket, patPacket.length);
    tsData.set(videoPacket, patPacket.length + pmtPacket.length);

    const result = demuxer.demux(tsData, 0);

    expect(result.videoTrack).toBeDefined();
    expect(result.videoTrack!.type).toBe('video');
    expect(result.videoTrack!.samples.length).toBeGreaterThanOrEqual(1);
  });

  it('should demux audio-only TS content', () => {
    const demuxer = new TSDemuxer();
    const audioPid = 0x102;
    const pmtPid = 0x1001;

    const patPayload = makePAT(1, pmtPid);
    const patPacket = createTSPacket(0x0000, true, patPayload, undefined, true);

    const pmtPayload = makePMT(audioPid, [
      { streamType: 0x0f, pid: audioPid },
    ]);
    const pmtPacket = createTSPacket(pmtPid, true, pmtPayload, undefined, true);

    // ADTS AAC frame: sync header 0xFFF1, then frame length calculation
    // Minimal: 7 byte ADTS header + 1 byte data
    const aacFrame = new Uint8Array([
      0xff, 0xf1, 0x50, 0x80, 0x01, 0x1f, 0xfc, 0x00,
    ]);
    const pesHeader = makePESHeader(0xc0, 0, 0);
    const audioPayload = new Uint8Array(pesHeader.length + aacFrame.length);
    audioPayload.set(pesHeader);
    audioPayload.set(aacFrame, pesHeader.length);
    const audioPacket = createTSPacket(audioPid, true, audioPayload);

    const tsData = new Uint8Array(patPacket.length + pmtPacket.length + audioPacket.length);
    tsData.set(patPacket);
    tsData.set(pmtPacket, patPacket.length);
    tsData.set(audioPacket, patPacket.length + pmtPacket.length);

    const result = demuxer.demux(tsData, 0);
    expect(result.audioTrack).toBeDefined();
    expect(result.audioTrack!.type).toBe('audio');
  });

  it('should handle empty data gracefully', () => {
    const demuxer = new TSDemuxer();
    const result = demuxer.demux(new Uint8Array(0), 0);
    expect(result.videoTrack).toBeUndefined();
    expect(result.audioTrack).toBeUndefined();
  });

  it('should handle data without sync bytes', () => {
    const demuxer = new TSDemuxer();
    const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
    const result = demuxer.demux(data, 0);
    expect(result.videoTrack).toBeUndefined();
    expect(result.audioTrack).toBeUndefined();
  });

  it('should handle data with partial TS packets at end', () => {
    const demuxer = new TSDemuxer();
    const patPayload = makePAT(1, 0x1000);
    const patPacket = createTSPacket(0x0000, true, patPayload);
    const partialPacket = patPacket.subarray(0, 150);
    const result = demuxer.demux(partialPacket, 0);
  });

  it('should handle transport error indicator', () => {
    const demuxer = new TSDemuxer();
    const patPayload = makePAT(1, 0x1000);
    const packet = new Uint8Array(188);
    packet.fill(0x47);
    packet[1] = 0x80; // transport_error_indicator = 1
    packet.set(patPayload, 4);
    const result = demuxer.demux(packet, 0);
    expect(result.videoTrack).toBeUndefined();
  });

  it('should demux both video and audio from multi-packet TS', () => {
    const demuxer = new TSDemuxer();
    const videoPid = 0x101;
    const audioPid = 0x102;
    const pmtPid = 0x1000;

    const patPayload = makePAT(1, pmtPid);
    const patPacket = createTSPacket(0x0000, true, patPayload, undefined, true);

    const pmtPayload = makePMT(videoPid, [
      { streamType: 0x1b, pid: videoPid },
      { streamType: 0x0f, pid: audioPid },
    ]);
    const pmtPacket = createTSPacket(pmtPid, true, pmtPayload, undefined, true);

    const spsNalu = new Uint8Array([
      0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1e, 0xac, // SPS
      0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x10, // IDR slice
    ]);
    const pesVid = makePESHeader(0xe0, 90000, 0);
    const vidPayload = new Uint8Array(pesVid.length + spsNalu.length);
    vidPayload.set(pesVid);
    vidPayload.set(spsNalu, pesVid.length);
    const vidPkt = createTSPacket(videoPid, true, vidPayload);

    const aacFrame = new Uint8Array([0xff, 0xf1, 0x50, 0x80, 0x01, 0x1f, 0xfc, 0x00]);
    const pesAud = makePESHeader(0xc0, 0, 0);
    const audPayload = new Uint8Array(pesAud.length + aacFrame.length);
    audPayload.set(pesAud);
    audPayload.set(aacFrame, pesAud.length);
    const audPkt = createTSPacket(audioPid, true, audPayload);

    const tsData = new Uint8Array(patPacket.length + pmtPacket.length + vidPkt.length + audPkt.length);
    tsData.set(patPacket);
    tsData.set(pmtPacket, patPacket.length);
    tsData.set(vidPkt, patPacket.length + pmtPacket.length);
    tsData.set(audPkt, patPacket.length + pmtPacket.length + vidPkt.length);

    const result = demuxer.demux(tsData, 0);
    expect(result.videoTrack).toBeDefined();
    expect(result.audioTrack).toBeDefined();
  });
});
