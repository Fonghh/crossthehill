// Cloudflare Workers entry: static game files from dist/, plus /api/turn.
import { turnCredentials, turnStatus } from './turn.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/turn') {
      if (request.method === 'POST') return turnCredentials(env);
      if (request.method === 'GET') return turnStatus(env);
      return new Response('Method not allowed', { status: 405 });
    }
    return env.ASSETS.fetch(request);
  },
};
