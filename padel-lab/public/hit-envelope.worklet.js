// Audio worklet: emits the high-passed energy of the signal in 256-sample hops.
// The main thread turns this into a loudness envelope in media time.
const HOPS_PER_MESSAGE = 16;

class HitEnvelope extends AudioWorkletProcessor {
  constructor() {
    super();
    this.prev = 0;
    this.acc = 0;
    this.blocks = 0;
    this.buf = new Float32Array(HOPS_PER_MESSAGE);
    this.n = 0;
    this.start = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const len = 128;
    if (this.blocks === 0 && this.n === 0) this.start = currentTime;
    let e = 0;
    if (input && input.length > 0) {
      const nCh = input.length;
      let prev = this.prev;
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (let c = 0; c < nCh; c++) s += input[c][i];
        s /= nCh;
        const d = s - prev; // first difference: a cheap high-pass
        prev = s;
        e += d * d;
      }
      this.prev = prev;
    }
    this.acc += e;
    if (++this.blocks === 2) {
      this.buf[this.n++] = this.acc / (2 * len);
      this.acc = 0;
      this.blocks = 0;
      if (this.n === HOPS_PER_MESSAGE) {
        this.port.postMessage({ t: this.start, hop: (2 * len) / sampleRate, v: this.buf.slice() });
        this.n = 0;
      }
    }
    return true;
  }
}

registerProcessor('hit-envelope', HitEnvelope);
