import { useAuth } from '@/context/AuthContext';

/**
 * Shown while an admin is logged-in-as another user.
 * Primary action: restore the admin session.
 */
export default function ImpersonationBanner() {
  const { user, exitImpersonation } = useAuth();

  if (!user?.impersonating) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-between gap-3 border-b border-amber-400 bg-amber-400 px-4 py-2.5 text-sm text-amber-950 shadow-md">
      <p className="min-w-0 truncate">
        Logged in as <span className="font-bold">{user.email}</span>
        {user.impersonator?.email ? (
          <span className="ml-1 text-amber-900/80">(from admin {user.impersonator.email})</span>
        ) : null}
      </p>
      <button
        type="button"
        onClick={() => void exitImpersonation()}
        className="shrink-0 rounded-md bg-amber-950 px-4 py-1.5 text-xs font-semibold text-amber-50 hover:bg-black"
      >
        Back to admin
      </button>
    </div>
  );
}
