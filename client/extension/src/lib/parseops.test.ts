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

	// Unicode edge cases
	describe('unicode characters', () => {
		it('parses headings with emoji', () => {
			const result = parse('# 🚀 Launch Plan\n## 📋 Tasks');
			const headings = result.children.filter((c: any) => c.type === 'heading');
			expect(headings).toHaveLength(2);
			expect((headings[0] as any).depth).toBe(1);
			expect((headings[1] as any).depth).toBe(2);
		});

		it('parses CJK characters in content', () => {
			const result = parse('# 日本語の見出し\n\n中文段落内容。\n\n한국어 텍스트');
			expect(result.children.length).toBeGreaterThan(0);
			const heading = result.children[0] as any;
			expect(heading.type).toBe('heading');
			const paras = result.children.filter((c: any) => c.type === 'paragraph');
			expect(paras).toHaveLength(2);
		});

		it('parses accented and diacritical characters', () => {
			const result = parse('# Ñoño résumé naïve über café');
			const heading = result.children[0] as any;
			expect(heading.type).toBe('heading');
			expect(heading.children[0].value).toBe('Ñoño résumé naïve über café');
		});

		it('parses combining characters and zero-width joiners', () => {
			const result = parse('# e\u0301 a\u0300 n\u0303\n\nText with ZWJ: 👨\u200D👩\u200D👧\u200D👦');
			expect(result.children.length).toBeGreaterThan(0);
			expect(result.children[0].type).toBe('heading');
		});

		it('parses RTL text (Arabic/Hebrew)', () => {
			const result = parse('# مرحبا بالعالم\n\nשלום עולם');
			const heading = result.children[0] as any;
			expect(heading.type).toBe('heading');
			const para = result.children[1] as any;
			expect(para.type).toBe('paragraph');
		});

		it('parses code blocks with unicode content', () => {
			const markdown = '```python\nprint("こんにちは世界 🌍")\n```';
			const result = parse(markdown);
			const code = result.children.find((c: any) => c.type === 'code') as any;
			expect(code).toBeDefined();
			expect(code.value).toBe('print("こんにちは世界 🌍")');
			expect(code.lang).toBe('python');
		});

		it('parses GFM tables with unicode cell content', () => {
			const markdown = '| Emoji | 日本語 |\n|---|---|\n| 🎉 | テスト |';
			const result = parse(markdown);
			const table = result.children.find((c: any) => c.type === 'table');
			expect(table).toBeDefined();
		});

		it('handles mathematical symbols and special unicode', () => {
			const result = parse('# ∑∏∫ Mathematics\n\n∀x ∈ ℝ: x² ≥ 0');
			expect(result.children[0].type).toBe('heading');
			expect(result.children[1].type).toBe('paragraph');
		});
	});

	// GFM footnotes
	describe('GFM footnotes', () => {
		it('parses footnote references and definitions', () => {
			const markdown = 'Text with a footnote[^1].\n\n[^1]: This is the footnote content.';
			const result = parse(markdown);
			const footnote_ref = result.children.find((c: any) => c.type === 'paragraph');
			expect(footnote_ref).toBeDefined();
			const footnote_def = result.children.find((c: any) => c.type === 'footnoteDefinition');
			expect(footnote_def).toBeDefined();
			expect((footnote_def as any).identifier).toBe('1');
		});

		it('parses multiple footnotes', () => {
			const markdown = 'First[^a] and second[^b].\n\n[^a]: Note A.\n\n[^b]: Note B.';
			const result = parse(markdown);
			const defs = result.children.filter((c: any) => c.type === 'footnoteDefinition');
			expect(defs).toHaveLength(2);
		});

		it('parses footnote with multi-line content', () => {
			const markdown = 'Text[^long].\n\n[^long]: First line.\n    Continuation line.';
			const result = parse(markdown);
			const def = result.children.find((c: any) => c.type === 'footnoteDefinition') as any;
			expect(def).toBeDefined();
			expect(def.identifier).toBe('long');
		});
	});

	// Large file performance
	describe('large file (1000+ lines)', () => {
		it('parses a 1500-line markdown file correctly', () => {
			const lines: string[] = [];
			for (let i = 0; i < 150; i++) {
				lines.push(`## Section ${i}`);
				for (let j = 0; j < 8; j++) {
					lines.push(`Paragraph line ${j} in section ${i} with some body text.`);
				}
				lines.push('');
			}
			const markdown = lines.join('\n');
			expect(markdown.split('\n').length).toBeGreaterThan(1000);

			const result = parse(markdown);
			expect(result.type).toBe('root');
			const headings = result.children.filter((c: any) => c.type === 'heading');
			expect(headings).toHaveLength(150);
		});

		it('parses a 1500-line file in under 200ms', () => {
			const lines: string[] = [];
			for (let i = 0; i < 150; i++) {
				lines.push(`## Section ${i}`);
				for (let j = 0; j < 8; j++) {
					lines.push(`- task ${j}: some descriptive text here`);
				}
				lines.push('');
			}
			const markdown = lines.join('\n');

			// warm-up
			parse(markdown);

			const start = performance.now();
			parse(markdown);
			const elapsed = performance.now() - start;
			expect(elapsed).toBeLessThan(200);
		});
	});

	// Mixed content (all features in one document)
	describe('mixed content document', () => {
		it('parses frontmatter + GFM features + unicode in one document', () => {
			const markdown = [
				'---',
				'title: 🚀 テスト Document',
				'tags: [test, unicode]',
				'---',
				'',
				'# Main Title',
				'',
				'A paragraph with **bold**, *italic*, and ~~strikethrough~~.',
				'',
				'| Column A | Column B |',
				'|----------|----------|',
				'| cell 1   | cell 2   |',
				'',
				'- [ ] unchecked task',
				'- [x] checked task',
				'',
				'```ts',
				'const greeting = "こんにちは";',
				'```',
				'',
				'Footnote reference[^note].',
				'',
				'[^note]: Footnote with émojis 🎉.',
			].join('\n');

			const result = parse(markdown);
			expect(result.type).toBe('root');

			const types = result.children.map((c: any) => c.type);
			expect(types).toContain('yaml');
			expect(types).toContain('heading');
			expect(types).toContain('table');
			expect(types).toContain('list');
			expect(types).toContain('code');
			expect(types).toContain('footnoteDefinition');
		});
	});
});
