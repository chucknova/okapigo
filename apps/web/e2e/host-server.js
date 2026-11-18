// @ts-check
/**
 * A stand-in for an operator's OWN website (stage 12h): serves e2e/host/index.html on
 * :4200, a different origin from OkapiGo's :4100, so the widget is embedded cross-site,
 * like the real thing. Only that one file; nothing else is served.
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.HOST_PORT ?? 4200);
const page = readFileSync(new URL('./host/index.html', import.meta.url));

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path !== '/' && path !== '/index.html') {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page);
}).listen(PORT, () => process.stdout.write(`host site on http://localhost:${PORT}\n`));
