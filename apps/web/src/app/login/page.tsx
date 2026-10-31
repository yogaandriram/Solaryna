import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Disclaimer } from '../../components/disclaimer';
import { hasValidSession } from '../../server/auth/session';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Masuk · Solaryna' };

export default async function LoginPage() {
  if (await hasValidSession()) {
    redirect('/');
  }
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Solaryna</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Dashboard copy-trading tracker</p>
        <LoginForm />
      </div>
      <Disclaimer />
    </main>
  );
}
