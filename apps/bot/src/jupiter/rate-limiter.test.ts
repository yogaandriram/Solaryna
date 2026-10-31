import { describe, expect, it } from 'vitest';
import { createRateLimiter, type RequestPriority } from './rate-limiter';

/** A clock that only moves when the limiter sleeps. */
function fakeClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: (ms: number) => {
      time += ms;
      return Promise.resolve();
    },
    set: (value: number) => {
      time = value;
    },
  };
}

function setup() {
  const clock = fakeClock();
  const limiter = createRateLimiter({ now: clock.now, sleep: clock.sleep });
  const started: { label: string; at: number }[] = [];
  const run = (priority: RequestPriority, label: string) =>
    limiter.schedule(priority, () => {
      started.push({ label, at: clock.now() });
      return Promise.resolve(label);
    });
  return { clock, limiter, started, run };
}

describe('createRateLimiter', () => {
  it('serves exits first, then buys, then monitoring', async () => {
    const { started, run } = setup();
    await Promise.all([run('monitor', 'm'), run('buy', 'b'), run('exit', 'e')]);
    expect(started.map((s) => s.label)).toEqual(['e', 'b', 'm']);
  });

  it('keeps FIFO order within a priority and spaces request starts by 1 s', async () => {
    const { started, run } = setup();
    await Promise.all([run('buy', 'b1'), run('buy', 'b2'), run('buy', 'b3')]);
    expect(started).toEqual([
      { label: 'b1', at: 0 },
      { label: 'b2', at: 1000 },
      { label: 'b3', at: 2000 },
    ]);
  });

  it('promotes monitoring that waited 30 s ahead of newer buys', async () => {
    const { started, run } = setup();
    const all = [run('monitor', 'm')];
    for (let i = 0; i < 40; i++) {
      all.push(run('buy', `b${i}`));
    }
    await Promise.all(all);
    expect(started.findIndex((s) => s.label === 'm')).toBe(30);
    expect(started.find((s) => s.label === 'm')?.at).toBe(30_000);
  });

  it('holds every request while paused', async () => {
    const { clock, limiter, started, run } = setup();
    await run('buy', 'first');
    clock.set(10_000);
    limiter.pauseUntil(15_000);
    await run('exit', 'after-pause');
    expect(started[1]).toEqual({ label: 'after-pause', at: 15_000 });
  });

  it('keeps serving after a task fails', async () => {
    const { limiter, run } = setup();
    const failing = limiter.schedule('exit', () => Promise.reject(new Error('boom')));
    const next = run('buy', 'next');
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
    expect(limiter.pending).toBe(0);
  });
});
