import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import AuthLayout from "../components/AuthLayout.jsx";
import { useAuth } from "../context/AuthContext.jsx";

const inputCls =
  "w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

// Must match the `hospitalType` enum in Backend/src/models/Hospital.js
const HOSPITAL_TYPES = [
  { value: "government", label: "Government" },
  { value: "private", label: "Private" },
  { value: "trust", label: "Trust" },
  { value: "clinic", label: "Clinic" },
  { value: "multi-speciality", label: "Multi-speciality" },
];

export default function Signup() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { registerPatient, registerHospital, registerInsurance } = useAuth();
  const [role, setRole] = useState(
    searchParams.get("role") === "insurance"
      ? "insurance"
      : searchParams.get("role") === "hospital"
      ? "hospital"
      : "patient"
  );
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    // Patient
    firstName: "",
    lastName: "",
    // Hospital
    hospitalName: "",
    hospitalRegistrationNumber: "",
    hospitalType: "",
    // Insurance
    companyName: "",
    insuranceRegistrationNumber: "",
    website: "",
    // Shared Address
    street: "",
    city: "",
    state: "",
    pincode: "",
    // Shared Contact & Auth
    email: "",
    mobileNumber: "",
    password: "",
  });

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (role === "patient") {
        await registerPatient({
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          mobileNumber: form.mobileNumber,
          password: form.password,
        });
      } else if (role === "hospital") {
        await registerHospital({
          name: form.hospitalName,
          registrationNumber: form.hospitalRegistrationNumber,
          hospitalType: form.hospitalType,
          street: form.street,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          email: form.email,
          mobileNumber: form.mobileNumber,
          password: form.password,
        });
      } else if (role === "insurance") {
        await registerInsurance({
          companyName: form.companyName,
          registrationNumber: form.insuranceRegistrationNumber,
          street: form.street,
          city: form.city,
          state: form.state,
          pincode: form.pincode,
          website: form.website,
          email: form.email,
          mobileNumber: form.mobileNumber,
          password: form.password,
        });
      }
      navigate(`/login?role=${role}&signupSuccess=1`, { replace: true });
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      title="Create your account"
      subtitle="A minute of setup for a lifetime of easier care."
      role={role}
      onRoleChange={setRole}
    >
      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {role === "patient" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                First name
              </label>
              <input
                name="firstName"
                required
                minLength={2}
                value={form.firstName}
                onChange={handleChange}
                placeholder="Aarav"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Last name
              </label>
              <input
                name="lastName"
                required
                minLength={2}
                value={form.lastName}
                onChange={handleChange}
                placeholder="Sharma"
                className={inputCls}
              />
            </div>
          </div>
        )}

        {role === "hospital" && (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Hospital / Clinic name
              </label>
              <input
                name="hospitalName"
                required
                minLength={3}
                value={form.hospitalName}
                onChange={handleChange}
                placeholder="City Care Hospital"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Registration number
                </label>
                <input
                  name="hospitalRegistrationNumber"
                  required
                  value={form.hospitalRegistrationNumber}
                  onChange={handleChange}
                  placeholder="e.g. MH/2024/12345"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Hospital type
                </label>
                <select
                  name="hospitalType"
                  required
                  value={form.hospitalType}
                  onChange={handleChange}
                  className={inputCls}
                >
                  <option value="" disabled>
                    Select type
                  </option>
                  {HOSPITAL_TYPES.map(({ value, label }) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Street address
              </label>
              <input
                name="street"
                required
                value={form.street}
                onChange={handleChange}
                placeholder="123 MG Road"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  City
                </label>
                <input
                  name="city"
                  required
                  value={form.city}
                  onChange={handleChange}
                  placeholder="Pune"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  State
                </label>
                <input
                  name="state"
                  required
                  value={form.state}
                  onChange={handleChange}
                  placeholder="Maharashtra"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Pincode
              </label>
              <input
                name="pincode"
                required
                pattern="\d{6}"
                title="6-digit pincode"
                value={form.pincode}
                onChange={handleChange}
                placeholder="411001"
                className={inputCls}
              />
            </div>
          </>
        )}

        {role === "insurance" && (
          <>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Insurance Company name
              </label>
              <input
                name="companyName"
                required
                minLength={3}
                value={form.companyName}
                onChange={handleChange}
                placeholder="Star Health & Allied Insurance"
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                IRDAI Registration number
              </label>
              <input
                name="insuranceRegistrationNumber"
                required
                value={form.insuranceRegistrationNumber}
                onChange={handleChange}
                placeholder="e.g. IRDAI-HLT-2026-001"
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Headquarters Street address
              </label>
              <input
                name="street"
                required
                value={form.street}
                onChange={handleChange}
                placeholder="15 Star Towers, MG Road"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  City
                </label>
                <input
                  name="city"
                  required
                  value={form.city}
                  onChange={handleChange}
                  placeholder="Bengaluru"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  State
                </label>
                <input
                  name="state"
                  required
                  value={form.state}
                  onChange={handleChange}
                  placeholder="Karnataka"
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Pincode
                </label>
                <input
                  name="pincode"
                  required
                  pattern="\d{6}"
                  title="6-digit pincode"
                  value={form.pincode}
                  onChange={handleChange}
                  placeholder="560001"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Official Website (Optional)
                </label>
                <input
                  name="website"
                  value={form.website}
                  onChange={handleChange}
                  placeholder="https://www.starhealth.in"
                  className={inputCls}
                />
              </div>
            </div>
          </>
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
            className={inputCls}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">
            Mobile number
          </label>
          <input
            type="tel"
            name="mobileNumber"
            required
            pattern="[6-9][0-9]{9}"
            title="10-digit mobile number starting with 6-9"
            value={form.mobileNumber}
            onChange={handleChange}
            placeholder="9876543210"
            className={inputCls}
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
              pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#+\-_]).{8,}"
              title="At least 8 characters, with an uppercase letter, lowercase letter, number, and special character (@$!%*?&#+-_)"
              value={form.password}
              onChange={handleChange}
              placeholder="At least 8 characters"
              className={`${inputCls} pr-11`}
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
          <p className="mt-1.5 text-xs text-slate-400">
            Include an uppercase letter, lowercase letter, number, and special character (@$!%*?&#+-_).
          </p>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-brand-600 py-3.5 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting
            ? "Creating account..."
            : `Create ${
                role === "hospital"
                  ? "Hospital"
                  : role === "insurance"
                  ? "Insurance Company"
                  : "Patient"
              } account`}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link
          to={`/login?role=${role}`}
          className="font-semibold text-brand-600 hover:text-brand-700"
        >
          Log in
        </Link>
      </p>
    </AuthLayout>
  );
}
