import Debug from 'debug';
import { useEffect } from 'react';

const debug = Debug("nodejs:notethink:useLinkInterceptor");

// intercept link clicks and open via the extension host (works in desktop and web VS Code)
export function useLinkInterceptor(postMessage: (message: unknown) => void): void {
    useEffect(() => {
        const handleLinkClick = (event: MouseEvent): void => {
            try {
                const target = event.target as HTMLElement | null;
                if (!target?.closest) { return; }
                const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
                if (!anchor) { return; }
                const url = anchor.getAttribute('href');
                if (!url) { return; }
                // only intercept external URLs (http/https/mailto)
                if (/^https?:\/\/|^mailto:/i.test(url)) {
                    event.preventDefault();
                    event.stopPropagation();
                    postMessage({ type: 'openExternal', url });
                }
            } catch (err) {
                debug('handleLinkClick failed: %O', err);
            }
        };
        document.addEventListener('click', handleLinkClick, true);
        return () => document.removeEventListener('click', handleLinkClick, true);
    }, [postMessage]);
}
