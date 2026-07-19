/* global AudioWorkletProcessor, registerProcessor, sampleRate */

const TARGET_SAMPLE_RATE_HZ = 16_000;
const FRAME_DURATION_MS = 20;
const FRAME_SAMPLES = (TARGET_SAMPLE_RATE_HZ * FRAME_DURATION_MS) / 1_000;
const FRAME_BYTES = FRAME_SAMPLES * Int16Array.BYTES_PER_ELEMENT;
const MAX_INPUT_CHANNELS = 8;
const MAX_RENDER_QUANTUM_SAMPLES = 4_096;
const MAX_IN_FLIGHT_FRAMES = 8;

function pcmSample(value) {
  const bounded = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return bounded < 0
    ? Math.round(bounded * 32_768)
    : Math.round(bounded * 32_767);
}

class SuitsMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.armed = false;
    this.hasPreviousSample = false;
    this.previousSample = 0;
    this.sourceSampleIndex = 0;
    this.nextOutputPosition = 0;
    this.sourceSamplesPerOutput = sampleRate / TARGET_SAMPLE_RATE_HZ;
    this.outputFrame = new Int16Array(FRAME_SAMPLES);
    this.outputFrameLength = 0;
    this.sequence = 0;
    this.inFlightFrames = 0;
    this.lastAcknowledgedSequence = -1;

    this.port.onmessage = (event) => {
      if (event.data?.type === "stop") {
        this.active = false;
        this.armed = false;
        this.outputFrame.fill(0);
        this.outputFrameLength = 0;
        return;
      }
      if (event.data?.type === "arm" && this.active) {
        if (
          this.armed ||
          event.data.sequence !== 0 ||
          this.sequence !== 0 ||
          this.inFlightFrames !== 0
        ) {
          this.fail("INVALID_CAPTURE_ARM");
          return;
        }
        this.armed = true;
        this.port.postMessage({ type: "worklet_armed", sequence: 0 });
        return;
      }
      if (event.data?.type === "ack_frame" && this.active && this.armed) {
        const acknowledgedSequence = event.data.sequence;
        if (
          !Number.isSafeInteger(acknowledgedSequence) ||
          acknowledgedSequence !== this.lastAcknowledgedSequence + 1 ||
          acknowledgedSequence >= this.sequence ||
          this.inFlightFrames <= 0
        ) {
          this.fail("INVALID_FRAME_ACK");
          return;
        }
        this.lastAcknowledgedSequence = acknowledgedSequence;
        this.inFlightFrames -= 1;
      }
    };

    if (
      !Number.isFinite(this.sourceSamplesPerOutput) ||
      this.sourceSamplesPerOutput <= 0
    ) {
      this.active = false;
      this.port.postMessage({
        type: "worklet_error",
        code: "INVALID_SOURCE_SAMPLE_RATE",
      });
      return;
    }

    this.port.postMessage({
      type: "worklet_ready",
      sourceSampleRateHz: sampleRate,
      sampleRateHz: TARGET_SAMPLE_RATE_HZ,
      channels: 1,
      encoding: "pcm_s16le",
      durationMs: FRAME_DURATION_MS,
      byteLength: FRAME_BYTES,
      maxInFlightFrames: MAX_IN_FLIGHT_FRAMES,
    });
  }

  fail(code) {
    if (!this.active) return false;
    this.active = false;
    this.armed = false;
    this.outputFrame.fill(0);
    this.outputFrameLength = 0;
    this.port.postMessage({ type: "worklet_error", code });
    return false;
  }

  appendOutput(sample) {
    this.outputFrame[this.outputFrameLength] = pcmSample(sample);
    this.outputFrameLength += 1;
    if (this.outputFrameLength !== FRAME_SAMPLES) return true;

    if (this.inFlightFrames >= MAX_IN_FLIGHT_FRAMES) {
      return this.fail("FRAME_CREDIT_OVERRUN");
    }

    const pcm = this.outputFrame;
    this.outputFrame = new Int16Array(FRAME_SAMPLES);
    this.outputFrameLength = 0;
    this.inFlightFrames += 1;
    this.port.postMessage(
      {
        type: "pcm_frame",
        sequence: this.sequence,
        sampleRateHz: TARGET_SAMPLE_RATE_HZ,
        channels: 1,
        encoding: "pcm_s16le",
        durationMs: FRAME_DURATION_MS,
        byteLength: FRAME_BYTES,
        pcm: pcm.buffer,
      },
      [pcm.buffer],
    );
    this.sequence += 1;
    return true;
  }

  resample(sample) {
    if (!this.hasPreviousSample) {
      this.hasPreviousSample = true;
      this.previousSample = sample;
      return true;
    }

    const currentSampleIndex = this.sourceSampleIndex + 1;
    while (this.nextOutputPosition <= currentSampleIndex) {
      const fraction = this.nextOutputPosition - this.sourceSampleIndex;
      const interpolated =
        this.previousSample + (sample - this.previousSample) * fraction;
      if (!this.appendOutput(interpolated)) return false;
      this.nextOutputPosition += this.sourceSamplesPerOutput;
    }
    this.previousSample = sample;
    this.sourceSampleIndex = currentSampleIndex;
    return true;
  }

  process(inputs) {
    if (!this.active) return false;
    if (!this.armed) return true;

    const channels = inputs[0];
    if (channels === undefined || channels.length === 0) return true;

    const channelCount = Math.min(channels.length, MAX_INPUT_CHANNELS);
    const sampleCount = channels[0]?.length ?? 0;
    if (sampleCount > MAX_RENDER_QUANTUM_SAMPLES) {
      this.active = false;
      this.port.postMessage({
        type: "worklet_error",
        code: "INPUT_QUANTUM_TOO_LARGE",
      });
      return false;
    }

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      let mono = 0;
      let contributingChannels = 0;
      for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
        const channel = channels[channelIndex];
        if (channel === undefined || sampleIndex >= channel.length) continue;
        mono += channel[sampleIndex];
        contributingChannels += 1;
      }
      if (contributingChannels > 0) {
        if (!this.resample(mono / contributingChannels)) return false;
      }
    }
    return true;
  }
}

registerProcessor("suits-mic-processor", SuitsMicProcessor);
