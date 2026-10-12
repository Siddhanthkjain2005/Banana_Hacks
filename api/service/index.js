const { createHandler } = require('../lib/service.cjs');
// One structured line per request: correlation ID, route, status, and duration. No request content or client address.
const handler = createHandler({ logger: (entry, context) => context?.log?.(JSON.stringify({ event: 'rethread.request', ...entry })) });

module.exports = async function (context, req) {
  context.res = await handler(req, context);
};
