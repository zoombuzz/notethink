import React, { useCallback, useEffect, useState, MouseEvent } from "react";
import mermaid, { type RenderResult } from 'mermaid';

export interface MermaidDiagramProps {
    children: string;
    id?: string;
    testId?: string;
    className?: string;
    onClick?: (event: MouseEvent<HTMLElement>) => void;
    onError?: (error: unknown) => void;
}

let instance_count: number;

const MermaidDiagram = (props: MermaidDiagramProps) => {
    const [element, setElement] = useState<HTMLDivElement>();
    const [render_result, setRenderResult] = useState<RenderResult>();
    if (instance_count === undefined) { instance_count = 0; }

    const container_id = `${props.id || 'd' + (instance_count++)}-mermaid`;
    const diagram_text = props.children;

    useEffect(() => {
        mermaid.initialize({
            startOnLoad: true,
            logLevel: 5
        });
    }, []);

    const updateDiagramRef = useCallback((elem: HTMLDivElement) => {
        if (!elem) { return; }
        setElement(elem);
    }, []);

    useEffect(() => {
        if (!element) { return; }
        if (!render_result?.svg) { return; }
        element.innerHTML = render_result.svg;
        render_result.bindFunctions?.(element);
    }, [
        element,
        render_result
    ]);

    useEffect(() => {
        if (!diagram_text || diagram_text.length === 0) { return; }
        (async () => {
            try {
                const rr = await mermaid.render(`${container_id}-svg`, diagram_text);
                setRenderResult(rr);
            } catch (e: unknown) {
                props.onError?.(e);
            }
        })();
    }, [
        diagram_text
    ]);

    return (
        <div className={props.className}
             onClick={props.onClick}
             id={container_id}
             data-testid={props.testId}
             ref={updateDiagramRef}
        />
    );
};

export { MermaidDiagram };
