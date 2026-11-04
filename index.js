/**
 * Host half of dsh-notice.
 *
 * The spike (#2) deliberately keeps it a no-op: the browser half owns the Windows
 * Toast. P1 fills this half with the precise `turn/end` feed and the click-to-focus
 * bridge (ADR-0002); it must stay a read-only side channel.
 */
export const name = 'dsh-notice'

export function apply() {}
