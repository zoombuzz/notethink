import { agentVendorHomeFrom, bestAgentHomeCandidate, encodeClaudeProjectDirName, homeDirectoryFromLogPath, projectDirNamesWorkspace, trailingWorkspaceSegmentMatchCount, type AgentHomeCandidate } from './agenthomeops';

describe('homeDirectoryFromLogPath', () => {
    it('resolves a Linux Code layout to $HOME', () => {
        expect(homeDirectoryFromLogPath('/home/alex/.config/Code/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/home/alex');
    });

    it('resolves a Linux Code - Insiders layout, the product name never matters', () => {
        expect(homeDirectoryFromLogPath('/home/alex/.config/Code - Insiders/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/home/alex');
    });

    it('resolves a Linux VSCodium layout', () => {
        expect(homeDirectoryFromLogPath('/home/alex/.config/VSCodium/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/home/alex');
    });

    it('resolves a macOS Code layout, two segments below Library', () => {
        expect(homeDirectoryFromLogPath('/Users/alex/Library/Application Support/Code/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/Users/alex');
    });

    it('resolves a Windows Code layout via AppData', () => {
        expect(homeDirectoryFromLogPath('/c:/Users/alex/AppData/Roaming/Code/logs/20260922T120000/exthost/webWorker/NoteThink.notethink/notethink-extension.log'))
            .toBe('/c:/Users/alex');
    });

    it('tolerates a deeper or shallower tail than todays VS Code writes, since it only looks for the anchor segment', () => {
        expect(homeDirectoryFromLogPath('/home/alex/.config/Code/logs/20260922T120000/window3/exthost/webWorker/publisher.NoteThink/some/deeper/notethink-extension.log'))
            .toBe('/home/alex');
    });

    it('returns undefined for a layout with none of the known anchors, such as a web host', () => {
        expect(homeDirectoryFromLogPath('/workspace/logs/notethink-extension.log')).toBeUndefined();
    });
});

describe('agentVendorHomeFrom', () => {
    it('joins the three vendor directories onto the resolved home', () => {
        expect(agentVendorHomeFrom('/home/alex/.config/Code/logs/x/exthost/webWorker/NoteThink.notethink/notethink-extension.log')).toEqual({
            claudeCode: '/home/alex/.claude',
            codex: '/home/alex/.codex',
            grok: '/home/alex/.grok',
        });
    });

    it('is undefined when the home directory could not be resolved', () => {
        expect(agentVendorHomeFrom('/workspace/logs/notethink-extension.log')).toBeUndefined();
    });
});

describe('encodeClaudeProjectDirName', () => {
    it('replaces every non-alphanumeric character with a dash, matching Claude Code\'s own naming', () => {
        expect(encodeClaudeProjectDirName('/mnt/secure/home/dev/git/github.com/in_development/notethink'))
            .toBe('-mnt-secure-home-dev-git-github-com-in-development-notethink');
    });

    it('leaves letters and digits untouched', () => {
        expect(encodeClaudeProjectDirName('abc123')).toBe('abc123');
    });
});

describe('trailingWorkspaceSegmentMatchCount', () => {
    it('counts every trailing segment when the encoded name is the workspace path itself', () => {
        expect(trailingWorkspaceSegmentMatchCount('-home-dev-work-app', '/home/dev/work/app')).toBe(4);
    });

    it('counts only the segments that actually match at the end', () => {
        expect(trailingWorkspaceSegmentMatchCount('-home-dev-other-app', '/home/dev/work/app')).toBe(1);
    });

    it('is zero when nothing at the end matches', () => {
        expect(trailingWorkspaceSegmentMatchCount('-elsewhere-entirely', '/home/dev/work/app')).toBe(0);
    });
});

describe('projectDirNamesWorkspace', () => {
    it('matches a directory named exactly after the workspace folder', () => {
        expect(projectDirNamesWorkspace('-home-dev-work-app', '/home/dev/work/app')).toBe(true);
    });

    it('matches a directory named after a folder inside the workspace', () => {
        expect(projectDirNamesWorkspace('-home-dev-work-app-nested', '/home/dev/work/app')).toBe(true);
    });

    it('matches through a symlinked alias by trailing path segments, the real cwd ending the same way the alias does', () => {
        // the workspace is opened through /mnt/data/app, a symlink to the real /home/dev/work/app
        expect(projectDirNamesWorkspace('-home-dev-work-app', '/mnt/data/app')).toBe(true);
    });

    it('does not match an unrelated directory', () => {
        expect(projectDirNamesWorkspace('-home-dev-other-project', '/home/dev/work/app')).toBe(false);
    });
});

describe('bestAgentHomeCandidate', () => {
    function candidate(path: string, dir_names: readonly string[], newest_session_mtime_ms: number | undefined): AgentHomeCandidate {
        return { path, claude_project_dir_names: dir_names, newest_session_mtime_ms };
    }

    it('is undefined with no candidates', () => {
        expect(bestAgentHomeCandidate([], '/home/dev/work/app')).toBeUndefined();
    });

    it('picks the sole candidate', () => {
        const only = candidate('/home/dev', [], 1_000);
        expect(bestAgentHomeCandidate([only], '/home/dev/work/app')).toBe(only);
    });

    it('prefers the candidate whose project directory names the workspace, even over a newer unrelated one', () => {
        const named = candidate('/home/dev', ['-home-dev-work-app'], 1_000);
        const newer_unrelated = candidate('/home/other', ['-home-other-project'], 5_000);
        expect(bestAgentHomeCandidate([newer_unrelated, named], '/home/dev/work/app')).toBe(named);
    });

    it('matches through a symlinked alias of the workspace, by trailing segments rather than the full real path', () => {
        // the workspace is opened as /mnt/alias/to/app; the real cwd Claude Code recorded ends the same way
        const named = candidate('/home/dev', ['-real-path-to-app'], 1_000);
        const newer_unrelated = candidate('/home/other', ['-home-other-project'], 5_000);
        expect(bestAgentHomeCandidate([newer_unrelated, named], '/mnt/alias/to/app')).toBe(named);
    });

    it('falls back to the newest session directory when none names the workspace', () => {
        const older = candidate('/home/dev', ['-home-dev-other'], 1_000);
        const newer = candidate('/home/other', ['-home-other-project'], 5_000);
        expect(bestAgentHomeCandidate([older, newer], '/home/dev/work/app')).toBe(newer);
    });

    it('is deterministic, returning the first candidate, when nothing names the workspace and no mtime is comparable', () => {
        const first = candidate('/home/dev', [], undefined);
        const second = candidate('/home/other', [], undefined);
        expect(bestAgentHomeCandidate([first, second], '/home/dev/work/app')).toBe(first);
    });
});
