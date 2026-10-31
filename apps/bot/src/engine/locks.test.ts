import { describe, expect, it } from 'vitest';
import { createKeyedMutex } from './locks';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('createKeyedMutex', () => {
  it('runs tasks for the same key one at a time, in order', async () => {
    const mutex = createKeyedMutex();
    const log: string[] = [];
    const task = (name: string) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
      return name;
    };
    const results = await Promise.all([mutex.run('A', task('1')), mutex.run('A', task('2'))]);
    expect(results).toEqual(['1', '2']);
    expect(log).toEqual(['1 start', '1 end', '2 start', '2 end']);
  });

  it('runs different keys concurrently and survives a failing task', async () => {
    const mutex = createKeyedMutex();
    const log: string[] = [];
    const failing = mutex.run('A', async () => {
      log.push('A start');
      await tick();
      throw new Error('boom');
    });
    const other = mutex.run('B', () => {
      log.push('B start');
      return Promise.resolve('b');
    });
    await expect(failing).rejects.toThrow('boom');
    expect(await other).toBe('b');
    expect(log).toEqual(['A start', 'B start']);
    expect(await mutex.run('A', () => Promise.resolve('after'))).toBe('after');
  });
});
