'use strict';

const { ApiError } = require('./http.cjs');

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const QUALITIES = ['low', 'medium', 'high', 'auto'];
const MAGIC = [['image/png', [0x89, 0x50, 0x4e, 0x47]], ['image/jpeg', [0xff, 0xd8, 0xff]], ['image/webp', [0x52, 0x49, 0x46, 0x46]]];

function providerError(status, code) {
  if (status === 400 && /moderation|content_policy|safety/i.test(code || '')) return new ApiError(422, 'CONCEPT_REJECTED', 'The image provider declined this concept prompt.');
  if (status === 401 || status === 403) return new ApiError(502, 'IMAGE_PROVIDER_AUTH', 'The image provider rejected this deployment’s credentials.');
  if (status === 429) return new ApiError(503, 'IMAGE_PROVIDER_BUSY', 'The image provider is busy. Try again shortly.');
  return new ApiError(502, 'IMAGE_PROVIDER_FAILED', 'The image provider could not create a concept render.');
}

/**
 * Optional image-model adapter for any OpenAI-compatible Images API, including
 * Azure OpenAI's v1 endpoint. Only the server-rendered design map and the text
 * prompt are sent; source photographs and masks never leave the browser.
 */
function createImageGenerator({ env = process.env, fetch: fetchImpl = globalThis.fetch, timeoutMs: timeoutOverride } = {}) {
  const apiKey = env.RETHREAD_IMAGE_API_KEY, baseUrl = (env.RETHREAD_IMAGE_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  let host = null;
  try { const url = new URL(baseUrl); if (url.protocol === 'https:') host = url.host; } catch { /* reported as unconfigured */ }
  const model = env.RETHREAD_IMAGE_MODEL || 'gpt-image-1';
  const quality = QUALITIES.includes(env.RETHREAD_IMAGE_QUALITY) ? env.RETHREAD_IMAGE_QUALITY : 'medium';
  const timeoutMs = timeoutOverride ?? Math.min(120000, Math.max(5000, Number(env.RETHREAD_IMAGE_TIMEOUT_MS) || 40000));
  const auth = env.RETHREAD_IMAGE_AUTH === 'api-key' || env.RETHREAD_IMAGE_AUTH !== 'bearer' && host?.endsWith('.azure.com') ? 'api-key' : 'bearer';
  const configured = Boolean(apiKey && host && typeof fetchImpl === 'function');
  return {
    configured,
    describe: () => ({ configured, provider: host, model: configured ? model : null, quality: configured ? quality : null }),
    async generate({ prompt, referencePng, signal }) {
      if (!configured) throw new ApiError(503, 'IMAGE_GENERATION_UNCONFIGURED', 'Image generation is not configured on this deployment.');
      const form = new FormData();
      form.append('model', model); form.append('prompt', prompt); form.append('size', '1024x1024'); form.append('quality', quality); form.append('n', '1');
      form.append('image', new Blob([referencePng], { type: 'image/png' }), 'design-map.png');
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      const forward = () => controller.abort();
      signal?.addEventListener('abort', forward);
      const started = Date.now();
      let response;
      try {
        response = await fetchImpl(`${baseUrl}/images/edits`, { method: 'POST', headers: auth === 'api-key' ? { 'api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }, body: form, signal: controller.signal });
      } catch {
        throw controller.signal.aborted && !signal?.aborted ? new ApiError(504, 'IMAGE_PROVIDER_TIMEOUT', 'The image provider did not respond in time.') : new ApiError(502, 'IMAGE_PROVIDER_FAILED', 'The image provider could not be reached.');
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', forward); }
      if (!response.ok) {
        let code;
        try { code = (await response.json())?.error?.code; } catch { /* the status alone decides */ }
        throw providerError(response.status, code);
      }
      let item;
      try { item = (await response.json())?.data?.[0]; } catch { throw new ApiError(502, 'IMAGE_PROVIDER_FAILED', 'The image provider returned an unreadable response.'); }
      const bytes = typeof item?.b64_json === 'string' ? Buffer.from(item.b64_json, 'base64') : Buffer.alloc(0);
      const mimeType = MAGIC.find(([, magic]) => magic.every((b, i) => bytes[i] === b))?.[0];
      if (!mimeType || bytes.length > MAX_IMAGE_BYTES) throw new ApiError(502, 'IMAGE_PROVIDER_FAILED', 'The image provider did not return a supported image.');
      return { mimeType, base64: bytes.toString('base64'), model, provider: host, quality, elapsedMs: Date.now() - started,
        ...(typeof item.revised_prompt === 'string' ? { revisedPrompt: item.revised_prompt.slice(0, 4000) } : {}) };
    },
  };
}

module.exports = { createImageGenerator, providerError };
