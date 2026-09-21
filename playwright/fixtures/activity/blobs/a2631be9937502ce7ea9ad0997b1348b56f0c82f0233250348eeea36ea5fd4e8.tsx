export default function StickyNote(props: { title: string, hue: number }) {
    return <div className="sticky" style={{ backgroundColor: `hsl(${props.hue} 65% 72%)` }}>{props.title}</div>;
}
