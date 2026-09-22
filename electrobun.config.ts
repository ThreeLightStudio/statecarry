import type { ElectrobunConfig } from 'electrobun';
import { APP_VERSION } from './app-version';
import { desktopBuildProfile } from './apps/desktop/build-profile';

const profile = desktopBuildProfile();
const stable = profile.identifier === 'com.threelightstudio.statecarry';
const cacheRoot = stable ? '.cache/electrobun' : '.cache/electrobun/dev';

export default {
  app: { ...profile, version: APP_VERSION },
  build: {
    mainProcess: 'cottontail',
    cottontail: { entrypoint: 'apps/desktop/src/main.ts' },
    mac: { codesign: true, notarize: true, createDmg: true },
    copy: { [`${cacheRoot}/web`]: 'views/statecarry' },
    buildFolder: `${cacheRoot}/build`,
    artifactFolder: `${cacheRoot}/artifacts`,
  },
  release: {
    baseUrl: stable
      ? 'https://github.com/ThreeLightStudio/statecarry/releases/latest/download'
      : '',
    generatePatch: false,
  },
  runtime: { exitOnLastWindowClosed: true },
  scripts: { preBuild: 'apps/desktop/scripts/build-web.mjs' },
} satisfies ElectrobunConfig;
