import { parse } from './parseops';

describe('parseops', () => {
	describe('parse()', () => {
		it('returns a valid MDAST root node for basic markdown', () => {
			const result = parse('# Hello\n\nA paragraph.');
			expect(result).toBeDefined();
			expect(result.type).toBe('root');
			expect(result.children).toBeDefined();
			expect(result.children.length).toBeGreaterThan(0);
		});

		it('parses a heading node', () => {
			const result = parse('# Title');
			const heading = result.children[0];
			expect(heading.type).toBe('heading');
			expect((heading as any).depth).toBe(1);
		});

		it('parses nested headings', () => {
			const result = parse('# H1\n## H2\n### H3');
			const headings = result.children.filter((c: any) => c.type === 'heading');
			expect(headings).toHaveLength(3);
			expect((headings[0] as any).depth).toBe(1);
			expect((headings[1] as any).depth).toBe(2);
			expect((headings[2] as any).depth).toBe(3);
		});

		it('parses a paragraph with inline elements', () => {
			const result = parse('This has **bold** and *italic* text.');
			const para = result.children[0] as any;
			expect(para.type).toBe('paragraph');
			expect(para.children.length).toBeGreaterThan(1);
			const strong = para.children.find((c: any) => c.type === 'strong');
			expect(strong).toBeDefined();
			const emphasis = para.children.find((c: any) => c.type === 'emphasis');
			expect(emphasis).toBeDefined();
		});

		it('returns a root with empty children for an empty string', () => {
			const result = parse('');
			expect(result.type).toBe('root');
			expect(result.children).toEqual([]);
		});

		it('handles whitespace-only input', () => {
			const result = parse('   \n\n   ');
			expect(result.type).toBe('root');
		});

		// GFM features
		it('parses GFM tables', () => {
			const markdown = '| A | B |\n|---|---|\n| 1 | 2 |';
			const result = parse(markdown);
			const table = result.children.find((c: any) => c.type === 'table');
			expect(table).toBeDefined();
		});

		it('parses GFM task lists', () => {
			const markdown = '- [ ] unchecked\n- [x] checked';
			const result = parse(markdown);
			const list = result.children[0] as any;
			expect(list.type).toBe('list');
			expect(list.children).toHaveLength(2);
			expect(list.children[0].checked).toBe(false);
			expect(list.children[1].checked).toBe(true);
		});

		it('parses GFM strikethrough', () => {
			const markdown = '~~deleted~~';
			const result = parse(markdown);
			const para = result.children[0] as any;
			const del = para.children.find((c: any) => c.type === 'delete');
			expect(del).toBeDefined();
		});

		it('parses GFM autolinks', () => {
			const markdown = 'Visit https://example.com for more.';
			const result = parse(markdown);
			const para = result.children[0] as any;
			const link = para.children.find((c: any) => c.type === 'link');
			expect(link).toBeDefined();
			expect(link.url).toBe('https://example.com');
		});

		// Frontmatter
		it('parses YAML frontmatter', () => {
			const markdown = '---\ntitle: Test\ndate: 2024-01-01\n---\n\n# Content';
			const result = parse(markdown);
			const fm = result.children.find((c: any) => c.type === 'yaml');
			expect(fm).toBeDefined();
			expect((fm as any).value).toContain('title: Test');
		});

		it('parses TOML frontmatter', () => {
			const markdown = '+++\ntitle = "Test"\n+++\n\n# Content';
			const result = parse(markdown);
			const fm = result.children.find((c: any) => c.type === 'toml');
			expect(fm).toBeDefined();
			expect((fm as any).value).toContain('title = "Test"');
		});

		// Position data
		it('includes position data on nodes', () => {
			const result = parse('# Hello');
			const heading = result.children[0] as any;
			expect(heading.position).toBeDefined();
			expect(heading.position.start).toBeDefined();
			expect(heading.position.end).toBeDefined();
			expect(heading.position.start.line).toBe(1);
		});

		// Code blocks
		it('parses fenced code blocks', () => {
			const markdown = '```js\nconsole.log("hi");\n```';
			const result = parse(markdown);
			const code = result.children.find((c: any) => c.type === 'code');
			expect(code).toBeDefined();
			expect((code as any).lang).toBe('js');
			expect((code as any).value).toBe('console.log("hi");');
		});

		// Links and images
		it('parses links', () => {
			const markdown = '[click here](https://example.com)';
			const result = parse(markdown);
			const para = result.children[0] as any;
			const link = para.children.find((c: any) => c.type === 'link');
			expect(link).toBeDefined();
			expect(link.url).toBe('https://example.com');
		});

		it('parses images', () => {
			const markdown = '![alt text](image.png)';
			const result = parse(markdown);
			const para = result.children[0] as any;
			const img = para.children.find((c: any) => c.type === 'image');
			expect(img).toBeDefined();
			expect(img.url).toBe('image.png');
			expect(img.alt).toBe('alt text');
		});
	});
});
