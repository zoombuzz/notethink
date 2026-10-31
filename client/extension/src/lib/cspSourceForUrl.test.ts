import { cspSourceForUrl } from './cspSourceForUrl';

describe('cspSourceForUrl', () => {
    it('wildcards the first label of VS Code\'s webview resource host and keeps the exact path', () => {
        const url = 'https://file%2B.vscode-resource.vscode-cdn.net/home/dev/.vscode/extensions/notethink-dev/client/webview/dist/audioWorklet.js';
        expect(cspSourceForUrl(url)).toBe('https://*.vscode-resource.vscode-cdn.net/home/dev/.vscode/extensions/notethink-dev/client/webview/dist/audioWorklet.js');
    });

    it('produces no % or + in the host, which a browser would drop as an invalid source', () => {
        const source = cspSourceForUrl('https://file%2B.vscode-resource.vscode-cdn.net/a/b.js');
        expect(new URL(source.replace('*', 'x')).hostname).toMatch(/^[a-z0-9.-]+$/);
    });

    it('keeps a host that is already valid in a CSP source', () => {
        expect(cspSourceForUrl('https://cdn.example.com/dist/worklet.js')).toBe('https://cdn.example.com/dist/worklet.js');
    });

    it('drops the query and fragment', () => {
        expect(cspSourceForUrl('https://cdn.example.com/dist/worklet.js?v=123#x')).toBe('https://cdn.example.com/dist/worklet.js');
    });

    it('keeps a non-default port', () => {
        expect(cspSourceForUrl('https://localhost:8443/dist/worklet.js')).toBe('https://localhost:8443/dist/worklet.js');
    });

    it('keeps the path percent-encoded as given', () => {
        expect(cspSourceForUrl('https://cdn.example.com/my%20dir/worklet.js')).toBe('https://cdn.example.com/my%20dir/worklet.js');
    });

    it('leaves a host-less file URL unchanged', () => {
        expect(cspSourceForUrl('file:///mock/extension/client/webview/dist/audioWorklet.js')).toBe('file:///mock/extension/client/webview/dist/audioWorklet.js');
    });

    it('returns an empty string when no valid host can be built', () => {
        expect(cspSourceForUrl('https://file+host/dist/worklet.js')).toBe('');
        expect(cspSourceForUrl('https://a+b.c_d.example/dist/worklet.js')).toBe('');
    });
});
