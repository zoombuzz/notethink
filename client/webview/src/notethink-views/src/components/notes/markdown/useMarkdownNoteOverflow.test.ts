import { bodyClipHeight } from "./useMarkdownNoteOverflow";

/*
 * The clip a card's body takes to land on a target height. jsdom lays nothing out, so each box below is the
 * rect the mock reports; what is asked is the arithmetic that turns a target into a max-height.
 */

function rectOf(height: number): DOMRect {
    return { width: 200, height, top: 0, left: 0, right: 200, bottom: height, x: 0, y: 0, toJSON() {} } as DOMRect;
}

/** a card of `card_height` holding a body of `body_height`, the body carrying whatever inline style is given */
function buildCard(card_height: number, body_height: number, body_style: Partial<CSSStyleDeclaration>): HTMLElement {
    const card = document.createElement('div');
    card.setAttribute('data-column-card-id', 'a');
    const body = document.createElement('div');
    Object.assign(body.style, body_style);
    card.appendChild(body);
    document.body.appendChild(card);
    card.getBoundingClientRect = () => rectOf(card_height);
    body.getBoundingClientRect = () => rectOf(body_height);
    return body;
}

describe('bodyClipHeight', () => {

    afterEach(() => { document.body.innerHTML = ''; });

    it('leaves the target less the card\'s chrome for a border-box body', () => {
        const body = buildCard(300, 240, { boxSizing: 'border-box', paddingBottom: '6px' });
        expect(bodyClipHeight(body, 200)).toBe(200 - 60);
    });

    /*
     * A content-box body draws its padding outside the height its max-height names, so the clip has to leave
     * room for it or the card overshoots the target by exactly that padding.
     */
    it('leaves room for the padding and border a content-box body draws outside its max-height', () => {
        const body = buildCard(300, 240, { boxSizing: 'content-box', paddingBottom: '6px', borderTopWidth: '1px', borderTopStyle: 'solid' });
        expect(bodyClipHeight(body, 200)).toBe(200 - 60 - 7);
    });

    it('never clips below the floor, so a tall headline still leaves some body showing', () => {
        const body = buildCard(500, 100, { boxSizing: 'border-box' });
        expect(bodyClipHeight(body, 200)).toBe(48);
    });
});
