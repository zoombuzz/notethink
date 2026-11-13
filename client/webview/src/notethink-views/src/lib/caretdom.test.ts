import { textOffsetWithin } from './caretdom';

function container(html: string): HTMLElement {
    const element = document.createElement('span');
    element.innerHTML = html;
    document.body.appendChild(element);
    return element;
}

describe('textOffsetWithin', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('counts the characters of the text nodes before a position, across inline elements', () => {
        const element = container('ab<strong>cd</strong>ef');
        const strong_text = element.querySelector('strong')!.firstChild!;
        expect(textOffsetWithin(element, element.firstChild!, 1)).toBe(1);
        expect(textOffsetWithin(element, strong_text, 1)).toBe(3);
        expect(textOffsetWithin(element, element.lastChild!, 2)).toBe(6);
    });

    it('resolves an element-boundary position by the text before it', () => {
        const element = container('ab<strong>cd</strong>ef');
        expect(textOffsetWithin(element, element, 2)).toBe(4);
        expect(textOffsetWithin(element, element, 0)).toBe(0);
    });

    it('returns the text length for a position outside the container', () => {
        const element = container('abc');
        expect(textOffsetWithin(element, document.body, 0)).toBe(3);
    });
});
