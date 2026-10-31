import { setWalletActiveAction } from '../app/(dashboard)/wallets/actions';

export function WalletActiveToggle({ id, active }: { id: number; active: boolean }) {
  return (
    <form action={setWalletActiveAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="active" value={active ? 'false' : 'true'} />
      <button
        type="submit"
        className={`rounded-md border px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
          active
            ? 'border-line text-muted hover:border-live/40 hover:text-live'
            : 'border-accent/50 text-accent hover:bg-accent/10'
        }`}
      >
        {active ? 'Nonaktifkan' : 'Aktifkan'}
      </button>
    </form>
  );
}

export function WalletStatusBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="rounded-md bg-positive/10 px-1.5 py-0.5 text-xs font-semibold text-positive">
      ● Aktif
    </span>
  ) : (
    <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs font-semibold text-muted">
      ○ Nonaktif
    </span>
  );
}
