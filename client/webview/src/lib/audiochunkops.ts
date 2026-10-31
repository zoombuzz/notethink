/**
 * Pure audio helpers shared by the capture worklet and its Jest tests. No DOM, no Web Audio, no
 * imports, so the worklet bundle carries nothing it cannot run in the audio rendering thread.
 *
 * Gate definition: the 16 kHz stream is cut into 2 s chunks, numbered from 0 for every window
 * whether or not it is sent. Inside a chunk, 100 ms frames are measured by RMS; a frame at or above
 * GATE_RMS_THRESHOLD is active. A chunk is sent when it holds an active frame, or when it starts
 * less than HANGOVER_SAMPLES (1 s) after the end of the most recent active frame. Every other chunk
 * is dropped, and the index still advances so a receiver sees the gap. Because the hangover is
 * checked at the chunk's start, a chunk that follows speech by 1 s or more is dropped even if the
 * speech ended inside the previous chunk's last second.
 *
 * Threshold choice: 0.01 full-scale RMS (-40 dBFS) sits above typical microphone self-noise and room
 * tone yet well below conversational speech, which lands near 0.03 to 0.2. It is a fixed constant,
 * so the gate costs one multiply-add per sample.
 */

export const TARGET_SAMPLE_RATE = 16000;
export const CHUNK_SECONDS = 2;
export const CHUNK_SAMPLES = TARGET_SAMPLE_RATE * CHUNK_SECONDS;
export const CHUNK_BYTES = CHUNK_SAMPLES * 2;
export const FRAME_SAMPLES = TARGET_SAMPLE_RATE / 10;
export const HANGOVER_SAMPLES = TARGET_SAMPLE_RATE;
export const GATE_RMS_THRESHOLD = 0.01;
export const WORKLET_PROCESSOR_NAME = 'notethink-audio-chunker';

/** One chunk the gate let through: its position in the 2 s window sequence and its PCM16LE bytes. */
export interface EmittedChunk {
    chunk_index: number;
    pcm: Uint8Array;
}

/**
 * Convert one float sample in [-1, 1] to a signed 16-bit integer, clipping out-of-range input.
 */
export function floatToPcm16(sample: number): number {
    const clipped = sample > 1 ? 1 : (sample < -1 ? -1 : sample);
    return clipped < 0 ? Math.round(clipped * 32768) : Math.round(clipped * 32767);
}

/**
 * Root-mean-square level of samples[from, to), or 0 for an empty range.
 */
export function rmsOf(samples: Float32Array, from: number, to: number): number {
    if (to <= from) {
        return 0;
    }
    let sum_squares = 0;
    for (let i = from; i < to; i++) {
        sum_squares += samples[i] * samples[i];
    }
    return Math.sqrt(sum_squares / (to - from));
}

/**
 * Write samples as little-endian PCM16 into a fresh buffer of exactly samples.length * 2 bytes.
 */
export function encodePcm16(samples: Float32Array): Uint8Array {
    const bytes = new Uint8Array(samples.length * 2);
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) {
        view.setInt16(i * 2, floatToPcm16(samples[i]), true);
    }
    return bytes;
}

/**
 * Streaming area-average resampler: each output sample is the mean of the input span it covers, so
 * downsampling from 44.1 or 48 kHz gets a box low-pass for free. State carries across process calls.
 * process() returns a view of an internal buffer that the next call overwrites.
 */
export class BoxResampler {
    private readonly ratio: number;
    private acc = 0;
    private acc_weight = 0;
    private scratch = new Float32Array(0);

    constructor(input_rate: number, output_rate: number = TARGET_SAMPLE_RATE) {
        if (!(input_rate > 0) || !(output_rate > 0)) {
            throw new RangeError(`invalid sample rate ${input_rate} -> ${output_rate}`);
        }
        this.ratio = input_rate / output_rate;
    }

    process(input: Float32Array): Float32Array {
        const needed = Math.ceil(input.length / this.ratio) + 2;
        if (this.scratch.length < needed) {
            this.scratch = new Float32Array(needed);
        }
        let out_count = 0;
        for (let i = 0; i < input.length; i++) {
            let weight_left = 1;
            while (weight_left > 0) {
                const need = this.ratio - this.acc_weight;
                if (weight_left < need) {
                    this.acc += input[i] * weight_left;
                    this.acc_weight += weight_left;
                    weight_left = 0;
                } else {
                    this.acc += input[i] * need;
                    this.scratch[out_count++] = this.acc / this.ratio;
                    weight_left -= need;
                    this.acc = 0;
                    this.acc_weight = 0;
                }
            }
        }
        return this.scratch.subarray(0, out_count);
    }
}

/**
 * Collects 16 kHz samples into 2 s windows and applies the energy gate described in the file header.
 * push() returns the chunks that completed during the call and passed the gate.
 */
export class ChunkAssembler {
    private readonly window = new Float32Array(CHUNK_SAMPLES);
    private filled = 0;
    private next_index = 0;
    private last_active_end = -Infinity;

    push(samples: Float32Array): EmittedChunk[] {
        const emitted: EmittedChunk[] = [];
        let offset = 0;
        while (offset < samples.length) {
            const take = Math.min(CHUNK_SAMPLES - this.filled, samples.length - offset);
            this.window.set(samples.subarray(offset, offset + take), this.filled);
            this.filled += take;
            offset += take;
            if (this.filled === CHUNK_SAMPLES) {
                const chunk = this.closeWindow();
                if (chunk) {
                    emitted.push(chunk);
                }
            }
        }
        return emitted;
    }

    /** The index the next completed window will carry. */
    get windowsClosed(): number {
        return this.next_index;
    }

    private closeWindow(): EmittedChunk | undefined {
        const chunk_index = this.next_index++;
        this.filled = 0;
        const chunk_start = chunk_index * CHUNK_SAMPLES;
        const frame_end = this.lastActiveFrameEnd(chunk_start);
        if (frame_end !== undefined) {
            this.last_active_end = frame_end;
        } else if (chunk_start - this.last_active_end >= HANGOVER_SAMPLES) {
            return undefined;
        }
        return { chunk_index, pcm: encodePcm16(this.window) };
    }

    private lastActiveFrameEnd(chunk_start: number): number | undefined {
        let last_end: number | undefined;
        for (let from = 0; from < CHUNK_SAMPLES; from += FRAME_SAMPLES) {
            if (rmsOf(this.window, from, from + FRAME_SAMPLES) >= GATE_RMS_THRESHOLD) {
                last_end = chunk_start + from + FRAME_SAMPLES;
            }
        }
        return last_end;
    }
}

/**
 * The worklet's whole job in one object: device-rate samples in, gated 16 kHz PCM16 chunks out.
 */
export class AudioChunker {
    private readonly resampler: BoxResampler;
    private readonly assembler = new ChunkAssembler();

    constructor(input_rate: number) {
        this.resampler = new BoxResampler(input_rate);
    }

    push(input: Float32Array): EmittedChunk[] {
        return this.assembler.push(this.resampler.process(input));
    }

    get windowsClosed(): number {
        return this.assembler.windowsClosed;
    }
}
