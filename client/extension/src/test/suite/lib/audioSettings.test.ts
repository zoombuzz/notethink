import * as assert from 'assert';
import * as vscode from 'vscode';
import { AUDIO_ENDPOINT_CONFIG_PATH, AUDIO_ENDPOINT_CONFIG_ROOT, readAudioEndpointSetting } from '../../../vscode/audioSettings';

const EXAMPLE_ENDPOINT = 'https://transcribe.example.com';

suite('Audio endpoint setting', () => {
    test('a workspace-scoped value has no effect on the reader', async () => {
        const config = vscode.workspace.getConfiguration(AUDIO_ENDPOINT_CONFIG_ROOT);
        try {
            // a host enforcing application scope refuses this write; one that does not stores it, and the reader must still ignore it
            await config.update(AUDIO_ENDPOINT_CONFIG_PATH, EXAMPLE_ENDPOINT, vscode.ConfigurationTarget.Workspace);
        } catch {
            // refusing the write is the scope doing its job
        }
        try {
            assert.strictEqual(readAudioEndpointSetting(), '');
        } finally {
            try {
                await config.update(AUDIO_ENDPOINT_CONFIG_PATH, undefined, vscode.ConfigurationTarget.Workspace);
            } catch {
                // nothing was stored to clear
            }
        }
    });
});
