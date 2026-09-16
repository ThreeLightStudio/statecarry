export default {
  electrobun: { version: '2.0.1' },
  packageManager: 'pnpm',
  scripts: {
    install: ['hutch', 'pm', 'install', '--frozen-lockfile'],
    'desktop:prepare': ['hutch', 'electrobun', 'prepare'],
    'desktop:config': ['hutch', 'electrobun', 'config', '--env=dev'],
    'desktop:dev': ['hutch', 'electrobun', 'dev', '--watch'],
    'desktop:build': ['hutch', 'electrobun', 'build', '--env=dev'],
  },
};
