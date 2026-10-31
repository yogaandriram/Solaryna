import { setTradingPausedAction } from '../app/(dashboard)/actions';

/** Kill switch status and toggle. It stops new buys and automatic exits in every mode. */
export function PauseToggle({ paused }: { paused: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="font-medium">{paused ? '⏸ Trading dijeda' : '● Trading berjalan'}</p>
        <p className="text-sm text-muted">
          {paused
            ? 'Sinyal baru dan exit otomatis tidak dieksekusi sampai dilanjutkan.'
            : 'Bot mengeksekusi sinyal yang lolos aturan risiko.'}
        </p>
      </div>
      <form action={setTradingPausedAction}>
        <input type="hidden" name="paused" value={paused ? 'false' : 'true'} />
        <button
          type="submit"
          className={`rounded-lg px-4 py-2 text-sm font-medium ${
            paused
              ? 'bg-accent text-accent-fg hover:opacity-90'
              : 'border border-live/40 text-live hover:bg-live-soft'
          }`}
        >
          {paused ? 'Lanjutkan trading' : 'Jeda trading'}
        </button>
      </form>
    </div>
  );
}
