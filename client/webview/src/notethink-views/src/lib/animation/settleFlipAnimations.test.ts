import { settleFlipAnimations } from './settleFlipAnimations';

// attach a fake Web Animations getAnimations() to a single element; each fake animation exposes a finish spy
function attachAnimations(el: HTMLElement, animations: Array<{ finish: jest.Mock }>): void {
    el.getAnimations = (() => animations) as unknown as HTMLElement['getAnimations'];
}

interface SeededCard {
    el: HTMLElement;
    finish: jest.Mock;
}

// build a FLIP card mid-animation: a [data-flip-id] node with a running animation, an inline transform, and one flip class
function seedCard(container: HTMLElement, flip_id: string, flip_class: string): SeededCard {
    const el = document.createElement('div');
    el.setAttribute('data-flip-id', flip_id);
    el.classList.add('note', flip_class);
    el.style.transform = 'translate(10px, 20px)';
    const finish = jest.fn();
    attachAnimations(el, [{ finish }]);
    container.appendChild(el);
    return { el, finish };
}

describe('settleFlipAnimations', () => {

    it('finishes every running animation, clears inline transforms, and strips flip/column classes', () => {
        const container = document.createElement('div');
        const card_a = seedCard(container, 'doc:a', 'flipping');
        const card_b = seedCard(container, 'doc:b', 'columnEntering');
        const card_c = seedCard(container, 'doc:c', 'columnExiting');

        settleFlipAnimations(container);

        expect(card_a.finish).toHaveBeenCalledTimes(1);
        expect(card_b.finish).toHaveBeenCalledTimes(1);
        expect(card_c.finish).toHaveBeenCalledTimes(1);
        expect(card_a.el.style.transform).toBe('');
        expect(card_b.el.style.transform).toBe('');
        expect(card_c.el.style.transform).toBe('');
        expect(card_a.el.classList.contains('flipping')).toBe(false);
        expect(card_b.el.classList.contains('columnEntering')).toBe(false);
        expect(card_c.el.classList.contains('columnExiting')).toBe(false);
        // a non-flip class on the card is left intact
        expect(card_a.el.classList.contains('note')).toBe(true);
    });

    it('finishes multiple animations on a single card', () => {
        const container = document.createElement('div');
        const el = document.createElement('div');
        el.setAttribute('data-flip-id', 'doc:multi');
        el.style.transform = 'translate(4px, 8px)';
        const finish_one = jest.fn();
        const finish_two = jest.fn();
        attachAnimations(el, [{ finish: finish_one }, { finish: finish_two }]);
        container.appendChild(el);

        settleFlipAnimations(container);

        expect(finish_one).toHaveBeenCalledTimes(1);
        expect(finish_two).toHaveBeenCalledTimes(1);
        expect(el.style.transform).toBe('');
    });

    it('strips a CSS-module-hashed flip class by substring match', () => {
        const container = document.createElement('div');
        const el = document.createElement('div');
        el.setAttribute('data-flip-id', 'doc:hashed');
        el.classList.add('ViewRenderer-module__flipping___a1b2', 'note');
        attachAnimations(el, []);
        container.appendChild(el);

        settleFlipAnimations(container);

        expect(Array.from(el.classList).some((token) => token.includes('flipping'))).toBe(false);
        expect(el.classList.contains('note')).toBe(true);
    });

    it('does not throw and still settles when getAnimations is unavailable (jsdom path)', () => {
        const container = document.createElement('div');
        const el = document.createElement('div');
        el.setAttribute('data-flip-id', 'doc:no-api');
        el.classList.add('flipping', 'note');
        el.style.transform = 'translate(5px, 5px)';
        // force the no-getAnimations branch regardless of the jsdom build's Web Animations support
        (el as unknown as { getAnimations?: undefined }).getAnimations = undefined;
        container.appendChild(el);

        expect(() => settleFlipAnimations(container)).not.toThrow();
        expect(el.style.transform).toBe('');
        expect(el.classList.contains('flipping')).toBe(false);
    });

    it('ignores elements without a data-flip-id', () => {
        const container = document.createElement('div');
        const non_card = document.createElement('div');
        non_card.classList.add('flipping');
        non_card.style.transform = 'translate(3px, 3px)';
        const finish = jest.fn();
        attachAnimations(non_card, [{ finish }]);
        container.appendChild(non_card);

        settleFlipAnimations(container);

        // no data-flip-id means settle never selects it, so its animation, transform, and class are untouched
        expect(finish).not.toHaveBeenCalled();
        expect(non_card.style.transform).toBe('translate(3px, 3px)');
        expect(non_card.classList.contains('flipping')).toBe(true);
    });

    it('is a no-op on an empty container', () => {
        const container = document.createElement('div');
        expect(() => settleFlipAnimations(container)).not.toThrow();
    });
});
