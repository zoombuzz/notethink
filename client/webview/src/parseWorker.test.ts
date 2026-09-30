import { handleParseWorkerRequest } from './parseWorker';
import * as parseops from './lib/parseops';

// mirrors client/extension/src/vscode/ParseWorker.test.ts, the extension-host analogue of this module
describe('handleParseWorkerRequest', () => {
    it('parses the given text and returns mdast identical to calling parse() directly, carrying id and hash through', () => {
        const text = '# Heading\n\nSome paragraph text with **bold**.';
        const response = handleParseWorkerRequest({ id: 'doc-1', hash: 'h1', text });
        expect(response.id).toBe('doc-1');
        expect(response.hash).toBe('h1');
        expect('content' in response && response.content).toEqual(parseops.parse(text));
    });

    it('carries id and hash through on an empty document', () => {
        const response = handleParseWorkerRequest({ id: 'doc-2', hash: 'h2', text: '' });
        expect(response.id).toBe('doc-2');
        expect('content' in response && response.content).toEqual(parseops.parse(''));
    });

    // parse() never throws on ordinary text; this exercises the catch path via a mock, not a real failure
    it('returns an error field rather than throwing when parse() itself throws', () => {
        const spy = jest.spyOn(parseops, 'parse').mockImplementation(() => { throw new Error('boom'); });
        const response = handleParseWorkerRequest({ id: 'doc-3', hash: 'h3', text: 'x' });
        expect('error' in response && response.error).toBe('boom');
        spy.mockRestore();
    });
});
