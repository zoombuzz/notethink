import Debug from "debug";
import * as path from 'path';

const debug = Debug("nodejs:notethink:pathsafe");

interface IsPathWithinOptions {
    requireExtension?: string;
}

// security-critical workspace-containment check: a target is within a root iff path.relative(root, target) is '' (equal) or a non-absolute relative path that does not climb out via '..' — this rejects '..' traversal and sibling-prefix escapes (/ws-evil is NOT within /ws) which a naive startsWith would let through
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
    const resolved_target = path.resolve(target_path);
    for (const root of root_paths) {
        // skip empty/garbage roots rather than resolving them (path.resolve('') would yield cwd and falsely contain the target)
        if (!root || root.trim() === '') {
            continue;
        }
        const resolved_root = path.resolve(root);
        const relative = path.relative(resolved_root, resolved_target);
        const is_within = relative === ''
            || (!path.isAbsolute(relative)
                && relative !== '..'
                && !relative.startsWith('..' + path.sep));
        if (is_within) {
            return true;
        }
    }
    debug('target %s not within any root', target_path);
    return false;
}
