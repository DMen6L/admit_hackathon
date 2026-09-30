/** A brief visual lead makes an incoming projectile distinct from its warning. */
export function opponentSoundDelayMs(releaseAt: number, impactAt: number): number {
  return Math.min(80, Math.max(0, (impactAt - releaseAt) * .1));
}
