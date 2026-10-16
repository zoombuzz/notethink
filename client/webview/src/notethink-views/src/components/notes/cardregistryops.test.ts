import {
    AGENT_CARD_TYPE,
    CARD_AUTO,
    CARD_COMPONENTS,
    CARD_REGISTRY,
    DEFAULT_CARD_TYPE,
    VIEW_DEFAULT_CARD_TYPE_SETTINGS,
    cardChainOf,
    cardComponentFor,
    cardRegistryWithViewSettings,
    cardSettingWriteFor,
    childCardNodes,
    defaultCardTypeForView,
    getCardNode,
    isCardDescendantOf,
    isPerCardKey,
    noteOrderTimestampFn,
    offersNewCardType,
    orderTimestampFnFor,
    owningCardNodeFor,
    renderableCardIds,
    resolveCardTreeRow,
    resolveCardType,
    resolvedSettingsForCard,
    selectableCardIds,
    selectableCardTypes,
} from './cardregistryops';
import type { CardRegistry } from './cardregistryops';
import { AGENT_VIRTUAL_NAMESPACE, unboundSessionKey, type ActivitySnapshot } from '../../lib/agentactivityops';
import { makeVirtualNote } from '../../lib/virtualnoteops';
import type { ActivitySession } from '../../types/AgentActivity';
import type { NoteProps } from '../../types/NoteProps';

describe('cardregistryops', () => {

    describe('registry shape', () => {

        it('allcards is the abstract parent and is not selectable', () => {
            const node = getCardNode('allcards');
            expect(node?.kind).toBe('abstract');
            expect(node?.selectable).toBe(false);
            expect(node?.parent).toBeUndefined();
        });

        it('every card beneath allcards is concrete, selectable and parented on it', () => {
            for (const id of ['card', 'sticky', 'agent']) {
                const node = getCardNode(id);
                expect(node?.kind).toBe('concrete');
                expect(node?.selectable).toBe(true);
                expect(node?.parent).toBe('allcards');
            }
        });

        it('an unknown id has no node', () => {
            expect(getCardNode('nosuchcard')).toBeUndefined();
        });

        it('the agent card is a card type like any other, so every view can draw it', () => {
            expect(getCardNode(AGENT_CARD_TYPE)?.selectable).toBe(true);
            expect(AGENT_CARD_TYPE in CARD_COMPONENTS).toBe(true);
            expect(resolveCardType(AGENT_CARD_TYPE, 'document')).toBe(AGENT_CARD_TYPE);
            expect(resolveCardType(AGENT_CARD_TYPE, 'line')).toBe(AGENT_CARD_TYPE);
            expect(resolveCardType(AGENT_CARD_TYPE, 'kanban')).toBe(AGENT_CARD_TYPE);
        });

        it('every concrete node has a component wired', () => {
            const concrete = CARD_REGISTRY.nodes.filter(n => n.kind === 'concrete').map(n => n.id);
            expect(concrete.every(id => id in CARD_COMPONENTS)).toBe(true);
        });
    });

    describe('selectable lists', () => {

        it('selectableCardIds returns the concrete cards in tree order', () => {
            expect(selectableCardIds()).toEqual(['card', 'sticky', 'agent']);
        });

        it('selectableCardTypes prefixes auto', () => {
            expect(selectableCardTypes()).toEqual([CARD_AUTO, 'card', 'sticky', 'agent']);
        });

        it('a registry card with no component wired is not offered', () => {
            const registry: CardRegistry = {
                nodes: [
                    ...CARD_REGISTRY.nodes,
                    { id: 'photo', parent: 'allcards', kind: 'concrete', selectable: true, label: 'Photo' },
                ],
                view_defaults: CARD_REGISTRY.view_defaults,
            };
            expect(selectableCardIds(registry)).toEqual(['card', 'sticky', 'agent', 'photo']);
            expect(selectableCardTypes(registry)).toEqual([CARD_AUTO, 'card', 'sticky', 'agent']);
        });
    });

    describe('defaultCardTypeForView', () => {

        it('kanban declares the full card', () => {
            expect(defaultCardTypeForView('kanban')).toBe('card');
        });

        it('a view with no declaration of its own inherits the one at root', () => {
            expect(defaultCardTypeForView('document')).toBe('card');
            expect(defaultCardTypeForView('line')).toBe('card');
        });

        it('the nearest declaration on the view chain wins over root', () => {
            const registry: CardRegistry = {
                nodes: CARD_REGISTRY.nodes,
                view_defaults: [
                    { view: 'root', card: 'card' },
                    { view: 'grouped', card: 'sticky' },
                ],
            };
            // kanban -> line -> grouped -> root, so grouped's declaration is reached before root's
            expect(defaultCardTypeForView('kanban', [], registry)).toBe('sticky');
            expect(defaultCardTypeForView('document', [], registry)).toBe('card');
        });

        it('an unknown or absent view type falls back to the default card', () => {
            expect(defaultCardTypeForView('nosuchview')).toBe(DEFAULT_CARD_TYPE);
            expect(defaultCardTypeForView(undefined)).toBe(DEFAULT_CARD_TYPE);
        });
    });

    describe('resolveCardType', () => {

        it('pins an explicit selectable selection', () => {
            expect(resolveCardType('sticky', 'kanban')).toBe('sticky');
            expect(resolveCardType('card', 'document')).toBe('card');
        });

        it('auto falls through to the view default', () => {
            expect(resolveCardType(CARD_AUTO, 'kanban')).toBe('card');
        });

        it('an absent selection falls through to the view default', () => {
            expect(resolveCardType(undefined, 'document')).toBe('card');
        });

        it('a selection with no renderer falls through rather than dispatching to nothing', () => {
            expect(resolveCardType('photo', 'document')).toBe(DEFAULT_CARD_TYPE);
        });
    });

    describe('a view default configured through settings', () => {

        it('offers every renderable card and never auto, since auto is what the default answers', () => {
            expect(renderableCardIds()).toEqual(['card', 'sticky', 'agent']);
            expect(renderableCardIds()).not.toContain(CARD_AUTO);
        });

        it('configures kanban through defaultCardType', () => {
            expect(VIEW_DEFAULT_CARD_TYPE_SETTINGS.kanban).toBe('defaultCardType');
        });

        it('returns the built-in registry untouched when there are no settings or nothing configured', () => {
            expect(cardRegistryWithViewSettings(undefined)).toBe(CARD_REGISTRY);
            expect(cardRegistryWithViewSettings({ showLineNumbers: true })).toBe(CARD_REGISTRY);
        });

        it('makes auto on a kanban board resolve to the configured card', () => {
            const registry = cardRegistryWithViewSettings({ defaultCardType: 'sticky' });
            expect(resolveCardType(CARD_AUTO, 'kanban', [], registry)).toBe('sticky');
        });

        it('leaves every other view on the registry default', () => {
            const registry = cardRegistryWithViewSettings({ defaultCardType: 'sticky' });
            expect(resolveCardType(CARD_AUTO, 'document', [], registry)).toBe('card');
            expect(resolveCardType(CARD_AUTO, 'line', [], registry)).toBe('card');
        });

        it('still lets a pinned card type win over the view default', () => {
            const registry = cardRegistryWithViewSettings({ defaultCardType: 'sticky' });
            expect(resolveCardType('card', 'kanban', [], registry)).toBe('card');
        });

        it('passes a minted type the default configured on the view it was saved from', () => {
            const registry = cardRegistryWithViewSettings({ defaultCardType: 'sticky' });
            const user_types = [{ id: 'user-kanban-by-assignee', label: 'Kanban by Assignee', parent: 'kanban', overrides: {} }];
            expect(resolveCardType(CARD_AUTO, 'user-kanban-by-assignee', user_types, registry)).toBe('sticky');
        });

        it('ignores a configured value naming no renderable card, keeping the registry default', () => {
            expect(cardRegistryWithViewSettings({ defaultCardType: 'photo' })).toBe(CARD_REGISTRY);
            expect(cardRegistryWithViewSettings({ defaultCardType: 42 })).toBe(CARD_REGISTRY);
        });

        it('never mutates the built-in registry', () => {
            cardRegistryWithViewSettings({ defaultCardType: 'sticky' });
            expect(defaultCardTypeForView('kanban')).toBe('card');
        });
    });

    describe('the card tree, as the drawer walks it', () => {

        it('chains a concrete card up to the registry root, deepest-first', () => {
            expect(cardChainOf('sticky')).toEqual(['sticky', 'allcards']);
            expect(cardChainOf('allcards')).toEqual(['allcards']);
        });

        it('answers with an empty chain for an id the registry does not know', () => {
            expect(cardChainOf('nosuchcard')).toEqual([]);
        });

        it('lists the tree roots for undefined and the children of a node otherwise', () => {
            expect(childCardNodes(undefined).map(n => n.id)).toEqual(['allcards']);
            expect(childCardNodes('allcards').map(n => n.id)).toEqual(['card', 'sticky', 'agent']);
            expect(childCardNodes('sticky')).toEqual([]);
        });

        it('reads ancestry strictly, so a node is never its own ancestor', () => {
            expect(isCardDescendantOf('sticky', 'allcards')).toBe(true);
            expect(isCardDescendantOf('allcards', 'allcards')).toBe(false);
            expect(isCardDescendantOf('sticky', 'card')).toBe(false);
        });
    });

    describe('owningCardNodeFor - the node a card settings row pill names', () => {

        it('names the card home for every setting the card pane renders', () => {
            expect(owningCardNodeFor('showLinetagsInHeadlines')).toBe('allcards');
            expect(owningCardNodeFor('autoExpandFocusedNote')).toBe('allcards');
            expect(owningCardNodeFor('showLineNumbers')).toBe('allcards');
            expect(owningCardNodeFor('cardType')).toBe('allcards');
        });

        it('yields no pill for a key homed off this tree, on a view node or on a sentinel', () => {
            expect(owningCardNodeFor('orientation')).toBeUndefined();
            expect(owningCardNodeFor('scrollNoteIntoView')).toBeUndefined();
            expect(owningCardNodeFor('watchUnopenedFilesInViewer')).toBeUndefined();
            expect(owningCardNodeFor('includeFilter')).toBeUndefined();
        });
    });

    describe('offersNewCardType - the offer follows the pill, as it does on the view axis', () => {

        // a registry standing a rung above the built-in one, so `allcards` is an ordinary ancestor, not the root
        const deeper: CardRegistry = {
            nodes: [
                { id: 'everything', kind: 'abstract', selectable: false, label: 'Everything' },
                { id: 'allcards', parent: 'everything', kind: 'abstract', selectable: false, label: 'All cards' },
                { id: 'card', parent: 'allcards', kind: 'concrete', selectable: true, label: 'Card' },
            ],
            view_defaults: [],
        };

        it('offers when the owner is a strict ancestor of the selected card node', () => {
            expect(offersNewCardType('card', 'showLineNumbers', deeper)).toBe(true);
        });

        it('stays silent when the owner is the selected node itself', () => {
            expect(offersNewCardType('allcards', 'showLineNumbers', deeper)).toBe(false);
        });

        it('stays silent for a setting owned by the root of the tree, which every card inherits', () => {
            for (const key of ['showLinetagsInHeadlines', 'autoExpandFocusedNote', 'showLineNumbers'] as const) {
                expect(offersNewCardType('sticky', key)).toBe(false);
                expect(offersNewCardType('card', key)).toBe(false);
            }
        });

        it('stays silent for a setting belonging to no card type at all', () => {
            expect(offersNewCardType('sticky', 'orientation')).toBe(false);
            expect(offersNewCardType('sticky', 'watchUnopenedFilesInViewer')).toBe(false);
        });
    });

    describe('isPerCardKey - which keys a card node can genuinely hold its own value for', () => {

        it('is true for every key homed on the card tree, cardType excepted', () => {
            expect(isPerCardKey('showLineNumbers')).toBe(true);
            expect(isPerCardKey('showLinetagsInHeadlines')).toBe(true);
            expect(isPerCardKey('autoExpandFocusedNote')).toBe(true);
            expect(isPerCardKey('clockMode')).toBe(true);
        });

        it('is false for cardType itself, since that is the tree\'s own selection', () => {
            expect(isPerCardKey('cardType')).toBe(false);
        });

        it('is false for a key homed off the card tree entirely', () => {
            expect(isPerCardKey('orientation')).toBe(false);
            expect(isPerCardKey('watchUnopenedFilesInViewer')).toBe(false);
        });
    });

    describe('resolveCardTreeRow - nearest-first resolution along the card chain', () => {

        it('resolves to the flat home value when no card node holds anything of its own', () => {
            const row = resolveCardTreeRow('card', 'showLineNumbers', false, {}, []);
            expect(row.value).toBe(false);
            expect(row.ownerId).toBe('allcards');
        });

        it('a concrete card\'s own cell wins over allcards for that same card', () => {
            // home_value (false) stands in for allcards' own resolved value; sticky's own cell overrides it
            const card_overrides = { sticky: { showLineNumbers: true } };
            const sticky_row = resolveCardTreeRow('sticky', 'showLineNumbers', false, card_overrides, []);
            expect(sticky_row.value).toBe(true);
            expect(sticky_row.ownerId).toBe('sticky');
            // a sibling card type never sees another card's own cell - only allcards' own value
            const card_row = resolveCardTreeRow('card', 'showLineNumbers', false, card_overrides, []);
            expect(card_row.value).toBe(false);
            expect(card_row.ownerId).toBe('allcards');
        });

        it('allcards\' own cell is what every other card inherits when it holds none of its own', () => {
            // home_value already reflects allcards' own resolved value, exactly as the cascade hands it in
            const row = resolveCardTreeRow('agent', 'showLineNumbers', true, {}, []);
            expect(row.value).toBe(true);
            expect(row.inherited).toBe(true);
            expect(row.inheritedFromId).toBe('allcards');
        });

        it('clockMode resolves at its own home (agent), with no ancestor pill for the agent card itself', () => {
            const row = resolveCardTreeRow('agent', 'clockMode', 'active', {}, []);
            expect(row.ownerId).toBe('agent');
            expect(row.inherited).toBeUndefined();
        });
    });

    describe('cardSettingWriteFor - the one write a card settings row takes', () => {

        it('at the selected card\'s own home, writes the cell literally, even when it equals the default', () => {
            expect(cardSettingWriteFor('allcards', 'showLineNumbers', false, false, {})).toEqual({
                setting: 'cards',
                value: { sets: [{ node_id: 'allcards', key: 'showLineNumbers', value: false }] },
            });
        });

        it('on a concrete card below allcards, writes that card\'s own cell when the value differs from what it would inherit', () => {
            // home_value (false) stands in for allcards' own resolved value, exactly as the cascade hands it in
            expect(cardSettingWriteFor('sticky', 'showLineNumbers', true, false, {})).toEqual({
                setting: 'cards',
                value: { sets: [{ node_id: 'sticky', key: 'showLineNumbers', value: true }] },
            });
        });

        it('clears the selected card\'s own cell when the new value equals what it would inherit from allcards', () => {
            // home_value (true) already reflects allcards' own resolved value, exactly as the cascade hands it in
            expect(cardSettingWriteFor('sticky', 'showLineNumbers', true, true, {})).toEqual({
                setting: 'cards',
                value: { sets: [{ node_id: 'sticky', key: 'showLineNumbers', value: undefined }] },
            });
        });

        it('a key off the card tree (cardType itself) writes its own flat setting', () => {
            expect(cardSettingWriteFor('allcards', 'cardType', 'agent', 'auto', {})).toEqual({ setting: 'cardType', value: 'agent' });
        });
    });

    describe('resolvedSettingsForCard - per-rendered-card resolution of the card-tree keys', () => {

        it('returns the SAME settings reference when no card holds an override of its own', () => {
            const settings = { showLineNumbers: false, showLinetagsInHeadlines: false, autoExpandFocusedNote: false, clockMode: 'active' };
            expect(resolvedSettingsForCard('sticky', settings)).toBe(settings);
        });

        it('a sticky card renders with its own showLineNumbers, independent of allcards\' and of another card type\'s', () => {
            // showLineNumbers (false) stands in for allcards' own resolved value; sticky's own cell overrides it
            const settings = { showLineNumbers: false, cardOverrides: { sticky: { showLineNumbers: true } } };
            const resolved = resolvedSettingsForCard('sticky', settings);
            expect(resolved.showLineNumbers).toBe(true);
            // a sibling resolves through the same function unaffected
            expect(resolvedSettingsForCard('card', settings).showLineNumbers).toBe(false);
        });

        it('leaves every non-card-tree key untouched', () => {
            const settings = { showLineNumbers: false, orientation: 'rows', watchUnopenedFilesInViewer: true };
            expect(resolvedSettingsForCard('sticky', settings).orientation).toBe('rows');
            expect(resolvedSettingsForCard('sticky', settings).watchUnopenedFilesInViewer).toBe(true);
        });
    });

    describe('cardComponentFor', () => {

        it('returns the wired component for each concrete card', () => {
            expect(cardComponentFor('card')).toBe(CARD_COMPONENTS.card);
            expect(cardComponentFor('sticky')).toBe(CARD_COMPONENTS.sticky);
        });

        it('an unknown card falls back to the default card component', () => {
            expect(cardComponentFor('nosuchcard')).toBe(CARD_COMPONENTS[DEFAULT_CARD_TYPE]);
        });
    });

    describe('ordering timestamps', () => {

        const ROOT_PATH = '/ws/project';

        function makeSession(session_id: string, overrides: Partial<ActivitySession> = {}): ActivitySession {
            return {
                session_id,
                vendor: 'claude-code',
                project: 'project',
                story_binding: 'none',
                started_at: '2026-10-01T00:00:00Z',
                updated_at: '2026-10-01T00:00:00Z',
                state: 'working',
                capabilities: { live_tool_call: 'supported', question: 'unsupported', file_attribution: 'supported' },
                usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, is_estimate: true },
                ...overrides,
            };
        }

        function snapshotOf(sessions: ActivitySnapshot['sessions']): ActivitySnapshot {
            return { analyser: { state: 'live', refusals: [] }, sessions, trees: [] };
        }

        function makeStoryNote(id: string, file_mtime?: number): NoteProps {
            return {
                seq: 1,
                level: 1,
                type: 'heading',
                children_body: [],
                children: [],
                position: { start: { offset: 0, line: 1 }, end: { offset: 10, line: 1 } },
                headline_raw: `### Story [](?id=${id})`,
                body_raw: '',
                linetags: { id: { key: 'id', value: id, key_offset: 0, value_offset: 0, linktext_offset: 0, note_seq: 1 } },
                origin: { doc_id: 'x', doc_path: '/workspace/todo.md', relative_path: 'todo.md', file_mtime },
            };
        }

        function makeVirtualAgentNote(session_id: string): NoteProps {
            const key = unboundSessionKey({ root_path: ROOT_PATH, session: makeSession(session_id) });
            return makeVirtualNote({ namespace: AGENT_VIRTUAL_NAMESPACE, key, headline: 'agent working' });
        }

        it("orderTimestampFnFor resolves the agent card type to its own rule, and falls back to the file-changed rule for a type that declares none", () => {
            expect(orderTimestampFnFor(AGENT_CARD_TYPE)).not.toBe(orderTimestampFnFor(DEFAULT_CARD_TYPE));
            expect(orderTimestampFnFor('sticky')).toBe(orderTimestampFnFor(DEFAULT_CARD_TYPE));
            expect(orderTimestampFnFor('nosuchcardtype')).toBe(orderTimestampFnFor(DEFAULT_CARD_TYPE));
        });

        it("the default card type's timestamp is the story's file_mtime, undefined when the note carries none", () => {
            const timestamp_of = noteOrderTimestampFn(DEFAULT_CARD_TYPE, { snapshot: undefined });
            const mtime = Date.parse('2026-10-05T00:00:00Z');
            expect(timestamp_of(makeStoryNote('a', mtime))).toBe(mtime);
            expect(timestamp_of(makeStoryNote('b'))).toBeUndefined();
        });

        it("a card type with no ordering rule of its own (sticky) falls back to file_mtime too", () => {
            const timestamp_of = noteOrderTimestampFn('sticky', { snapshot: undefined });
            const mtime = Date.parse('2026-10-05T00:00:00Z');
            expect(timestamp_of(makeStoryNote('a', mtime))).toBe(mtime);
        });

        it("the agent card type's timestamp is the latest update among the sessions bound to the note's story", () => {
            const snapshot = snapshotOf([
                { root_path: ROOT_PATH, session: makeSession('s1', { story_binding: 'bound', stories: [{ doc_path: 'todo.md', id: 'solo' }], updated_at: '2026-10-01T00:00:00Z' }) },
                { root_path: ROOT_PATH, session: makeSession('s2', { story_binding: 'bound', stories: [{ doc_path: 'todo.md', id: 'solo' }], updated_at: '2026-10-05T00:00:00Z' }) },
            ]);
            const timestamp_of = noteOrderTimestampFn(AGENT_CARD_TYPE, { snapshot });
            expect(timestamp_of(makeStoryNote('solo'))).toBe(Date.parse('2026-10-05T00:00:00Z'));
        });

        it("the agent card type ignores file_mtime entirely, reading the activity snapshot instead", () => {
            const timestamp_of = noteOrderTimestampFn(AGENT_CARD_TYPE, { snapshot: undefined });
            expect(timestamp_of(makeStoryNote('solo', Date.parse('2026-10-05T00:00:00Z')))).toBeUndefined();
        });

        it("the agent card type counts a virtual note's own unbound session, not any story binding", () => {
            const snapshot = snapshotOf([
                { root_path: ROOT_PATH, session: makeSession('agent-1', { updated_at: '2026-10-09T00:00:00Z' }) },
            ]);
            const timestamp_of = noteOrderTimestampFn(AGENT_CARD_TYPE, { snapshot });
            expect(timestamp_of(makeVirtualAgentNote('agent-1'))).toBe(Date.parse('2026-10-09T00:00:00Z'));
        });

        it("the agent card type joins a single-file story to its session through the fallback doc path, not an origin it does not carry", () => {
            const note: NoteProps = { ...makeStoryNote('solo'), origin: undefined };
            const snapshot = snapshotOf([
                { root_path: ROOT_PATH, session: makeSession('s1', { story_binding: 'bound', stories: [{ doc_path: 'notes.md', id: 'solo' }], updated_at: '2026-10-02T00:00:00Z' }) },
            ]);
            expect(noteOrderTimestampFn(AGENT_CARD_TYPE, { snapshot, fallback_doc_path: 'notes.md' })(note)).toBe(Date.parse('2026-10-02T00:00:00Z'));
            expect(noteOrderTimestampFn(AGENT_CARD_TYPE, { snapshot, fallback_doc_path: 'other.md' })(note)).toBeUndefined();
        });
    });
});
