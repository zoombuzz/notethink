import Debug from 'debug';

const debug = Debug('nodejs:notethink-views:settleFlipAnimations');

/*
 * single named operation (like mergeAggregateRoot.ts) - one export, no *ops barrel. Snaps every FLIP card
 * in `container` to its true layout box before @hello-pangea/dnd lifts it into a fixed drag clone: finish
 * any running Web Animation so the card settles to its identity box, drop the inline transform the FLIP
 * layer painted, and strip the transient flip classes. Called at drag-start so a card grabbed mid-animation
 * does not jump when it becomes the drag clone.
 */

// the transient FLIP class bases; matched by substring so this works under both the jest identity-obj-proxy (token === base) and the production CSS-module hash (token contains base)
const FLIP_CLASS_BASES = ['flipping', 'columnEntering', 'columnExiting'];

// strip any live flip class from the card, snapshotting classList first so removal during iteration cannot skip a token
function removeFlipClasses(el: HTMLElement): void {
    Array.from(el.classList).forEach((token) => {
        if (FLIP_CLASS_BASES.some((base) => token === base || token.includes(base))) {
            el.classList.remove(token);
        }
    });
}

export function settleFlipAnimations(container: HTMLElement): void {
    const cards = container.querySelectorAll<HTMLElement>('[data-flip-id]');
    debug('settling %d flip cards', cards.length);
    cards.forEach((el) => {
        if (typeof el.getAnimations === 'function') {
            el.getAnimations().forEach((animation) => animation.finish());
        }
        el.style.transform = '';
        removeFlipClasses(el);
    });
}
