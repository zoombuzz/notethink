import {
    CARD_AUTO,
    CARD_COMPONENTS,
    CARD_REGISTRY,
    DEFAULT_CARD_TYPE,
    cardChainOf,
    cardComponentFor,
    childCardNodes,
    defaultCardTypeForView,
    getCardNode,
    isCardDescendantOf,
    offersNewCardType,
    owningCardNodeFor,
    resolveCardType,
    selectableCardIds,
    selectableCardTypes,
} from './cardregistryops';
import type { CardRegistry } from './cardregistryops';

describe('cardregistryops', () => {

    describe('registry shape', () => {

        it('allcards is the abstract parent and is not selectable', () => {
            const node = getCardNode('allcards');
            expect(node?.kind).toBe('abstract');
            expect(node?.selectable).toBe(false);
            expect(node?.parent).toBeUndefined();
        });

        it('card and sticky are concrete, selectable and parented on allcards', () => {
            for (const id of ['card', 'sticky']) {
                const node = getCardNode(id);
                expect(node?.kind).toBe('concrete');
                expect(node?.selectable).toBe(true);
                expect(node?.parent).toBe('allcards');
            }
        });

        it('an unknown id has no node', () => {
            expect(getCardNode('nosuchcard')).toBeUndefined();
        });

        it('every concrete node has a component wired', () => {
            const concrete = CARD_REGISTRY.nodes.filter(n => n.kind === 'concrete').map(n => n.id);
            expect(concrete.every(id => id in CARD_COMPONENTS)).toBe(true);
        });
    });

    describe('selectable lists', () => {

        it('selectableCardIds returns the concrete cards in tree order', () => {
            expect(selectableCardIds()).toEqual(['card', 'sticky']);
        });

        it('selectableCardTypes prefixes auto', () => {
            expect(selectableCardTypes()).toEqual([CARD_AUTO, 'card', 'sticky']);
        });

        it('a registry card with no component wired is not offered', () => {
            const registry: CardRegistry = {
                nodes: [
                    ...CARD_REGISTRY.nodes,
                    { id: 'photo', parent: 'allcards', kind: 'concrete', selectable: true, label: 'Photo' },
                ],
                view_defaults: CARD_REGISTRY.view_defaults,
            };
            expect(selectableCardIds(registry)).toEqual(['card', 'sticky', 'photo']);
            expect(selectableCardTypes(registry)).toEqual([CARD_AUTO, 'card', 'sticky']);
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
            expect(childCardNodes('allcards').map(n => n.id)).toEqual(['card', 'sticky']);
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

        /*
         * A registry standing a rung above the built-in one, so `allcards` becomes an ordinary ancestor
         * rather than the root. That is the only way to exercise the strict-ancestor half today, because
         * every shipped card setting homes at the real root and the root is exempt.
         */
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

    describe('cardComponentFor', () => {

        it('returns the wired component for each concrete card', () => {
            expect(cardComponentFor('card')).toBe(CARD_COMPONENTS.card);
            expect(cardComponentFor('sticky')).toBe(CARD_COMPONENTS.sticky);
        });

        it('an unknown card falls back to the default card component', () => {
            expect(cardComponentFor('nosuchcard')).toBe(CARD_COMPONENTS[DEFAULT_CARD_TYPE]);
        });
    });
});
