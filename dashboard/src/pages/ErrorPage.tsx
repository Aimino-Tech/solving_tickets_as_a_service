import { Link } from 'react-router-dom';

interface ErrorPageProps {
  code: number;
  title: string;
  message: string;
  illustration?: React.ReactNode;
}

function BrokenRobotIllustration() {
  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="mx-auto h-48 w-48 sm:h-64 sm:w-64"
      aria-hidden="true"
    >
      <rect x="55" y="80" width="90" height="70" rx="12" className="fill-brand-100 dark:fill-brand-900/40" />
      <rect x="55" y="80" width="90" height="70" rx="12" className="stroke-brand-400 dark:stroke-brand-500" strokeWidth="2" />
      <rect x="65" y="35" width="70" height="50" rx="10" className="fill-brand-50 dark:fill-brand-900/30" />
      <rect x="65" y="35" width="70" height="50" rx="10" className="stroke-brand-400 dark:stroke-brand-500" strokeWidth="2" />
      <line x1="100" y1="35" x2="100" y2="18" className="stroke-brand-400 dark:stroke-brand-500" strokeWidth="2" />
      <circle cx="100" cy="14" r="4" className="fill-brand-300 dark:fill-brand-400" />
      <circle cx="85" cy="55" r="6" className="fill-white dark:fill-gray-800" />
      <circle cx="115" cy="55" r="6" className="fill-white dark:fill-gray-800" />
      <circle cx="87" cy="54" r="3" className="fill-brand-600 dark:fill-brand-400" />
      <circle cx="117" cy="54" r="3" className="fill-brand-600 dark:fill-brand-400" />
      <path d="M88 70 Q100 64 112 70" className="stroke-brand-400 dark:stroke-brand-500" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M80 95 L88 110 L78 120 L90 130" className="stroke-red-400 dark:stroke-red-500" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="30" y="90" width="25" height="8" rx="4" className="fill-brand-200 dark:fill-brand-800/60" />
      <rect x="145" y="90" width="25" height="8" rx="4" className="fill-brand-200 dark:fill-brand-800/60" />
      <rect x="70" y="150" width="10" height="20" rx="3" className="fill-brand-200 dark:fill-brand-800/60" />
      <rect x="120" y="150" width="10" height="20" rx="3" className="fill-brand-200 dark:fill-brand-800/60" />
      <text x="140" y="45" className="fill-red-400 dark:fill-red-500" fontSize="14" fontWeight="bold">!</text>
      <text x="55" y="42" className="fill-yellow-400 dark:fill-yellow-500" fontSize="12" fontWeight="bold">?</text>
    </svg>
  );
}

export default function ErrorPage({ code, title, message, illustration }: ErrorPageProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4 text-center dark:bg-gray-950">
      <div className="max-w-md">
        {illustration ?? <BrokenRobotIllustration />}
        <p className="mt-6 text-7xl font-extrabold tracking-tight text-brand-600 dark:text-brand-400">{code}</p>
        <h1 className="mt-4 text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
        <p className="mt-3 text-base text-gray-600 dark:text-gray-400">{message}</p>
        <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            to="/"
            className="inline-flex items-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-gray-950"
          >
            <svg className="mr-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
            </svg>
            Back to Dashboard
          </Link>
          <a
            href="https://github.com/Aimino-Tech/solving_tickets_as_a_service/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
