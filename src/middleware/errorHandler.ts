import { NextFunction, Request, Response } from 'express';

// Catches any request that didn't match a route. Must be registered after
// every other app.use()/route, before errorHandler.
export const notFoundHandler = (req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
};

// Last-resort safety net, not a replacement for per-controller try/catch.
// Express 5 auto-forwards thrown/rejected errors from async route handlers
// to next(err), so anything that isn't already caught inline (a missed
// try/catch, a bug in shared middleware, a rejected promise) ends up here
// instead of crashing the process or leaking a stack trace to the client.
// Must keep all four parameters - Express only treats a middleware as an
// error handler when its arity is 4.
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  // If a response is already streaming, we can't send another one - hand off
  // to Express's default handler, which just closes the connection.
  if (res.headersSent) {
    return next(err);
  }

  console.error('[unhandled error]', err);

  const status = typeof err?.status === 'number' ? err.status
    : typeof err?.statusCode === 'number' ? err.statusCode
    : 500;

  res.status(status).json({ error: status < 500 ? (err?.message || 'Request failed') : 'Server error' });
};
