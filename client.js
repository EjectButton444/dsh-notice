/**
 * Browser half of dsh-notice.
 *
 * SPIKE (#2): shows exactly one debug Windows Toast per client-plugin load. It exists
 * only so the Electron renderer's Web Notification path (ownership name, icon, sound,
 * lock screen) and the ~500ms client HMR loop can be observed by editing BUILD_TAG.
 * Ticket #7 removes it together with the other debug triggers.
 *
 * Everything stays inside one IIFE on purpose: HMR re-executes this file as a fresh
 * classic script, and a top-level `const`/`let` would throw "already declared" on the
 * second execution, silently breaking every hot update.
 */
;(function () {
  const BUILD_TAG = 'spike-1'

  window.__ModuleLoader__.load({
    id: 'dsh-notice',
    factory() {
      return {
        apply(ctx) {
          ctx.effect(() => {
            const toast = showSpikeToast()
            return () => {
              toast?.close?.()
            }
          }, 'dsh-notice: spike toast')
        },
      }
    },
  })

  /**
   * Show the one-shot spike Toast.
   * @returns {Notification | undefined} the notification, or undefined when the
   * renderer has no Notification support.
   */
  function showSpikeToast() {
    if (typeof Notification === 'undefined') return undefined
    const time = new Date().toLocaleTimeString()
    const body = `build=${BUILD_TAG} perm=${Notification.permission} at=${time}`
    return new Notification('DSH Notice · toast spike', {
      body,
      tag: 'dsh-notice-spike',
      silent: false,
    })
  }
})()
