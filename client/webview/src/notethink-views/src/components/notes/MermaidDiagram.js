import { jsx as _jsx } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
import mermaid from 'mermaid';
let instance_count;
const MermaidDiagram = (props) => {
    const [element, setElement] = useState();
    const [render_result, setRenderResult] = useState();
    if (instance_count === undefined) {
        instance_count = 0;
    }
    const container_id = `${props.id || 'd' + (instance_count++)}-mermaid`;
    const diagram_text = props.children;
    useEffect(() => {
        mermaid.initialize({
            startOnLoad: true,
            logLevel: 5
        });
    }, []);
    const updateDiagramRef = useCallback((elem) => {
        if (!elem) {
            return;
        }
        setElement(elem);
    }, []);
    useEffect(() => {
        if (!element) {
            return;
        }
        if (!render_result?.svg) {
            return;
        }
        element.innerHTML = render_result.svg;
        render_result.bindFunctions?.(element);
    }, [
        element,
        render_result
    ]);
    useEffect(() => {
        if (!diagram_text || diagram_text.length === 0) {
            return;
        }
        (async () => {
            try {
                const rr = await mermaid.render(`${container_id}-svg`, diagram_text);
                setRenderResult(rr);
            }
            catch (e) {
                props.onError?.(e);
            }
        })();
    }, [
        diagram_text
    ]);
    return (_jsx("div", { className: props.className, onClick: props.onClick, id: container_id, "data-testid": props.testId, ref: updateDiagramRef }));
};
export { MermaidDiagram };
