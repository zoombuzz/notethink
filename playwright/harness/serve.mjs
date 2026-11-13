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
// a production-mode run serves the webview bundle from this directory instead of client/webview/dist
const DIST_OVERRIDE = process.env.NOTETHINK_HARNESS_DIST ? join(ROOT, process.env.NOTETHINK_HARNESS_DIST) : undefined;
const DIST_ROUTE = '/client/webview/dist/';

createServer(async (req, res) => {
    const url_path = decodeURIComponent(req.url.split('?')[0]);
    const file_path = DIST_OVERRIDE && url_path.startsWith(DIST_ROUTE) ? join(DIST_OVERRIDE, url_path.slice(DIST_ROUTE.length)) : join(ROOT, url_path);
    try {
        const data = await readFile(file_path);
        res.writeHead(200, { 'Content-Type': MIME[extname(file_path)] || 'application/octet-stream' });
        res.end(data);
    } catch {
        res.writeHead(404);
        res.end('Not found');
    }
}).listen(PORT, () => console.log(`Harness server on http://localhost:${PORT}`));
