import { shortAddress } from '@solaryna/core';
import { DASHBOARD_ACTOR } from '@solaryna/db';
import { requireSession } from '../server/auth/session';
import { logout } from './login/actions';

export default async function Home() {
  await requireSession();
  return (
    <main className="p-8">
      Solaryna {shortAddress('J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX')} {DASHBOARD_ACTOR}
      <form action={logout}>
        <button type="submit">Keluar</button>
      </form>
    </main>
  );
}
