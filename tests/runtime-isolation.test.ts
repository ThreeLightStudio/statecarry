import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runtimeSettings } from '../runtime-config';
import { desktopBuildProfile, desktopRuntimeEnvironment } from '../apps/desktop/build-profile';
import { createServerRuntime, type ServerRuntime } from '../apps/server/src/runtime';

function projects(runtime: ServerRuntime, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request(
      { hostname: runtime.host, port: runtime.port, path: '/api/v1/projects', headers },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(body) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('development and production isolation', () => {
  it('keeps the installed profile and ignores inherited development settings in production', () => {
    const home = mkdtempSync(join(tmpdir(), 'statecarry-profile-'));
    try {
      const env = { STATECARRY_PORT: '4433', STATECARRY_DATA_DIR: join(home, 'custom-dev') };
      expect(runtimeSettings({ environment: 'production', home, env })).toEqual({
        dataDir: join(home, '.statecarry'),
        port: 0,
      });
      expect(runtimeSettings({ environment: 'development', home, env })).toEqual({
        dataDir: env.STATECARRY_DATA_DIR,
        port: 4433,
      });
      expect(runtimeSettings({ environment: 'development', home, env: {} })).toEqual({
        dataDir: join(home, '.statecarry-dev'),
        port: 4310,
      });
      const production = join(home, '.statecarry');
      mkdirSync(production);
      const alias = join(home, 'alias');
      symlinkSync(production, alias, 'dir');
      for (const dataDir of [
        production,
        join(production, 'nested'),
        home,
        alias,
        join(alias, 'new'),
      ]) {
        expect(() => runtimeSettings({ environment: 'development', home, dataDir })).toThrow(
          'Development data must be separate',
        );
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('assigns separate native identities and defaults unqualified builds to development', () => {
    expect(desktopBuildProfile({})).toEqual({
      name: 'StateCarry Dev',
      identifier: 'com.threelightstudio.statecarry.dev',
    });
    expect(desktopBuildProfile({ STATECARRY_DESKTOP_ENV: 'stable' })).toEqual({
      name: 'StateCarry',
      identifier: 'com.threelightstudio.statecarry',
    });
    expect(() => desktopBuildProfile({ STATECARRY_DESKTOP_ENV: 'invalid' })).toThrow();
    expect(
      desktopRuntimeEnvironment({
        channel: 'stable',
        identifier: 'com.threelightstudio.statecarry',
      }),
    ).toBe('production');
    expect(
      desktopRuntimeEnvironment({ channel: 'dev', identifier: 'com.threelightstudio.statecarry' }),
    ).toBe('development');
    expect(
      desktopRuntimeEnvironment({
        channel: 'stable',
        identifier: 'com.threelightstudio.statecarry.dev',
      }),
    ).toBe('development');
  });

  it('runs both servers independently and rejects development requests at the production server', async () => {
    const home = mkdtempSync(join(tmpdir(), 'statecarry-isolation-'));
    const devSettings = runtimeSettings({ environment: 'development', home, env: {}, port: 0 });
    const prodSettings = runtimeSettings({ environment: 'production', home, env: {} });
    const development = createServerRuntime({ ...devSettings, environment: 'development' });
    const production = createServerRuntime({
      ...prodSettings,
      environment: 'production',
      env: { STATECARRY_PORT: '4310', STATECARRY_DATA_DIR: devSettings.dataDir },
    });
    try {
      await development.start();
      await production.start();
      expect(production.port).toBeGreaterThan(0);
      expect(production.port).not.toBe(development.port);
      production.core.connect({
        requestId: production.core.ids.next(),
        expectedRevision: 0,
        payload: {
          title: 'Production only',
          cwd: home,
          threadIds: ['test-thread'],
          discover: false,
        },
      });
      expect((await projects(production)).body).toMatchObject({
        projects: [{ title: 'Production only' }],
      });
      expect(await projects(development, { Origin: 'http://127.0.0.1:4311' })).toEqual({
        status: 200,
        body: { projects: [] },
      });
      expect((await projects(production, { Origin: 'http://127.0.0.1:4311' })).status).toBe(403);
      expect(
        (await projects(production, { Origin: `http://127.0.0.1:${development.port}` })).status,
      ).toBe(403);
      expect((await projects(production, { Host: '127.0.0.1:4310' })).status).toBe(403);
      expect((await projects(production, { Host: '127.0.0.1:4311' })).status).toBe(403);
      expect(
        (await projects(production, { Origin: `http://127.0.0.1:${production.port}` })).status,
      ).toBe(200);
      await production.stop();
      expect(await projects(development)).toEqual({ status: 200, body: { projects: [] } });
    } finally {
      await Promise.all([development.stop(), production.stop()]);
      rmSync(home, { recursive: true, force: true });
    }
  });
});
