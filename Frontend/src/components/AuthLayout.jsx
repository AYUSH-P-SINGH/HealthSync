import { Link } from "react-router-dom";
import { HeartPulse, User, Building2 } from "lucide-react";

/**
 * Shared shell for Login / Signup pages:
 * brand header, card, and the Patient | Hospital role toggle.
 */
export default function AuthLayout({ title, subtitle, role, onRoleChange, showRoleToggle = true, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(ellipse_at_top,_#eef7ff_0%,_#ffffff_55%)] px-4 py-10">
      <div className="w-full max-w-md">
        {/* Brand */}
        <Link to="/" className="mb-8 flex items-center justify-center gap-2">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
            <HeartPulse size={22} />
          </span>
          <span className="font-display text-2xl font-bold text-brand-900">
            HealthSync
          </span>
        </Link>

        <div className="rounded-2xl border border-slate-100 bg-white p-8 shadow-xl shadow-brand-500/5">
          <h1 className="font-display text-2xl font-bold text-brand-900">
            {title}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>

          {/* Role toggle */}
          {showRoleToggle && (
            <div className="mt-6 space-y-2">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => onRoleChange('patient')}
                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    role === 'patient'
                      ? 'bg-white text-brand-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <User size={16} />
                  Patient
                </button>
                <button
                  type="button"
                  onClick={() => onRoleChange(role === 'insurance' ? 'insurance' : 'hospital')}
                  className={`flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                    role === 'hospital' || role === 'insurance'
                      ? 'bg-white text-brand-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  <Building2 size={16} />
                  Organization
                </button>
              </div>

              {(role === 'hospital' || role === 'insurance') && (
                <div className="flex justify-center gap-2 rounded-lg bg-brand-50/60 p-1 text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => onRoleChange('hospital')}
                    className={`flex-1 rounded-md py-1.5 transition ${
                      role === 'hospital' ? 'bg-white text-brand-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🏥 Hospital Provider
                  </button>
                  <button
                    type="button"
                    onClick={() => onRoleChange('insurance')}
                    className={`flex-1 rounded-md py-1.5 transition ${
                      role === 'insurance' ? 'bg-white text-brand-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    🛡️ Insurance Company
                  </button>
                </div>
              )}
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
}
