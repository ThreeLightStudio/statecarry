export function desktopBuildProfile(env: NodeJS.ProcessEnv = process.env) {
  const channel = env.STATECARRY_DESKTOP_ENV ?? 'dev';
  if (channel !== 'dev' && channel !== 'stable')
    throw new Error('STATECARRY_DESKTOP_ENV must be dev or stable');
  return channel === 'stable'
    ? { name: 'StateCarry', identifier: 'com.threelightstudio.statecarry' }
    : { name: 'StateCarry Dev', identifier: 'com.threelightstudio.statecarry.dev' };
}

export function desktopRuntimeEnvironment(info: { channel: string; identifier: string }) {
  return info.channel === 'stable' && info.identifier === 'com.threelightstudio.statecarry'
    ? ('production' as const)
    : ('development' as const);
}
