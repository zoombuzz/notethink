import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..');
const MIME = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};
const PORT = Number(process.env.PORT || 9123);

createServer(async (req, res) => {
    const url_path = decodeURIComponent(req.url.split('?')[0]);
    const file_path = join(ROOT, url_path);
    try {
        const data = await readFile(file_path);
        res.writeHead(200, { 'Content-Type': MIME[extname(file_path)] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
}).listen(PORT, () => console.log(`Harness server on http://localhost:${PORT}`));
