import Debug from "debug";
import * as path from 'path';
import * as vscode from 'vscode';

const debug = Debug("nodejs:notethink:pathops");

interface IsPathWithinOptions {
    requireExtension?: string;
}

// security-critical workspace-containment check: a target is within a root iff path.relative(root, target) is '' (equal) or a non-absolute relative path that does not climb out via '..' — this rejects '..' traversal and sibling-prefix escapes (/ws-evil is NOT within /ws) which a naive startsWith would let through. Inputs are always POSIX uri.path strings (forward-slash, no drive letter), so the math runs through path.posix and stays correct on every host OS, not just where node's path module happens to be posix
export function isPathWithin(
    target_path: string,
    root_paths: string[],
    options?: IsPathWithinOptions,
): boolean {
    // fail closed: empty/whitespace target or no roots is never containable
    if (!target_path || target_path.trim() === '') {
        debug('rejecting empty target path');
        return false;
    }
    if (!root_paths || root_paths.length === 0) {
        debug('rejecting empty root paths');
        return false;
    }
    const require_extension = options?.requireExtension;
    if (require_extension) {
        if (!target_path.toLowerCase().endsWith(require_extension.toLowerCase())) {
            debug('rejecting target without required extension %s', require_extension);
            return false;
        }
    }
    const resolved_target = path.posix.resolve(target_path);
    for (const root of root_paths) {
        // skip empty/garbage roots rather than resolving them (path.posix.resolve('') would yield cwd and falsely contain the target)
        if (!root || root.trim() === '') {
            continue;
        }
        const resolved_root = path.posix.resolve(root);
        const relative = path.posix.relative(resolved_root, resolved_target);
        const is_within = relative === ''
            || (!path.posix.isAbsolute(relative)
                && relative !== '..'
                && !relative.startsWith('..' + path.posix.sep));
        if (is_within) {
            return true;
        }
    }
    debug('target %s not within any root', target_path);
    return false;
}

/**
 * workspace-aware variant of isPathWithin: roots come from vscode.workspace.workspaceFolders
 * at the point of call. The pure isPathWithin helper stays vscode-free and unit-testable;
 * this wrapper bridges it to the live workspace so callers don't have to repeat the lookup.
 * Roots use uri.path (POSIX, scheme-agnostic), matching the uri.path targets callers pass —
 * fsPath would be lossy on non-file: schemes and OS-separator-bound on Windows.
 */
export function isWithinWorkspace(target_path: string, options?: IsPathWithinOptions): boolean {
    const root_paths = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.path);
    return isPathWithin(target_path, root_paths, options);
}
