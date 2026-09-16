import { createServerRuntime } from './runtime';

const runtime = createServerRuntime({
  onServerError(error) {
    console.error(error);
    process.exitCode = 1;
  },
});

try {
  await runtime.start();
  console.log(
    `StateCarry http://${runtime.host}:${runtime.port} | Node ${process.version} | ${runtime.dataDir}`,
  );
} catch {
  /* The runtime reports the server error and releases its resources. */
}

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  try {
    await runtime.stop();
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
