/**
 * AudioWorklet module for opt-in audio capture. It runs in the audio rendering thread, so it holds
 * no DOM, no logging and no imports beyond the pure helpers webpack inlines into its own bundle.
 * Each gated 2 s chunk is posted to the main thread with its PCM16 buffer transferred, not copied.
 */

import { AudioChunker, WORKLET_PROCESSOR_NAME } from './lib/audiochunkops';

declare const sampleRate: number;
declare function registerProcessor(name: string, processor_ctor: unknown): void;
declare class AudioWorkletProcessor {
    readonly port: MessagePort;
}

class ChunkerProcessor extends AudioWorkletProcessor {
    private readonly chunker = new AudioChunker(sampleRate);

    process(inputs: Float32Array[][]): boolean {
        const channels = inputs[0];
        if (!channels || channels.length === 0) {
            return true;
        }
        for (const chunk of this.chunker.push(channels[0])) {
            this.port.postMessage({ chunk_index: chunk.chunk_index, pcm: chunk.pcm.buffer }, [chunk.pcm.buffer]);
        }
        return true;
    }
}

registerProcessor(WORKLET_PROCESSOR_NAME, ChunkerProcessor);
