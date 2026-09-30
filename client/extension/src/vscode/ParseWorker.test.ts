import { handleParseWorkerRequest } from './ParseWorker';
import * as parseops from '../lib/parseops';

describe('handleParseWorkerRequest', () => {
    it('parses the given text and returns mdast identical to calling parse() directly', () => {
        const text = '# Heading\n\nSome paragraph text with **bold**.';
        const response = handleParseWorkerRequest({ request_id: 'r1', text });
        expect(response.request_id).toBe('r1');
        expect('mdast' in response && response.mdast).toEqual(parseops.parse(text));
    });

    it('carries the request_id through on an empty document', () => {
        const response = handleParseWorkerRequest({ request_id: 'r2', text: '' });
        expect(response.request_id).toBe('r2');
        expect('mdast' in response && response.mdast).toEqual(parseops.parse(''));
    });

    // parse() never throws on ordinary text, so this mocks it to exercise the catch path's own response shape
    it('returns an error field rather than throwing when parse() itself throws', () => {
        const spy = jest.spyOn(parseops, 'parse').mockImplementation(() => { throw new Error('boom'); });
        const response = handleParseWorkerRequest({ request_id: 'r3', text: 'x' });
        expect('error' in response && response.error).toBe('boom');
        spy.mockRestore();
    });
});
