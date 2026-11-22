export function createInterrupts() {
  const interrupt = { by: undefined, child: undefined, dispose: undefined };
  const onSignal = (signal) => {
    interrupt.by ??= signal;
    if (interrupt.child) terminate(interrupt.child, signal);
  };
  const handlers = {
    SIGINT: () => onSignal('SIGINT'),
    SIGTERM: () => onSignal('SIGTERM'),
  };
  for (const [name, handler] of Object.entries(handlers)) process.on(name, handler);
  interrupt.dispose = () => {
    for (const [name, handler] of Object.entries(handlers)) process.off(name, handler);
  };
  return interrupt;
}

export function throwIfInterrupted(interrupt) {
  if (interrupt.by) throw new Error(`Interrupted by ${interrupt.by}`);
}

export function terminate(child, signal) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {}
  const escalation = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
      else child.kill('SIGKILL');
    } catch {}
  }, 1500);
  escalation.unref();
}

export function onceClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolvePromise) => child.once('close', resolvePromise));
}
