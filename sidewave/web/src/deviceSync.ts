/** Takeovers are explicit server revisions; heartbeats must never claim ownership. */
export class DeviceTakeovers {
  private revision = 0;
  observe(revision: unknown, activeDeviceId: string | null, thisDeviceId: string) {
    const next = Number(revision) || 0;
    if (next <= this.revision) return false;
    this.revision = next;
    return !!activeDeviceId && activeDeviceId !== thisDeviceId;
  }
}
