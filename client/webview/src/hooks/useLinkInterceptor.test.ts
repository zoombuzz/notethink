import { renderHook } from '@testing-library/react';
import { useLinkInterceptor } from './useLinkInterceptor';

// dispatch a real click on an anchor with the given href and return the message the hook posted (if any)
function clickAnchorWithHref(href: string): { type: string; [key: string]: unknown } | undefined {
    const post_message = jest.fn();
    renderHook(() => useLinkInterceptor(post_message));
    const anchor = document.createElement('a');
    anchor.setAttribute('href', href);
    document.body.appendChild(anchor);
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    document.body.removeChild(anchor);
    return post_message.mock.calls[0]?.[0] as { type: string; [key: string]: unknown } | undefined;
}

describe('useLinkInterceptor', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('posts openExternal for an http link', () => {
        const msg = clickAnchorWithHref('https://example.com/page');
        expect(msg).toEqual({ type: 'openExternal', url: 'https://example.com/page' });
    });

    it('posts openExternal for a mailto link', () => {
        const msg = clickAnchorWithHref('mailto:alex@example.com');
        expect(msg).toEqual({ type: 'openExternal', url: 'mailto:alex@example.com' });
    });

    it('posts openRelative for a relative .md path', () => {
        const msg = clickAnchorWithHref('sibling.md');
        expect(msg).toEqual({ type: 'openRelative', href: 'sibling.md' });
    });

    it('posts openRelative for a relative sub-path', () => {
        const msg = clickAnchorWithHref('main/intro.md');
        expect(msg).toEqual({ type: 'openRelative', href: 'main/intro.md' });
    });

    it('posts openRelative for a non-.md relative path (extension validates and refuses)', () => {
        // the hook forwards every relative href; the host is the single point that validates the .md extension
        const msg = clickAnchorWithHref('image.png');
        expect(msg).toEqual({ type: 'openRelative', href: 'image.png' });
    });

    it('does NOT intercept a `?`-prefixed linetag (left to linetagops)', () => {
        const msg = clickAnchorWithHref('?id=some-story');
        expect(msg).toBeUndefined();
    });

    it('does NOT intercept a bare #fragment', () => {
        const msg = clickAnchorWithHref('#section-two');
        expect(msg).toBeUndefined();
    });
});
