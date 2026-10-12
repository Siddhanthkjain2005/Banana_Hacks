'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = message => { throw new ApiError(400, 'INVALID_INPUT', message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hashToken = token => createHash('sha256').update(token).digest('hex');
const TOKEN_RE = /^[0-9a-f]{64}$/i;

/**
 * A read-only capability derived from the owner capability. The server stores
 * only its hash, so neither token can be recovered from a saved record, and the
 * owner token cannot be derived from a shared viewer token.
 */
const deriveShareToken = ownerToken => createHmac('sha256', ownerToken.toLowerCase()).update('rethread-share-v1').digest('hex');

function header(req, name) {
  const key = Object.keys(req.headers || {}).find(k => k.toLowerCase() === name.toLowerCase());
  const value = key ? req.headers[key] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function exactKeys(value, allowed, name) {
  if (!object(value)) bad(`${name} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) bad(`${name} contains an unsupported field.`);
}

function numberInRange(value, low, high, name, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || integer && !Number.isInteger(value) || value < low || value > high) bad(`${name} must be ${integer ? 'an integer' : 'a number'} between ${low} and ${high}.`);
  return value;
}

/** Constant-time comparison of a presented capability against a stored SHA-256 hash. */
function tokenMatches(token, hash) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token) || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(hashToken(token), 'hex'), Buffer.from(hash, 'hex'));
}

module.exports = { ApiError, bad, object, hashToken, deriveShareToken, header, exactKeys, numberInRange, tokenMatches, TOKEN_RE };
