const { createHandler } = require('../lib/service.cjs');
const handler = createHandler();

module.exports = async function (context, req) {
  context.res = await handler(req);
};
