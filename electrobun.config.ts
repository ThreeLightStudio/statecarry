import type { ElectrobunConfig } from 'electrobun';

export default {
  app: { name: 'StateCarry', identifier: 'com.threelightstudio.statecarry', version: '0.1.1' },
  build: {
    mainProcess: 'cottontail',
    cottontail: { entrypoint: 'apps/desktop/src/main.ts' },
    mac: { codesign: true, notarize: true, createDmg: true },
    copy: { 'dist/web': 'views/statecarry' },
    buildFolder: '.cache/electrobun/build',
    artifactFolder: '.cache/electrobun/artifacts',
  },
  release: {
    baseUrl: 'https://github.com/ThreeLightStudio/statecarry/releases/latest/download',
    generatePatch: false,
  },
  runtime: { exitOnLastWindowClosed: true },
  scripts: { preBuild: 'apps/desktop/scripts/build-web.mjs' },
} satisfies ElectrobunConfig;
