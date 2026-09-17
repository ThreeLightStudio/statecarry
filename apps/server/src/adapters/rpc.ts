import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { StringDecoder } from 'node:string_decoder';
import { executableEnvironment, resolveExecutable } from './executable-resolver';

// Small transport boundary inspired by Switchyard codex.ts; no business sessions or store dependencies.
export class CodexRpc extends EventEmitter {
  child: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private sequence = 0;
  private connecting: Promise<void> | null = null;
  private ready = false;
  constructor(
    private overrides: Record<string, unknown> = {},
    private cwd?: string,
    readonly timeout = 30000,
    readonly maxFrameBytes = 64 * 1024 * 1024,
    private keepAwake = false,
  ) {
    super();
  }
  async connect() {
    if (this.ready) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const args = ['proxy', 'codex', 'app-server', '--listen', 'stdio://'];
      for (const [key, value] of Object.entries(this.overrides))
        args.push('-c', `${key}=${JSON.stringify(value)}`);
      // Scoped to this analysis process group; no global power setting is changed.
      // User-initiated sleep/lid closure is not overridden by an idle-sleep assertion.
      const preventIdleSleep = this.keepAwake && process.platform === 'darwin';
      const rtk = resolveExecutable('rtk');
      if (!rtk)
        throw new Error(
          'RTK was not found. Install RTK or make it available in a standard user executable location.',
        );
      const child = spawn(
        preventIdleSleep ? '/usr/bin/caffeinate' : rtk,
        preventIdleSleep ? ['-i', rtk, ...args] : args,
        {
          cwd: this.cwd,
          stdio: 'pipe',
          detached: process.platform !== 'win32',
          env: executableEnvironment(['rtk', 'codex']),
        },
      );
      this.child = child;
      const decoder = new StringDecoder('utf8');
      let buffer = '',
        stderr = '';
      const fail = (error: Error) => {
        if (this.child !== child) return;
        this.ready = false;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(error);
        }
        this.pending.clear();
        this.emit('disconnect', error);
      };
      child.on('error', fail);
      child.on('exit', (code) => {
        fail(new Error(`Codex disconnected (${code}): ${stderr.slice(-500)}`));
        if (this.child === child) this.child = null;
      });
      child.stderr.on('data', (b) => {
        stderr = (stderr + String(b)).slice(-2000);
      });
      child.stdout.on('data', (b) => {
        buffer += decoder.write(b);
        if (Buffer.byteLength(buffer) > this.maxFrameBytes) {
          fail(new Error('Source response exceeds the declared transport frame limit'));
          child.kill();
          return;
        }
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            this.receive(JSON.parse(line));
          } catch (e) {
            fail(new Error(`Invalid Codex frame: ${String(e)}`));
            child.kill();
            return;
          }
        }
      });
      await this.call('initialize', {
        clientInfo: { name: 'statecarry', version: '0.1.4' },
        capabilities: { experimentalApi: true },
      });
      this.write({ method: 'initialized', params: {} });
      this.ready = true;
    })()
      .catch(async (e) => {
        await this.close();
        throw e;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }
  receive(packet: any) {
    if (typeof packet.method === 'string') {
      this.emit(packet.id === undefined ? 'notification' : 'serverRequest', packet);
      return;
    }
    const p = this.pending.get(packet.id);
    if (!p) return;
    this.pending.delete(packet.id);
    clearTimeout(p.timer);
    if (packet.error) p.reject(new Error(packet.error.message ?? 'Codex RPC failed'));
    else p.resolve(packet.result);
  }
  private write(packet: unknown) {
    if (!this.child?.stdin.writable) throw new Error('Codex transport is closed');
    this.child.stdin.write(JSON.stringify(packet) + '\n');
  }
  respond(id: string | number, result: unknown) {
    this.write({ id, result });
  }
  private call(method: string, params: unknown): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} response is unknown after timeout`));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async request(method: string, params: unknown = {}): Promise<any> {
    await this.connect();
    return this.call(method, params);
  }
  async close(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.ready = false;
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      const signal = (s: NodeJS.Signals) => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, s);
          else child.kill(s);
        } catch {}
      };
      const kill = setTimeout(() => signal('SIGKILL'), 2500);
      child.once('exit', () => {
        clearTimeout(kill);
        resolve();
      });
      child.stdin.end();
      signal('SIGTERM');
    });
  }
}
