import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import AuthLayout from "../components/AuthLayout.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { authApi } from "../lib/api.js";

export default function Login() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  // Honor all three roles from the URL — previously "?role=insurance"
  // silently fell back to the Patient tab.
  const [role, setRole] = useState(() => {
    const r = searchParams.get("role");
    return r === "hospital" || r === "insurance" ? r : "patient";
  });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [resending, setResending] = useState(false);
  const [form, setForm] = useState({ email: "", password: "" });
  // Signup.jsx redirects here (instead of auto-logging the user in) with
  // ?signupSuccess=1 — show a one-time confirmation popup.
  const [showSignupSuccess, setShowSignupSuccess] = useState(
    searchParams.get("signupSuccess") === "1"
  );

  const dismissSignupSuccess = () => {
    setShowSignupSuccess(false);
    // Strip signupSuccess from the URL so a refresh doesn't re-show it.
    navigate(`/login?role=${role}`, { replace: true });
  };

  // Backend blocks login with MESSAGES.EMAIL_NOT_VERIFIED when the account
  // hasn't been verified yet — offer a "resend link" action in that case.
  const isUnverified = /verify your email/i.test(error);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleResend = async () => {
    setResending(true);
    setNotice("");
    try {
      const res = await authApi.resendVerification(form.email);
      setError("");
      setNotice(res?.message || "Verification link resent. Please check your inbox.");
    } catch (err) {
      setNotice(err.message || "Could not resend the verification link.");
    } finally {
      setResending(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setNotice("");
    setSubmitting(true);
    try {
      await login({ email: form.email, password: form.password, appRole: role });
      // replace: true keeps the login page out of history, so the browser
      // Back button from the dashboard never lands back on the login form.
      navigate(
        role === "hospital"
          ? "/dashboard/hospital"
          : role === "insurance"
          ? "/dashboard/insurance"
          : "/dashboard/patient",
        { replace: true }
      );
    } catch (err) {
      setError(err.message || "Invalid email or password.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in to continue to your dashboard."
      role={role}
      onRoleChange={setRole}
    >
      {showSignupSuccess && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signup-success-title"
        >
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
              <CheckCircle2 size={28} />
            </div>
            <h2
              id="signup-success-title"
              className="mt-4 font-display text-lg font-bold text-brand-900"
            >
              Account successfully created
            </h2>
            <p className="mt-1.5 text-sm text-slate-500">
              Log in with your new account to continue.
            </p>
            <button
              type="button"
              onClick={dismissSignupSuccess}
              autoFocus
              className="mt-6 w-full rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-700"
            >
              Got it
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
            {isUnverified && form.email && (
              <button
                type="button"
                onClick={handleResend}
                disabled={resending}
                className="mt-2 block font-semibold text-brand-600 hover:text-brand-700 disabled:opacity-60"
              >
                {resending ? "Sending..." : "Resend verification link"}
              </button>
            )}
          </div>
        )}

        {notice && (
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
            {notice}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            type="email"
            name="email"
            required
            value={form.email}
            onChange={handleChange}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Password
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              required
              minLength={8}
              value={form.password}
              onChange={handleChange}
              placeholder="••••••••"
              className="w-full rounded-xl border border-slate-200 px-4 py-3 pr-11 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs font-semibold text-brand-600 hover:text-brand-700"
          >
            Forgot password?
          </button>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-brand-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting
            ? "Logging in..."
            : `Log in as ${
                role === "hospital"
                  ? "Hospital"
                  : role === "insurance"
                  ? "Insurance Company"
                  : "Patient"
              }`}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link
          to={`/signup?role=${role}`}
          className="font-semibold text-brand-600 hover:text-brand-700"
        >
          Sign up
        </Link>
      </p>
    </AuthLayout>
  );
}
