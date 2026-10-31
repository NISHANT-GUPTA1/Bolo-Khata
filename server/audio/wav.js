// Small WAV helpers: wrap PCM, read duration, pull raw PCM out of a WAV buffer.

export function pcmToWav(pcm, sampleRate = 16000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE((channels * bitsPerSample) / 8, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export function parseWav(buf) {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      // Streaming encoders sometimes write 0 or 0xFFFFFFFF as the data size.
      if (size === 0 || size === 0xffffffff || body + size > buf.length) size = buf.length - body;
      const data = buf.subarray(body, body + size);
      const f = fmt || { channels: 1, sampleRate: 16000, bitsPerSample: 16 };
      return { ...f, data, duration: data.length / (f.sampleRate * f.channels * (f.bitsPerSample / 8)) };
    }
    off = body + size + (size % 2);
  }
  return null;
}

export function stripWavHeader(buf) {
  const w = parseWav(buf);
  return w ? w.data : buf;
}

// Rough duration for anything (used only for the local usage meter).
export function estimateDuration(buf, mime = '') {
  const w = parseWav(buf);
  if (w) return w.duration;
  if (/mpeg|mp3/.test(mime)) return buf.length / 16000; // ~128 kbps
  return buf.length / 4000; // compressed formats such as ogg/opus/m4a (~32 kbps)
}
