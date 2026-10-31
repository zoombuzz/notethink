import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { buildSettingsCascadePayload } from '../lib/settings';
import { writeToErrorLog, writeToLog } from '../lib/errorops';
import {
    AUDIO_ENDPOINT_SETTING_KEY,
    AUDIO_ENDPOINT_TOKEN_SECRET_KEY,
    AUDIO_SET_TOKEN_COMMAND,
    promptForAudioEndpointToken,
    readAudioEndpointSetting,
    readAudioEndpointToken,
    registerAudioEndpointTokenCommand,
    watchAudioEndpointChanges,
} from './audioSettings';

jest.mock('../lib/errorops', () => ({
    writeToLog: jest.fn(),
    writeToErrorLog: jest.fn(),
    writeToLogAtLevel: jest.fn(),
}));

const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', '..', '..', 'package.json');
const PACKAGE_NLS_PATHS = ['', '.de', '.es', '.fr', '.it'].map(suffix => path.join(__dirname, '..', '..', '..', '..', `package.nls${suffix}.json`));
const CONFIG_PATH = 'audio.endpoint';
const EXAMPLE_ENDPOINT = 'https://transcribe.example.com';
const SECRET_TOKEN = 'secret-token-value';

interface FakeInspect {
    workspaceValue?: unknown;
    workspaceFolderValue?: unknown;
    globalValue?: unknown;
}

function mockInspect(entry: FakeInspect | undefined): void {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        // the merged value a plain get() would return, to prove the reader never uses it
        get: () => entry?.workspaceFolderValue ?? entry?.workspaceValue ?? entry?.globalValue ?? '',
        inspect: (config_path: string) => (config_path === CONFIG_PATH ? entry : undefined),
        update: jest.fn(async () => {}),
    });
}

function fakeSecrets(): { secrets: vscode.SecretStorage; store: jest.Mock; remove: jest.Mock; get: jest.Mock; fire: (key: string) => void } {
    const listeners: Array<(e: { key: string }) => void> = [];
    const store = jest.fn(async () => {});
    const remove = jest.fn(async () => {});
    const get = jest.fn(async (): Promise<string | undefined> => undefined);
    const secrets = {
        get,
        store,
        delete: remove,
        onDidChange: (listener: (e: { key: string }) => void) => {
            listeners.push(listener);
            return new vscode.Disposable(() => { listeners.splice(listeners.indexOf(listener), 1); });
        },
    } as unknown as vscode.SecretStorage;
    return { secrets, store, remove, get, fire: (key: string) => listeners.forEach(listener => listener({ key })) };
}

describe('readAudioEndpointSetting', () => {
    it('is empty when nothing is set', () => {
        mockInspect(undefined);
        expect(readAudioEndpointSetting()).toBe('');
    });

    it('ignores a workspace value', () => {
        mockInspect({ workspaceValue: EXAMPLE_ENDPOINT });
        expect(readAudioEndpointSetting()).toBe('');
    });

    it('ignores a workspace folder value', () => {
        mockInspect({ workspaceFolderValue: EXAMPLE_ENDPOINT });
        expect(readAudioEndpointSetting()).toBe('');
    });

    it('returns the user value trimmed', () => {
        mockInspect({ globalValue: `  ${EXAMPLE_ENDPOINT}\n` });
        expect(readAudioEndpointSetting()).toBe(EXAMPLE_ENDPOINT);
    });

    it('keeps the user value when a workspace sets a different one', () => {
        mockInspect({ globalValue: EXAMPLE_ENDPOINT, workspaceValue: 'http://127.0.0.1:9' });
        expect(readAudioEndpointSetting()).toBe(EXAMPLE_ENDPOINT);
    });

    it('is empty when the user value is not a string', () => {
        mockInspect({ globalValue: 42 });
        expect(readAudioEndpointSetting()).toBe('');
    });
});

describe('readAudioEndpointToken', () => {
    it('returns the stored token, and undefined for none or an empty one', async () => {
        const { secrets, get } = fakeSecrets();
        get.mockResolvedValueOnce(SECRET_TOKEN);
        expect(await readAudioEndpointToken(secrets)).toBe(SECRET_TOKEN);
        get.mockResolvedValueOnce('');
        expect(await readAudioEndpointToken(secrets)).toBeUndefined();
        expect(await readAudioEndpointToken(secrets)).toBeUndefined();
        expect(get).toHaveBeenCalledWith(AUDIO_ENDPOINT_TOKEN_SECRET_KEY);
    });
});

describe('promptForAudioEndpointToken', () => {
    beforeEach(() => {
        (vscode.window.showInputBox as jest.Mock).mockReset();
        (writeToLog as jest.Mock).mockClear();
        (writeToErrorLog as jest.Mock).mockClear();
    });

    it('asks for the token in a masked input box', async () => {
        const { secrets } = fakeSecrets();
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
        await promptForAudioEndpointToken(secrets);
        expect(vscode.window.showInputBox).toHaveBeenCalledWith(expect.objectContaining({ password: true }));
    });

    it('stores a non-empty token trimmed, and never logs it', async () => {
        const { secrets, store, remove } = fakeSecrets();
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue(`  ${SECRET_TOKEN} `);
        await promptForAudioEndpointToken(secrets);
        expect(store).toHaveBeenCalledWith(AUDIO_ENDPOINT_TOKEN_SECRET_KEY, SECRET_TOKEN);
        expect(remove).not.toHaveBeenCalled();
        const logged = JSON.stringify([...(writeToLog as jest.Mock).mock.calls, ...(writeToErrorLog as jest.Mock).mock.calls]);
        expect(logged).not.toContain(SECRET_TOKEN);
    });

    it('deletes the stored token on an empty submission', async () => {
        const { secrets, store, remove } = fakeSecrets();
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue('');
        await promptForAudioEndpointToken(secrets);
        expect(remove).toHaveBeenCalledWith(AUDIO_ENDPOINT_TOKEN_SECRET_KEY);
        expect(store).not.toHaveBeenCalled();
    });

    it('treats a whitespace-only submission as empty', async () => {
        const { secrets, store, remove } = fakeSecrets();
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue('   ');
        await promptForAudioEndpointToken(secrets);
        expect(remove).toHaveBeenCalledTimes(1);
        expect(store).not.toHaveBeenCalled();
    });

    it('changes nothing when the box is dismissed', async () => {
        const { secrets, store, remove } = fakeSecrets();
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue(undefined);
        await promptForAudioEndpointToken(secrets);
        expect(store).not.toHaveBeenCalled();
        expect(remove).not.toHaveBeenCalled();
    });

    it('logs a storage failure without the token', async () => {
        const { secrets, store } = fakeSecrets();
        store.mockRejectedValueOnce(new Error('storage unavailable'));
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue(SECRET_TOKEN);
        await promptForAudioEndpointToken(secrets);
        expect(writeToErrorLog).toHaveBeenCalledTimes(1);
        expect(JSON.stringify((writeToErrorLog as jest.Mock).mock.calls)).not.toContain(SECRET_TOKEN);
    });
});

describe('registerAudioEndpointTokenCommand', () => {
    it('registers the command id and runs the prompt', async () => {
        const { secrets, remove } = fakeSecrets();
        (vscode.commands.registerCommand as jest.Mock).mockClear();
        (vscode.window.showInputBox as jest.Mock).mockResolvedValue('');
        registerAudioEndpointTokenCommand(secrets);
        const [command_id, handler] = (vscode.commands.registerCommand as jest.Mock).mock.calls[0] as [string, () => Promise<void>];
        expect(command_id).toBe(AUDIO_SET_TOKEN_COMMAND);
        await handler();
        expect(remove).toHaveBeenCalledTimes(1);
    });
});

describe('watchAudioEndpointChanges', () => {
    it('fires for the endpoint setting and the token secret only, and stops once disposed', () => {
        const { secrets, fire } = fakeSecrets();
        let config_listener: (e: vscode.ConfigurationChangeEvent) => void = () => {};
        const config_dispose = jest.fn();
        (vscode.workspace.onDidChangeConfiguration as jest.Mock).mockImplementationOnce((listener: typeof config_listener) => {
            config_listener = listener;
            return { dispose: config_dispose };
        });
        const on_change = jest.fn();
        const watch = watchAudioEndpointChanges(secrets, on_change);
        config_listener({ affectsConfiguration: (key: string) => key === AUDIO_ENDPOINT_SETTING_KEY } as vscode.ConfigurationChangeEvent);
        expect(on_change).toHaveBeenCalledTimes(1);
        config_listener({ affectsConfiguration: () => false } as vscode.ConfigurationChangeEvent);
        expect(on_change).toHaveBeenCalledTimes(1);
        fire('some.other.secret');
        expect(on_change).toHaveBeenCalledTimes(1);
        fire(AUDIO_ENDPOINT_TOKEN_SECRET_KEY);
        expect(on_change).toHaveBeenCalledTimes(2);
        watch.dispose();
        fire(AUDIO_ENDPOINT_TOKEN_SECRET_KEY);
        expect(on_change).toHaveBeenCalledTimes(2);
        expect(config_dispose).toHaveBeenCalledTimes(1);
    });
});

describe('the endpoint stays out of the webview settings cascade', () => {
    it('carries no audio key and no endpoint value in the payload', () => {
        const entry = { globalValue: EXAMPLE_ENDPOINT, workspaceValue: 'http://127.0.0.1:9' };
        (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
            get: (config_path: string, default_value: unknown) => (config_path === CONFIG_PATH ? entry.workspaceValue : default_value),
            inspect: (config_path: string) => (config_path === CONFIG_PATH ? entry : undefined),
            update: jest.fn(async () => {}),
        });
        const serialised = JSON.stringify(buildSettingsCascadePayload());
        expect(serialised).not.toContain('audio');
        expect(serialised).not.toContain('transcribe.example.com');
        expect(serialised).not.toContain('127.0.0.1');
    });
});

describe('package.json declarations', () => {
    const manifest = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
        contributes: {
            commands: Array<{ command: string; title: string }>;
            configuration: Array<{ properties: Record<string, { type?: string; scope?: string; default?: unknown; description?: string }> }>;
        };
    };
    const properties = Object.assign({}, ...manifest.contributes.configuration.map(section => section.properties)) as typeof manifest.contributes.configuration[number]['properties'];

    it('declares the endpoint as an application-scoped string defaulting to empty', () => {
        expect(properties[AUDIO_ENDPOINT_SETTING_KEY]).toMatchObject({ type: 'string', scope: 'application', default: '' });
    });

    it('declares the token command with an nls title', () => {
        const command = manifest.contributes.commands.find(c => c.command === AUDIO_SET_TOKEN_COMMAND);
        expect(command?.title).toBe('%command.setAudioEndpointToken%');
    });

    it('translates the setting description and command title in all five nls files', () => {
        const description_key = properties[AUDIO_ENDPOINT_SETTING_KEY].description?.slice(1, -1) ?? '';
        const bundles = PACKAGE_NLS_PATHS.map(p => JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, string>);
        for (const bundle of bundles) {
            expect(bundle[description_key]).toBeTruthy();
            expect(bundle['command.setAudioEndpointToken']).toBeTruthy();
        }
        const english = bundles[0];
        for (const bundle of bundles.slice(1)) {
            expect(bundle[description_key]).not.toBe(english[description_key]);
            expect(bundle['command.setAudioEndpointToken']).not.toBe(english['command.setAudioEndpointToken']);
        }
    });
});
