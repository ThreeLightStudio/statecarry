import type { ElectrobunConfig } from 'electrobun';

export default {
  app: { name: 'StateCarry', identifier: 'com.threelightstudio.statecarry', version: '0.1.0' },
  build: {
    mainProcess: 'cottontail',
    cottontail: { entrypoint: 'apps/desktop/src/main.ts' },
    copy: { 'dist/web': 'views/statecarry' },
    buildFolder: '.cache/electrobun/build',
    artifactFolder: '.cache/electrobun/artifacts',
  },
  runtime: { exitOnLastWindowClosed: true },
  scripts: { preBuild: 'apps/desktop/scripts/build-web.mjs' },
} satisfies ElectrobunConfig;
