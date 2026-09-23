/**
 * Where each vendor's own session files live, derived from `context.logUri` rather than from any
 * API that hands back $HOME directly, because there is none: this is a web extension and Node's own
 * `os.homedir()` is not among the fallbacks webpack polyfills for it.
 *
 * VS Code's own user-data directory is itself built from $HOME on every desktop layout this analyser
 * recognises (`$HOME/.config/<product>` on Linux, `$HOME/Library/Application Support/<product>` on
 * macOS, `$HOME\AppData\Roaming\<product>` on Windows), and `logUri` sits a few versioned segments
 * below it (`.../logs/<session>/exthost/webWorker/<extension-id>/...`, CODING_STANDARDS.md > Reading
 * VS Code logs). Walking up to the anchor segment that names the platform's user-data root and
 * stopping there gives $HOME back, regardless of which product (Code, Code - Insiders, VSCodium) or
 * which extension-host log-path shape a later VS Code version uses under it, so this needs no
 * per-product name list and no re-derivation when VS Code adds a segment to the log path.
 *
 * A web host (vscode.dev, notegit's workbench) has no local disk at all, so this returns undefined
 * there; the caller reports the analyser unavailable rather than guessing.
 */

const HOME_ANCHORS = ['.config', 'Library', 'AppData'] as const;

/** the OS home directory this desktop host runs under, or undefined when `log_uri` does not resolve to one of the platform layouts this analyser recognises */
export function homeDirectoryFromLogPath(log_path: string): string | undefined {
    const segments = log_path.split('/').filter(segment => segment.length > 0);
    for (let i = segments.length - 1; i >= 0; i--) {
        if ((HOME_ANCHORS as readonly string[]).includes(segments[i])) {
            return `/${segments.slice(0, i).join('/')}`;
        }
    }
    return undefined;
}

/** the three directories this analyser reads, joined onto the resolved home; absent when `homeDirectoryFromLogPath` could not resolve one */
export interface AgentVendorHome {
    claudeCode: string;
    codex: string;
    grok: string;
}

export function agentVendorHomeFrom(log_path: string): AgentVendorHome | undefined {
    const home = homeDirectoryFromLogPath(log_path);
    if (!home) { return undefined; }
    return {
        claudeCode: `${home}/.claude`,
        codex: `${home}/.codex`,
        grok: `${home}/.grok`,
    };
}
