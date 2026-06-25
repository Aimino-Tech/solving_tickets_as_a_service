import { Link, Outlet } from 'react-router-dom';

export default function PublicLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <span className="text-xl font-bold text-gray-900">STAS</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link to="/benchmarks" className="text-sm font-medium text-gray-600 hover:text-brand-600">Benchmarks</Link>
            <Link to="/pricing" className="text-sm font-medium text-gray-600 hover:text-brand-600">Pricing</Link>
            <Link to="/security" className="text-sm font-medium text-gray-600 hover:text-brand-600">Security</Link>
            <Link to="/privacy" className="text-sm font-medium text-gray-600 hover:text-brand-600">Privacy</Link>
            <Link to="/status" className="text-sm font-medium text-gray-600 hover:text-brand-600">Status</Link>
            <Link to="/login" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Sign In</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1"><Outlet /></main>
      <footer className="border-t border-gray-200 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2 text-sm text-gray-500"><span className="text-lg">⚡</span><span>STAS — Solving Tickets As A Service</span></div>
            <div className="flex items-center gap-6 text-sm text-gray-500">
              <Link to="/benchmarks" className="hover:text-brand-600">Benchmarks</Link>
              <Link to="/pricing" className="hover:text-brand-600">Pricing</Link>
              <Link to="/security" className="hover:text-brand-600">Security</Link>
              <Link to="/privacy" className="hover:text-brand-600">Privacy</Link>
              <Link to="/dpa" className="hover:text-brand-600">DPA</Link>
              <Link to="/status" className="hover:text-brand-600">Status</Link>
            </div>
            <p className="text-sm text-gray-400">&copy; {new Date().getFullYear()} STAS. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
