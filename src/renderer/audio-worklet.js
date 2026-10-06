// AudioWorkletProcessor that converts incoming Float32 audio frames to Int16
// PCM at the context's sample rate (we create the context at 24 kHz, so the
// output is 24 kHz PCM16 mono — exactly what the Realtime API expects when
// configured with input_audio_format: "pcm16").

class PCMWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    // Emit roughly every 100 ms: 24000 * 0.1 = 2400 samples.
    this.chunkSize = Math.max(960, Math.floor(sampleRate * 0.1));
    this.buffer = new Float32Array(this.chunkSize);
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const samples = input[0]; // Float32Array quantum (usually 128 samples)

    for (let i = 0; i < samples.length; i++) {
      this.buffer[this.offset++] = samples[i];
      if (this.offset >= this.chunkSize) {
        this.flush();
      }
    }
    return true;
  }

  flush() {
    if (this.offset === 0) return;
    const out = new Int16Array(this.offset);
    for (let i = 0; i < this.offset; i++) {
      const s = Math.max(-1, Math.min(1, this.buffer[i]));
      out[i] = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff);
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    this.offset = 0;
  }
}

registerProcessor('pcm-worklet', PCMWorklet);
