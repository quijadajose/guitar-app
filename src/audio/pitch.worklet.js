const HOP = 1024;

class PitchCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = new Float32Array(HOP);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let offset = 0;
    while (offset < channel.length) {
      const room = HOP - this.filled;
      const take = Math.min(room, channel.length - offset);
      this.pending.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === HOP) {
        this.port.postMessage(this.pending.slice());
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pitch-capture', PitchCaptureProcessor);
