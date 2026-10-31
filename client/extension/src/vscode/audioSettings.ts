import * as vscode from 'vscode';
import { writeToErrorLog, writeToLog } from '../lib/errorops';

export const AUDIO_ENDPOINT_CONFIG_ROOT = 'notethink.settings';
export const AUDIO_ENDPOINT_CONFIG_PATH = 'audio.endpoint';
export const AUDIO_ENDPOINT_SETTING_KEY = `${AUDIO_ENDPOINT_CONFIG_ROOT}.${AUDIO_ENDPOINT_CONFIG_PATH}`;
export const AUDIO_ENDPOINT_TOKEN_SECRET_KEY = 'notethink.audio.endpointToken';
export const AUDIO_SET_TOKEN_COMMAND = 'notethink.setAudioEndpointToken';

/**
 * Audio endpoint settings: where the configured endpoint and its optional bearer token are read from.
 *
 * The endpoint is read from the user (global) value only, never the merged value, so a workspace or
 * folder value is ignored even on a host that does not enforce the `application` scope declared in
 * `package.json`. The text returned is trimmed but not validated; validation belongs to `audioops.ts`.
 *
 * The token lives only in the editor's secret storage. It is never written to settings, logs or messages.
 */

/** the endpoint the user set in their own settings, trimmed; empty when unset, not a string, or set only by a workspace */
export function readAudioEndpointSetting(): string {
    const inspected = vscode.workspace.getConfiguration(AUDIO_ENDPOINT_CONFIG_ROOT).inspect<string>(AUDIO_ENDPOINT_CONFIG_PATH);
    const value = inspected?.globalValue;
    return typeof value === 'string' ? value.trim() : '';
}

/** the stored bearer token, or undefined when none is stored */
export async function readAudioEndpointToken(secrets: vscode.SecretStorage): Promise<string | undefined> {
    const token = await secrets.get(AUDIO_ENDPOINT_TOKEN_SECRET_KEY);
    return token === undefined || token === '' ? undefined : token;
}

/**
 * Prompts for the bearer token with a masked input box. A non-empty value is stored, an empty submission
 * deletes the stored token, and dismissing the box (Escape) changes nothing.
 */
export async function promptForAudioEndpointToken(secrets: vscode.SecretStorage): Promise<void> {
    const entered = await vscode.window.showInputBox({
        password: true,
        ignoreFocusOut: true,
        prompt: vscode.l10n.t('Bearer token for the audio endpoint. Leave empty to remove the stored token.'),
        placeHolder: vscode.l10n.t('Token'),
    });
    if (entered === undefined) { return; }
    const token = entered.trim();
    try {
        if (token === '') {
            await secrets.delete(AUDIO_ENDPOINT_TOKEN_SECRET_KEY);
            writeToLog('promptForAudioEndpointToken', 'audio endpoint token removed');
            return;
        }
        await secrets.store(AUDIO_ENDPOINT_TOKEN_SECRET_KEY, token);
        writeToLog('promptForAudioEndpointToken', 'audio endpoint token stored');
    } catch (err) {
        writeToErrorLog('promptForAudioEndpointToken', 'could not update the audio endpoint token', err);
    }
}

/** registers the token command; dispose the result with the extension's other subscriptions */
export function registerAudioEndpointTokenCommand(secrets: vscode.SecretStorage): vscode.Disposable {
    return vscode.commands.registerCommand(AUDIO_SET_TOKEN_COMMAND, () => promptForAudioEndpointToken(secrets));
}

/**
 * Calls `on_change` whenever the endpoint setting or the stored token changes, so the caller can re-read
 * both. The callback carries no value: a caller reads through the functions above rather than from an event.
 */
export function watchAudioEndpointChanges(secrets: vscode.SecretStorage, on_change: () => void): vscode.Disposable {
    const config_watch = vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(AUDIO_ENDPOINT_SETTING_KEY)) { on_change(); }
    });
    const secret_watch = secrets.onDidChange((event) => {
        if (event.key === AUDIO_ENDPOINT_TOKEN_SECRET_KEY) { on_change(); }
    });
    return new vscode.Disposable(() => {
        config_watch.dispose();
        secret_watch.dispose();
    });
}
