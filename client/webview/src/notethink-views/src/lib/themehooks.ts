import { useEffect, useState } from "react";
import { detectVscodeTheme } from "./originops";

/**
 * The editor's current light or dark theme, re-read when VS Code swaps its theme class on `<body>`
 * (which it does with no reload), so anything coloured per theme stays readable after a toggle.
 */
export function useVscodeTheme(): 'dark' | 'light' {
    const [theme, setTheme] = useState<'dark' | 'light'>(detectVscodeTheme);
    useEffect(() => {
        if (typeof document === 'undefined' || !document.body) { return; }
        const observer = new MutationObserver(() => {
            setTheme(detectVscodeTheme());
        });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
        return () => observer.disconnect();
    }, []);
    return theme;
}
