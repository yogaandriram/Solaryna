import { shortAddress } from '@solaryna/core';
import { DASHBOARD_ACTOR } from '@solaryna/db';

export default function Home() {
  return (
    <main className="p-8">
      Solaryna {shortAddress('J8M2wM8vtBLZJfajpczrjbs78PWhW1sqVFVJdE5d43jX')} {DASHBOARD_ACTOR}
    </main>
  );
}
