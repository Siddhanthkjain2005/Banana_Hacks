// Keep the HTTP entry loadable even if a deployment dependency cannot initialize.
let handler, startupError;
try {
  const { createHandler } = require('../lib/service.cjs');
  // Log metadata only: no request content, client address, or capabilities.
  handler = createHandler({ logger: (entry, context) => context?.log?.(JSON.stringify({ event: 'rethread.request', ...entry })) });
} catch (error) {
  startupError = {
    causeCode: typeof error.code === 'string' ? error.code : 'INITIALIZATION_ERROR',
    missingModule: /Cannot find module '([^']+)'/.exec(error.message || '')?.[1] || null,
  };
}

module.exports = async function (context, req) {
  if (startupError) {
    context.log?.(JSON.stringify({ event: 'rethread.startup_failed', ...startupError }));
    context.res = { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      body: { error: { code: 'API_STARTUP_FAILED', message: 'The geometry service is temporarily unavailable.', ...startupError } } };
    return;
  }
  context.res = await handler(req, context);
};
