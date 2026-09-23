import { agentVendorHomeFrom, homeDirectoryFromLogPath } from './agenthomeops';

describe('homeDirectoryFromLogPath', () => {
    it('resolves a Linux Code layout to $HOME', () => {
        expect(homeDirectoryFromLogPath('/home/alex/.config/Code/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/home/alex');
    });

    it('resolves a Linux Code - Insiders layout, the product name never matters', () => {
        expect(homeDirectoryFromLogPath('/home/alex/.config/Code - Insiders/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/home/alex');
    });

    it('resolves a Linux VSCodium layout', () => {
        expect(homeDirectoryFromLogPath('/home/alex/.config/VSCodium/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/home/alex');
    });

    it('resolves a macOS Code layout, two segments below Library', () => {
        expect(homeDirectoryFromLogPath('/Users/alex/Library/Application Support/Code/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/Users/alex');
    });

    it('resolves a Windows Code layout via AppData', () => {
        expect(homeDirectoryFromLogPath('/c:/Users/alex/AppData/Roaming/Code/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/c:/Users/alex');
    });

    it('tolerates a deeper or shallower tail than todays VS Code writes, since it only looks for the anchor segment', () => {
        expect(homeDirectoryFromLogPath('/home/alex/.config/Code/logs/20260922T120000/window3/exthost/webWorker/publisher.NoteThink/some/deeper/notethink-extension.log'))
            .toBe('/home/alex');
    });

    it('returns undefined for a layout with none of the known anchors, such as a web host', () => {
        expect(homeDirectoryFromLogPath('/workspace/logs/notethink-extension.log')).toBeUndefined();
    });
});

describe('agentVendorHomeFrom', () => {
    it('joins the three vendor directories onto the resolved home', () => {
        expect(agentVendorHomeFrom('/home/alex/.config/Code/logs/x/exthost/webWorker/NoteThink.notethink/notethink-extension.log')).toEqual({
            claudeCode: '/home/alex/.claude',
            codex: '/home/alex/.codex',
            grok: '/home/alex/.grok',
        });
    });

    it('is undefined when the home directory could not be resolved', () => {
        expect(agentVendorHomeFrom('/workspace/logs/notethink-extension.log')).toBeUndefined();
    });
});
