const express = require('express');

// Express 4 does not catch a rejected promise from a handler: the rejection
// becomes an unhandled rejection and the request simply hangs until the client
// gives up. Now that every route awaits the database, that would be the normal
// failure mode rather than a rare one.
//
// This returns an ordinary Router whose method registration wraps each handler
// so rejections are forwarded to next(), where the error middleware in
// index.js turns them into a 500 like any other thrown error.

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use'];

function wrap(handler) {
  if (typeof handler !== 'function') return handler;
  // Error-handling middleware is identified by arity, so preserve the 4-arg
  // shape rather than collapsing everything to 3.
  if (handler.length === 4) {
    return function wrapped(err, req, res, next) {
      try {
        return Promise.resolve(handler(err, req, res, next)).catch(next);
      } catch (e) {
        return next(e);
      }
    };
  }
  return function wrapped(req, res, next) {
    try {
      return Promise.resolve(handler(req, res, next)).catch(next);
    } catch (e) {
      return next(e);
    }
  };
}

function asyncRouter(options) {
  const router = express.Router(options);
  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(wrap));
  }
  return router;
}

module.exports = { asyncRouter, wrap };
