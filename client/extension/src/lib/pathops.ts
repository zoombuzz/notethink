import Debug from "debug";
import * as path from 'path';
import * as vscode from 'vscode';

const debug = Debug("nodejs:notethink:pathops");

interface IsPathWithinOptions {
    requireExtension?: string;
}

/**
 * A target is within a root iff path.relative(root, target) is '' or a non-absolute relative path
 * that does not climb out via '..'; this rejects both '..' traversal and sibling-prefix escapes
 * (/ws-evil is NOT within /ws) that a naive startsWith would let through. Inputs are always POSIX
 * uri.path strings, so the math runs through path.posix regardless of the host OS.
 */
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
        // skip empty roots: path.posix.resolve('') would yield cwd and falsely contain the target
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
 * Live-workspace wrapper over the pure, testable isPathWithin. Roots use uri.path (POSIX,
 * scheme-agnostic) to match the uri.path targets callers pass; fsPath would be lossy on
 * non-file schemes and OS-separator-bound on Windows.
 */
export function isWithinWorkspace(target_path: string, options?: IsPathWithinOptions): boolean {
    const root_paths = (vscode.workspace.workspaceFolders ?? []).map(f => f.uri.path);
    return isPathWithin(target_path, root_paths, options);
}
