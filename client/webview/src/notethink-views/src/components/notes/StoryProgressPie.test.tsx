import React from 'react';
import fs from 'fs';
import path from 'path';
import { act, render, screen } from '@testing-library/react';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';
import StoryProgressPie from './StoryProgressPie';
import StickyNote from './StickyNote';
import AgentNote from './AgentNote';
import MarkdownNote from './MarkdownNote';
import { resetActivitySnapshot, setActivitySnapshot } from '../../lib/activityhooks';
import { ACTIVITY_DEMAND_MESSAGE_TYPE } from '../../lib/agentactivityops';
import { convertMdastToNoteHierarchy } from '../../lib/convertMdastToNoteHierarchy';
import { flattenAllNotes } from '../../lib/noteops';
import type { ActivitySnapshot } from '../../lib/agentactivityops';
import { hueForOrigin, pillColourForHue } from '../../lib/originops';
import type { NoteProps } from '../../types/NoteProps';

const DOC = 'docstech/todo.md';

// the full card measures its body with a ResizeObserver, which jsdom lacks
beforeAll(() => {
    global.ResizeObserver = jest.fn(() => ({ observe: jest.fn(), unobserve: jest.fn(), disconnect: jest.fn() })) as unknown as typeof ResizeObserver;
});

// resetting the store notifies mounted subscribers, so it runs inside act
function resetStore(): void {
    act(() => { resetActivitySnapshot(); });
}

function storyFrom(markdown: string, postMessage?: jest.Mock): NoteProps {
    const root = convertMdastToNoteHierarchy(fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }), markdown);
    const note = flattenAllNotes(root).find(candidate => candidate.type === 'heading')!;
    return { ...note, origin: { doc_id: 'x', doc_path: `/ws/${DOC}`, relative_path: DOC }, handlers: { postMessage } as NoteProps['handlers'] };
}

function snapshotWith(pct?: number): ActivitySnapshot {
    return {
        analyser: { state: 'live', refusals: [] },
        sessions: [],
        trees: [],
        progress: pct === undefined ? [] : [{ root_relative: '', story_id: 'story-a', pct, at: '2026-11-03T10:00:00Z', by: 'coordinator' }],
    };
}

const DOING_WITH_TASKS = '### Story [](?id=story-a&status=doing)\n\n+ [X] one\n+ [ ] two\n+ [ ] three\n+ [ ] four\n';

describe('StoryProgressPie', () => {
    beforeEach(() => { resetStore(); });
    afterEach(() => { resetStore(); });

    it('shows the coordinator percentage, labelled and with its source in the tooltip', () => {
        act(() => { setActivitySnapshot(snapshotWith(62)); });
        render(<StoryProgressPie note={storyFrom(DOING_WITH_TASKS)} />);
        const pie = screen.getByTestId('story-progress-pie');
        expect(pie).toHaveAttribute('aria-label', '62% complete');
        expect(pie).toHaveAttribute('title', '62% complete (coordinator estimate)');
        expect(pie).toHaveAttribute('data-source', 'coordinator');
    });

    it('moves to a new percentage when a new snapshot lands', () => {
        act(() => { setActivitySnapshot(snapshotWith(20)); });
        render(<StoryProgressPie note={storyFrom(DOING_WITH_TASKS)} />);
        expect(screen.getByTestId('story-progress-pie')).toHaveAttribute('data-pct', '20');
        act(() => { setActivitySnapshot(snapshotWith(75)); });
        expect(screen.getByTestId('story-progress-pie')).toHaveAttribute('data-pct', '75');
    });

    it('falls back to the ticked task count with no entry, before any snapshot has arrived', () => {
        render(<StoryProgressPie note={storyFrom(DOING_WITH_TASKS)} />);
        const pie = screen.getByTestId('story-progress-pie');
        expect(pie).toHaveAttribute('data-pct', '25');
        expect(pie).toHaveAttribute('title', '25% complete (1 of 4 tasks ticked)');
    });

    it('uses the story\'s own progress tag ahead of its task count', () => {
        render(<StoryProgressPie note={storyFrom('### Story [](?id=story-a&status=doing&progress=40&progress_max=100)\n\n+ [X] one\n')} />);
        expect(screen.getByTestId('story-progress-pie')).toHaveAttribute('data-source', 'linetag');
    });

    it('draws nothing for a story that is not in flight, has no figure, or is not a story', () => {
        const { container, rerender } = render(<StoryProgressPie note={storyFrom('### Story [](?id=story-a&status=backlog)\n\n+ [X] one\n')} />);
        expect(container).toBeEmptyDOMElement();
        rerender(<StoryProgressPie note={storyFrom('### Story [](?id=story-a&status=doing)\n\n+ plain\n')} />);
        expect(container).toBeEmptyDOMElement();
        rerender(<StoryProgressPie note={{ ...storyFrom(DOING_WITH_TASKS), type: 'listItem' }} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('asks the host for activity when the story is in flight, and not otherwise', () => {
        const in_flight = jest.fn();
        const not_in_flight = jest.fn();
        render(<StoryProgressPie note={storyFrom(DOING_WITH_TASKS, in_flight)} />);
        render(<StoryProgressPie note={storyFrom('### Story [](?id=story-a&status=backlog)', not_in_flight)} />);
        expect(in_flight).toHaveBeenCalledWith({ type: ACTIVITY_DEMAND_MESSAGE_TYPE });
        expect(not_in_flight).not.toHaveBeenCalled();
    });
});

describe('the pie in every card type', () => {
    beforeEach(() => { resetStore(); act(() => { setActivitySnapshot(snapshotWith(55)); }); });
    afterEach(() => { resetStore(); });

    it.each([
        ['card', (note: NoteProps) => <MarkdownNote {...note} />],
        ['sticky', (note: NoteProps) => <StickyNote {...note} />],
        ['agent', (note: NoteProps) => <AgentNote {...note} />],
    ])('the %s card shows the pie beside its headline', async (_label, renderCard) => {
        const { container } = render(<React.Suspense fallback={null}>{renderCard(storyFrom(DOING_WITH_TASKS))}</React.Suspense>);
        const pie = await screen.findByTestId('story-progress-pie');
        expect(pie).toHaveAttribute('data-pct', '55');
        expect(container.querySelector('[role="rowheader"]')).toContainElement(pie);
    });
});

describe('the pie takes the project pill colour', () => {
    beforeEach(() => { resetStore(); act(() => { setActivitySnapshot(snapshotWith(55)); }); });
    afterEach(() => { resetStore(); document.body.className = ''; resetStore(); });

    it('fills the wedge in the pill colour for the dark theme', () => {
        const note = storyFrom(DOING_WITH_TASKS);
        render(<StoryProgressPie note={note} />);
        const pie = screen.getByTestId('story-progress-pie');
        expect(pie.style.getPropertyValue('--nt-pie-colour')).toBe(pillColourForHue(hueForOrigin(note.origin!), 'dark'));
        expect(pie).toHaveAttribute('data-pill-matched', 'true');
    });

    it('follows the light theme, as the pill does', () => {
        document.body.className = 'vscode-light';
        const note = storyFrom(DOING_WITH_TASKS);
        render(<StoryProgressPie note={note} />);
        expect(screen.getByTestId('story-progress-pie').style.getPropertyValue('--nt-pie-colour')).toBe(pillColourForHue(hueForOrigin(note.origin!), 'light'));
    });

    it('matches the colour the pill itself draws', () => {
        const { container } = render(<React.Suspense fallback={null}><MarkdownNote {...storyFrom(DOING_WITH_TASKS)} /></React.Suspense>);
        const pill = container.querySelector('[data-testid="origin-project-pill"]') as HTMLElement;
        const pie = screen.getByTestId('story-progress-pie');
        // jsdom normalises a colour assigned to a real property, so the pie's variable is run through one for comparison
        const probe = document.createElement('span');
        probe.style.backgroundColor = pie.style.getPropertyValue('--nt-pie-colour');
        expect(probe.style.backgroundColor).not.toBe('');
        expect(probe.style.backgroundColor).toBe(pill.style.backgroundColor);
    });

    it('keeps the default colour, and the grey remainder, where there is no pill', () => {
        render(<StoryProgressPie note={{ ...storyFrom(DOING_WITH_TASKS), origin: undefined }} />);
        const pie = screen.getByTestId('story-progress-pie');
        expect(pie.style.getPropertyValue('--nt-pie-colour')).toBe('');
        expect(pie).not.toHaveAttribute('data-pill-matched');
        expect(pie.querySelector('circle')?.getAttribute('class')).toMatch(/track/);
    });
});

describe('the pie outline', () => {
    beforeEach(() => { resetStore(); act(() => { setActivitySnapshot(snapshotWith(55)); }); });
    afterEach(() => { resetStore(); });

    it('rings the disc with a thin outline stroked inside its radius, drawn after the wedge', () => {
        render(<StoryProgressPie note={storyFrom(DOING_WITH_TASKS)} />);
        const circles = Array.from(screen.getByTestId('story-progress-pie').querySelectorAll('circle'));
        expect(circles).toHaveLength(3);
        const [track, , outline] = circles;
        expect(outline.getAttribute('class')).toMatch(/outline/);
        const reach = Number(outline.getAttribute('r')) + Number(outline.getAttribute('stroke-width')) / 2;
        expect(reach).toBe(Number(track.getAttribute('r')));
    });

    it('strokes the outline in the wedge colour variable, so the pill colour or its fallback applies', () => {
        const scss = fs.readFileSync(path.join(__dirname, 'StoryProgressPie.module.scss'), 'utf8');
        const outline_rule = scss.slice(scss.indexOf('.outline {'));
        expect(outline_rule).toMatch(/stroke:\s*var\(--nt-pie-colour\)/);
        expect(outline_rule).not.toMatch(/descriptionForeground/);
    });

    it('draws the outline with and without a project pill', () => {
        render(<StoryProgressPie note={{ ...storyFrom(DOING_WITH_TASKS), origin: undefined }} />);
        expect(screen.getByTestId('story-progress-pie').querySelector('circle[class*="outline"]')).not.toBeNull();
    });

    it.each([
        ['card', (note: NoteProps) => <MarkdownNote {...note} />],
        ['sticky', (note: NoteProps) => <StickyNote {...note} />],
        ['agent', (note: NoteProps) => <AgentNote {...note} />],
    ])('the %s card pie carries the outline', async (_label, renderCard) => {
        render(<React.Suspense fallback={null}>{renderCard(storyFrom(DOING_WITH_TASKS))}</React.Suspense>);
        const pie = await screen.findByTestId('story-progress-pie');
        expect(pie.querySelector('circle[class*="outline"]')).not.toBeNull();
    });
});
