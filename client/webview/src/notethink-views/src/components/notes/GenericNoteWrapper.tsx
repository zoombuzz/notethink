import Debug from "debug";
import React from "react";
import { getStandardNoteDataProps, renderBodyItems } from "../../lib/renderops";
import type { NoteProps } from "../../types/NoteProps";

const debug = Debug("nodejs:notethink-views:GenericNoteWrapper");

export default function GenericNoteWrapper(props: NoteProps): React.ReactElement | undefined {
    const note = props;
    const data_props = getStandardNoteDataProps(note);

    // render note wrapper
    switch (note.type) {
        case 'list':
            return <ul id={note.display_options?.id} {...data_props}>{renderBodyItems(note, note.children_body)}</ul>;
        case 'listItem':
            return <li id={note.display_options?.id} {...data_props}>{renderBodyItems(note, note.children_body, { checked: note.checked })}</li>;
    }
}
