import { useState } from "react";
import { Bell, BellOff, HelpCircle, Loader2, Mail, Send } from "lucide-react";
import { formatDate } from "../lib/format.js";

const SUPPORT_EMAIL = "support@healthsync.app";

/*
  Topbar Notifications + Help buttons, shared by the Patient and Hospital
  dashboards.

  - notifications: [{ id, title, body, time, unread?, tab? }]
  - loading:       show a spinner inside the dropdown while items load
  - onRefresh:     called every time the bell dropdown is opened (refetch)
  - onNotificationClick(n): called when an item is clicked (e.g. switch tab)

  The Help popover has no backend yet, so "Send enquiry" opens the user's
  email app with the message pre-filled via mailto:.
*/
export default function TopbarActions({
  notifications = [],
  loading = false,
  onRefresh,
  onNotificationClick,
}) {
  const [open, setOpen] = useState(null); // "notifications" | "help" | null
  const [enquiry, setEnquiry] = useState("");

  const unreadCount = notifications.filter((n) => n.unread).length;

  const toggle = (which) => {
    setOpen((cur) => {
      const next = cur === which ? null : which;
      if (next === "notifications") onRefresh?.();
      return next;
    });
  };

  const sendEnquiry = (e) => {
    e.preventDefault();
    const subject = encodeURIComponent("HealthSync enquiry");
    const body = encodeURIComponent(enquiry.trim());
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    setEnquiry("");
    setOpen(null);
  };

  return (
    <>
      {/* Click-outside backdrop */}
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setOpen(null)}
          className="fixed inset-0 z-30 cursor-default"
          tabIndex={-1}
        />
      )}

      {/* Notifications */}
      <div className="relative">
        <button
          type="button"
          onClick={() => toggle("notifications")}
          className={`relative rounded-full p-1.5 transition hover:bg-white/10 ${
            open === "notifications" ? "bg-white/10 text-white" : ""
          }`}
          aria-label="Notifications"
          aria-expanded={open === "notifications"}
        >
          <Bell size={19} />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
              {unreadCount}
            </span>
          )}
        </button>

        {open === "notifications" && (
          <div className="fixed right-4 top-[4.5rem] z-40 flex max-h-[calc(100vh-5.5rem)] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-slate-100 bg-white text-left shadow-2xl">
            <div className="shrink-0 border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-800">
              Notifications
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
                  <Loader2 size={15} className="animate-spin" /> Loading…
                </div>
              ) : notifications.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
                  <BellOff size={20} className="text-slate-300" />
                  <p className="text-sm text-slate-400">
                    Nothing here yet. Link requests and updates will show up here.
                  </p>
                </div>
              ) : (
                notifications.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => {
                      setOpen(null);
                      onNotificationClick?.(n);
                    }}
                    className="flex w-full items-start gap-3 border-b border-slate-50 px-4 py-3 text-left transition last:border-b-0 hover:bg-slate-50"
                  >
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        n.unread ? "bg-rose-500" : "bg-slate-200"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-800">{n.title}</span>
                      <span className="block text-xs text-slate-500">{n.body}</span>
                      {n.time && (
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {formatDate(n.time)}
                        </span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Help / enquiry */}
      <div className="relative">
        <button
          type="button"
          onClick={() => toggle("help")}
          className={`rounded-full p-1.5 transition hover:bg-white/10 ${
            open === "help" ? "bg-white/10 text-white" : ""
          }`}
          aria-label="Help"
          aria-expanded={open === "help"}
        >
          <HelpCircle size={19} />
        </button>

        {open === "help" && (
          <div className="fixed right-4 top-[4.5rem] z-40 max-h-[calc(100vh-5.5rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-slate-100 bg-white p-4 text-left shadow-2xl">
            <div className="text-sm font-bold text-slate-800">Help &amp; Support</div>
            <p className="mt-1 text-xs text-slate-500">
              Questions about your account, verification, or hospital links? Reach us directly or
              send an enquiry below.
            </p>

            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="mt-3 flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              <Mail size={15} className="text-brand-600" /> {SUPPORT_EMAIL}
            </a>

            <form onSubmit={sendEnquiry} className="mt-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Send an enquiry</span>
                <textarea
                  rows={3}
                  value={enquiry}
                  onChange={(e) => setEnquiry(e.target.value)}
                  placeholder="Describe your issue or question…"
                  className="mt-1.5 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-100"
                />
              </label>
              <button
                type="submit"
                disabled={!enquiry.trim()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
              >
                <Send size={14} /> Send enquiry
              </button>
              <p className="mt-2 text-center text-[11px] text-slate-400">
                Opens your email app with the message pre-filled.
              </p>
            </form>
          </div>
        )}
      </div>
    </>
  );
}
