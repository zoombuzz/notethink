const CSP_HOST = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$/;

/**
 * Turn a resource URL into a CSP source expression that matches that one file.
 *
 * A CSP host may hold only letters, digits, hyphens and dots, and a source with any other character
 * is dropped by the browser as invalid. VS Code's webview resource host (`file+.vscode-resource.vscode-cdn.net`,
 * written `file%2B...` by `asWebviewUri`) is such a host, so naming a file by its webview URL allows nothing.
 * A host like that has its first label replaced by a wildcard while the path stays exact, so the source
 * still names one file. The query and fragment are left out, since source matching ignores them.
 * Returns an empty string when no valid source can be built, so the policy allows nothing extra.
 */
export function cspSourceForUrl(resource_url: string): string {
    const url = new URL(resource_url);
    const host = cspHost(url.hostname);
    if (host === undefined) {
        return '';
    }
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${host}${port}${url.pathname}`;
}

function cspHost(hostname: string): string | undefined {
    if (hostname === '' || CSP_HOST.test(hostname)) {
        return hostname;
    }
    const rest = hostname.slice(hostname.indexOf('.') + 1);
    return hostname.includes('.') && CSP_HOST.test(rest) ? `*.${rest}` : undefined;
}
