// Cloudflare Pages Function: /api/turn (same logic as the Workers entry).
import { turnCredentials, turnStatus } from '../../worker/turn.js';

export const onRequestPost = ({ env }) => turnCredentials(env);
export const onRequestGet = ({ env }) => turnStatus(env);
