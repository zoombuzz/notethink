import { viewTypeLabel } from './viewTypeLabel';
import { registryWithUserTypes } from '../../lib/viewregistryops';
import type { UserViewType } from '../../types/Messages';

/*
 * A minted type is stored under two names: a slugified id, so it can be written as an `nt_view=` linetag
 * and saved as a settings key, and the free-text label its author typed. Only the label is fit to be
 * read, and these assert that every position words the label rather than the slug.
 */
describe('viewTypeLabel', () => {

    const NEXT_UP: UserViewType = {
        id: 'user-next-up-by-project',
        label: 'User next up by project',
        parent: 'kanban',
        overrides: { kanbanGroupBy: 'nt_first_level_folder' },
    };
    const REGISTRY = registryWithUserTypes([NEXT_UP]);

    it('capitalises a built-in type', () => {
        expect(viewTypeLabel('kanban')).toBe('Kanban');
    });

    it('resolves the auto selection against its resolved type', () => {
        expect(viewTypeLabel('auto', 'kanban')).toBe('Auto (Kanban)');
    });

    it('leaves auto plain when nothing has resolved yet', () => {
        expect(viewTypeLabel('auto')).toBe('Auto');
    });

    it('words a minted type with the label its author typed, not its slugified id', () => {
        expect(viewTypeLabel('user-next-up-by-project', undefined, REGISTRY)).toBe('User next up by project');
    });

    it('words a minted type the same way inside the auto form', () => {
        expect(viewTypeLabel('auto', 'user-next-up-by-project', REGISTRY)).toBe('Auto (User next up by project)');
    });

    it('falls back to the capitalised id when the type is not among the saved ones', () => {
        expect(viewTypeLabel('user-gone', undefined, REGISTRY)).toBe('User-gone');
    });

    it('leaves a built-in alone when user types are passed', () => {
        expect(viewTypeLabel('document', undefined, REGISTRY)).toBe('Document');
    });

    /*
     * The registry refuses to build a saved type that reuses a built-in's id, so wording one from the raw
     * saved list rather than from the registry would let a rejected type relabel the node it collided
     * with - a settings.json entry taking half effect after the guard turned it down.
     */
    it('does not let a saved type that reuses a built-in id relabel that built-in', () => {
        const shadow: UserViewType = { id: 'kanban', label: 'Not kanban', parent: 'line', overrides: {} };
        expect(viewTypeLabel('kanban', undefined, registryWithUserTypes([shadow]))).toBe('Kanban');
    });
});
