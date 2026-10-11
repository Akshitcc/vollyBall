/**
 * Launch prep: production bundles (EXPO_PUBLIC_STRIP_DEMO=1, metro.config.js) get this instead of
 * services/backend/demoBackend.ts – no demo database, seed data, demo admin or offline simulator ships.
 * `backend instanceof DemoBackend` is simply false; constructing it is a build mistake.
 */
export class DemoBackend {
  readonly mode = 'demo' as const;
  constructor() {
    throw new Error('The demo backend is not part of production builds (EXPO_PUBLIC_STRIP_DEMO=1).');
  }
  reset(): void {}
  canBeDemoAdmin(_uid?: string): boolean {
    return false;
  }
  isDemoAdmin(_uid?: string): boolean {
    return false;
  }
  async setDemoAdmin(_on?: boolean): Promise<void> {}
}
