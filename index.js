/**
 * Host half of dsh-notice.
 *
 * P0 shipped this half as a registration-only no-op. Ticket #5 needs the profile
 * config (`cordis.patch.yml` loader-row `config`) to reach the browser half, so this
 * half exposes the effective row config as one read-only document-relative JSON
 * route: `GET /dsh-notice/config` (served by `ctx.webServer`, the same mechanism the
 * HMR package uses for `/plugins/events`). The browser half fetches it once per load.
 *
 * Config normalization/validation lives in the pure decision engine
 * (`client.engine.js`): a third-party host bundle cannot resolve the DSH-internal
 * `@deepseek-ai/schemastery` shared package at runtime (measured: ERR_MODULE_NOT_FOUND
 * from both the DSH Electron node and system node), so the loader passes the row
 * config through and the engine fills defaults / rejects unknown values. See
 * docs/spikes/05-notification-rules.md for the evidence.
 *
 * This half is a read-only side channel: no business logic, no notification rules,
 * and every failure is only logged — it must never disturb DSH (ADR-0002).
 */
export const name = 'dsh-notice'

/** `webServer` owns the HTTP route registry; without it the config route cannot exist. */
export const inject = ['webServer']

/** Route owned by this plugin; the browser half fetches it document-relative as `dsh-notice/config`. */
const CONFIG_ENDPOINT = '/dsh-notice/config'

/**
 * Mount the read-only config route.
 * @param ctx - host plugin context (carries `webServer`).
 * @param config - the row config as validated by the loader, if any (else `undefined`).
 */
export function apply(ctx, config) {
  try {
    const settings = config !== null && typeof config === 'object' ? config : {}
    ctx.effect(
      () => {
        try {
          return ctx.webServer.register({
            kind: 'exact',
            path: CONFIG_ENDPOINT,
            handler: (req, res) => serveConfig(req, res, settings),
          })
        } catch (error) {
          // Route registration failing must not take the plugin (or the session) down.
          console.warn('[dsh-notice] config route registration failed', error)
          return () => {}
        }
      },
      'dsh-notice: config route',
    )
  } catch (error) {
    console.warn('[dsh-notice] config route unavailable', error)
  }
}

/** Serve the row config; GET/HEAD only, never cached. */
function serveConfig(req, res, settings) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' })
      res.end()
      return
    }
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    if (req.method === 'HEAD') {
      res.end()
      return
    }
    res.end(JSON.stringify(settings))
  } catch (error) {
    // Best effort only: a broken config read must never break the session.
    try {
      res.destroy()
    } catch (_) {
      /* ignore */
    }
    console.warn('[dsh-notice] config route failed', error)
  }
}
