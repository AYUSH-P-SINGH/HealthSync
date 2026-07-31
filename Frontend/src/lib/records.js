import {
  Stethoscope,
  ClipboardList,
  Pill,
  FlaskConical,
  Syringe,
  FileText,
} from "lucide-react";

/** Record type metadata shared by the timeline, records, and consent views. */
export const RECORD_TYPES = [
  { key: "visit", label: "Visit", icon: Stethoscope, chip: "bg-sky-50 text-sky-700", dot: "bg-sky-500" },
  { key: "diagnosis", label: "Diagnosis", icon: ClipboardList, chip: "bg-violet-50 text-violet-700", dot: "bg-violet-500" },
  { key: "prescription", label: "Prescription", icon: Pill, chip: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  { key: "lab_report", label: "Lab Report", icon: FlaskConical, chip: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  { key: "vaccination", label: "Vaccination", icon: Syringe, chip: "bg-teal-50 text-teal-700", dot: "bg-teal-500" },
  { key: "other", label: "Other", icon: FileText, chip: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
];

export const typeMeta = (key) =>
  RECORD_TYPES.find((t) => t.key === key) || RECORD_TYPES[RECORD_TYPES.length - 1];

/** Alert severity → styling for interaction/allergy alert chips. */
export const ALERT_STYLES = {
  critical: "border-rose-200 bg-rose-50 text-rose-700",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-sky-200 bg-sky-50 text-sky-700",
};

/** Advisory severity → banner/card styling. */
export const SEVERITY_STYLES = {
  critical: { chip: "bg-rose-100 text-rose-700", card: "border-rose-200 bg-rose-50", label: "Critical" },
  warning: { chip: "bg-amber-100 text-amber-800", card: "border-amber-200 bg-amber-50", label: "Warning" },
  advisory: { chip: "bg-sky-100 text-sky-700", card: "border-sky-200 bg-sky-50", label: "Advisory" },
  info: { chip: "bg-slate-100 text-slate-600", card: "border-slate-200 bg-slate-50", label: "Info" },
};

export const severityMeta = (key) => SEVERITY_STYLES[key] || SEVERITY_STYLES.info;
