/**
 * Serves the page shell for the admin section and member portal.
 *
 * The shell is src/ui.html. Its stylesheet and script are ordinary files in
 * public/ (app.css, app.js), which Cloudflare serves as static assets without
 * running this worker. Every other non-API address gets the shell, and the
 * script in app.js decides which page to show.
 */

import html from './ui.html';

export function serveUI(request, env) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cache-Control': 'no-store',
    },
  });
}
