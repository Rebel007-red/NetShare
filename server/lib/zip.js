import { once } from 'node:events';
import { promisify } from 'node:util';
import { deflateRaw } from 'node:zlib';

const deflate = promisify(deflateRaw);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP stores timestamps in MS-DOS format, in local time, with 2-second steps. */
function dosDateTime(value) {
  const date = new Date(value);
  const valid = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = Math.max(valid.getFullYear(), 1980);
  return {
    time: (valid.getHours() << 11) | (valid.getMinutes() << 5) | (valid.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((valid.getMonth() + 1) << 5) | valid.getDate(),
  };
}

const UTF8_FLAG = 0x0800;
const MAX_ENTRIES = 65535;
/** Plain ZIP (no ZIP64) cannot address past 4 GB, so refuse before writing anything. */
const MAX_ARCHIVE_BYTES = 0xffffffff - 1024 * 1024;

async function send(res, chunk) {
  if (!res.write(chunk)) await once(res, 'drain');
}

/**
 * Streams a ZIP to `res`, holding one file in memory at a time.
 *
 * `entries` is `[{ name, isDir, modifiedAt, size, read }]` where `read()` returns a
 * Buffer. Directory names must end with `/`. Files are deflated when that makes
 * them smaller and stored as-is otherwise (already-compressed images, archives).
 * Only the baseline ZIP format is written, so any unzip tool can open the result.
 */
export async function streamZip(res, entries) {
  if (entries.length > MAX_ENTRIES) throw new Error('Too many entries for a ZIP');
  if (entries.reduce((sum, entry) => sum + Number(entry.size ?? 0), 0) > MAX_ARCHIVE_BYTES) {
    throw new Error('Too much data for a ZIP');
  }

  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const { time, date } = dosDateTime(entry.modifiedAt);
    let data = Buffer.alloc(0);
    let method = 0;
    let crc = 0;

    if (!entry.isDir) {
      const raw = await entry.read();
      crc = crc32(raw);
      data = raw;
      if (raw.length > 0) {
        const packed = await deflate(raw);
        if (packed.length < raw.length) {
          data = packed;
          method = 8;
        }
      }
      entry.rawSize = raw.length;
    }

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(UTF8_FLAG, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.isDir ? 0 : entry.rawSize, 22);
    header.writeUInt16LE(name.length, 26);
    header.writeUInt16LE(0, 28);

    await send(res, header);
    await send(res, name);
    if (data.length > 0) await send(res, data);

    central.push({ name, method, time, date, crc, compressed: data.length, size: entry.isDir ? 0 : entry.rawSize, isDir: entry.isDir, offset });
    offset += header.length + name.length + data.length;
  }

  const directoryStart = offset;
  let directorySize = 0;

  for (const item of central) {
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(UTF8_FLAG, 8);
    record.writeUInt16LE(item.method, 10);
    record.writeUInt16LE(item.time, 12);
    record.writeUInt16LE(item.date, 14);
    record.writeUInt32LE(item.crc, 16);
    record.writeUInt32LE(item.compressed, 20);
    record.writeUInt32LE(item.size, 24);
    record.writeUInt16LE(item.name.length, 28);
    record.writeUInt16LE(0, 30);
    record.writeUInt16LE(0, 32);
    record.writeUInt16LE(0, 34);
    record.writeUInt16LE(0, 36);
    record.writeUInt32LE(item.isDir ? 0x10 : 0, 38);
    record.writeUInt32LE(item.offset, 42);
    await send(res, record);
    await send(res, item.name);
    directorySize += record.length + item.name.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(directoryStart, 16);
  end.writeUInt16LE(0, 20);
  await send(res, end);
}
