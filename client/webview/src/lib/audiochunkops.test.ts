import {
    AudioChunker,
    BoxResampler,
    CHUNK_BYTES,
    CHUNK_SAMPLES,
    ChunkAssembler,
    type EmittedChunk,
    FRAME_SAMPLES,
    HANGOVER_SAMPLES,
    TARGET_SAMPLE_RATE,
    encodePcm16,
    floatToPcm16,
    rmsOf,
} from './audiochunkops';

const QUANTUM = 128;

/** Feed `seconds` of a sine (or silence when amplitude is 0) at `rate` through a chunker, 128 samples at a time. */
function feed(chunker: AudioChunker, rate: number, seconds: number, amplitude: number, start_sample = 0): EmittedChunk[] {
    const total = Math.round(rate * seconds);
    const emitted: EmittedChunk[] = [];
    const block = new Float32Array(QUANTUM);
    for (let offset = 0; offset < total; offset += QUANTUM) {
        const n = Math.min(QUANTUM, total - offset);
        for (let i = 0; i < n; i++) {
            block[i] = amplitude * Math.sin(2 * Math.PI * 440 * (start_sample + offset + i) / rate);
        }
        emitted.push(...chunker.push(block.subarray(0, n)));
    }
    return emitted;
}

describe('floatToPcm16', () => {
    it('maps full scale and zero, clipping out of range input', () => {
        expect(floatToPcm16(0)).toBe(0);
        expect(floatToPcm16(1)).toBe(32767);
        expect(floatToPcm16(-1)).toBe(-32768);
        expect(floatToPcm16(5)).toBe(32767);
        expect(floatToPcm16(-5)).toBe(-32768);
    });
});

describe('rmsOf', () => {
    it('is the amplitude over root two for a sine and 0 for an empty range', () => {
        const sine = new Float32Array(TARGET_SAMPLE_RATE);
        for (let i = 0; i < sine.length; i++) {
            sine[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / TARGET_SAMPLE_RATE);
        }
        expect(rmsOf(sine, 0, sine.length)).toBeCloseTo(0.5 / Math.SQRT2, 3);
        expect(rmsOf(sine, 10, 10)).toBe(0);
    });
});

describe('encodePcm16', () => {
    it('writes little-endian int16 and sizes the buffer at two bytes per sample', () => {
        const bytes = encodePcm16(Float32Array.from([1, -1, 0]));
        expect(bytes.length).toBe(6);
        expect(Array.from(bytes)).toEqual([0xff, 0x7f, 0x00, 0x80, 0x00, 0x00]);
    });
});

describe('BoxResampler', () => {
    it('produces exactly one third as many samples from 48 kHz and keeps a DC level', () => {
        const resampler = new BoxResampler(48000);
        const out = resampler.process(new Float32Array(48000).fill(0.25));
        expect(out.length).toBe(16000);
        expect(out[0]).toBeCloseTo(0.25, 6);
        expect(out[15999]).toBeCloseTo(0.25, 6);
    });

    it('carries state across calls, so split input yields the same count as one call', () => {
        const resampler = new BoxResampler(44100);
        let total = 0;
        for (let i = 0; i < 441; i++) {
            total += resampler.process(new Float32Array(100)).length;
        }
        expect(Math.abs(total - 16000)).toBeLessThanOrEqual(1);
    });

    it('rejects a non-positive rate', () => {
        expect(() => new BoxResampler(0)).toThrow(RangeError);
    });
});

describe('ChunkAssembler gate', () => {
    it('600 s of tone at 48 kHz yields 300 chunks, indices 0..299 with none missing, 64000 bytes each', () => {
        const chunks = feed(new AudioChunker(48000), 48000, 600, 0.3);
        expect(chunks.length).toBe(300);
        expect(chunks.map((c) => c.chunk_index)).toEqual(Array.from({ length: 300 }, (_, i) => i));
        expect(chunks.every((c) => c.pcm.length === CHUNK_BYTES)).toBe(true);
    });

    it('600 s of tone at 44.1 kHz stays within one chunk of 300 and has no index gaps', () => {
        const chunks = feed(new AudioChunker(44100), 44100, 600, 0.3);
        expect(chunks.length).toBeGreaterThanOrEqual(299);
        expect(chunks.length).toBeLessThanOrEqual(300);
        chunks.forEach((c, i) => expect(c.chunk_index).toBe(i));
    });

    it('600 s of silence yields no chunks at all', () => {
        const chunker = new AudioChunker(48000);
        expect(feed(chunker, 48000, 600, 0).length).toBe(0);
        expect(chunker.windowsClosed).toBe(300);
    });

    it('sub-threshold noise (0.005 amplitude) stays gated', () => {
        expect(feed(new AudioChunker(48000), 48000, 20, 0.005).length).toBe(0);
    });

    it('sends the speech chunk and the hangover chunk, then drops the rest, with indices that keep rising', () => {
        const chunker = new AudioChunker(48000);
        const speech = feed(chunker, 48000, 2, 0.3);
        const silence = feed(chunker, 48000, 10, 0);
        expect(speech.map((c) => c.chunk_index)).toEqual([0]);
        expect(silence.map((c) => c.chunk_index)).toEqual([1]);
        const resumed = feed(chunker, 48000, 2, 0.3, 0);
        expect(resumed.map((c) => c.chunk_index)).toEqual([6]);
    });

    it('drops a silent chunk that starts one second or more after the last active frame', () => {
        const assembler = new ChunkAssembler();
        const speech_head = new Float32Array(CHUNK_SAMPLES);
        speech_head.fill(0.3, 0, FRAME_SAMPLES);
        expect(assembler.push(speech_head).map((c) => c.chunk_index)).toEqual([0]);
        const quiet_chunk = new Float32Array(CHUNK_SAMPLES);
        const result = assembler.push(quiet_chunk);
        const gap = CHUNK_SAMPLES - FRAME_SAMPLES;
        expect(gap >= HANGOVER_SAMPLES).toBe(true);
        expect(result.length).toBe(0);
    });

    it('sends a silent chunk that starts less than one second after the last active frame', () => {
        const assembler = new ChunkAssembler();
        const speech_tail = new Float32Array(CHUNK_SAMPLES);
        speech_tail.fill(0.3, CHUNK_SAMPLES - FRAME_SAMPLES);
        assembler.push(speech_tail);
        expect(assembler.push(new Float32Array(CHUNK_SAMPLES)).map((c) => c.chunk_index)).toEqual([1]);
    });
});
