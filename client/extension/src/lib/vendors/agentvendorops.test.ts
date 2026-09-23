import { capabilitiesForVendor } from './agentvendorops';

describe('capabilitiesForVendor', () => {
    it('reports live_tool_call and file_attribution as supported for claude-code, question unsupported', () => {
        expect(capabilitiesForVendor('claude-code')).toEqual({
            live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported',
        });
    });

    it('reports grok can name a tool and a question but never a file it touched', () => {
        expect(capabilitiesForVendor('grok')).toEqual({
            live_tool_call: 'supported', question: 'supported', file_attribution: 'unsupported',
        });
    });

    it('an unknown vendor reports nothing, honestly, rather than guessing', () => {
        expect(capabilitiesForVendor('some-future-vendor')).toEqual({});
    });
});
