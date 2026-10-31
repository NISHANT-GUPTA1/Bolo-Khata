// Turns mic audio into 16 kHz mono 16-bit PCM in 512-sample (1,024-byte) frames, the size Prisma expects.
class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.pos = 0;
    this.buf = new Int16Array(512);
    this.n = 0;
    this.level = 0;
  }

  process(inputs) {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    let peak = 0;
    // Average-and-decimate resampler: good enough for speech.
    while (this.pos < ch.length) {
      const start = Math.floor(this.pos);
      const end = Math.min(ch.length, Math.floor(this.pos + this.ratio) || start + 1);
      let sum = 0;
      for (let i = start; i < end; i++) sum += ch[i];
      const v = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
      peak = Math.max(peak, Math.abs(v));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === 512) {
        this.port.postMessage(this.buf.buffer.slice(0));
        this.n = 0;
      }
      this.pos += this.ratio;
    }
    this.pos -= ch.length;
    this.level = Math.max(peak, this.level * 0.85);
    this.port.postMessage({ level: this.level });
    return true;
  }
}
registerProcessor('pcm-worklet', PcmWorklet);
