import { useState, useEffect, useCallback, useRef } from "react";
import { patientApi, insuranceApi } from "../lib/api";
import { onSocketEvent } from "../lib/socket";

/**
 * ClaimDetailDrawer — shared patient/insurer claim workspace.
 * Tabs: Timeline (status history), Messages (two-way thread),
 * Documents (structured requests + uploads), Appeal.
 *
 * Props:
 *  - claim: full claim object
 *  - role: 'patient' | 'insurance'
 *  - token: access token
 *  - onClose: () => void
 *  - onClaimUpdated: (updatedClaim) => void  (refresh parent list)
 */
export default function ClaimDetailDrawer({ claim: initialClaim, role, token, onClose, onClaimUpdated }) {
  const api = role === "patient" ? patientApi : insuranceApi;
  const [claim, setClaim] = useState(initialClaim);
  const [tab, setTab] = useState("timeline");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Messages
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [sending, setSending] = useState(false);
  const threadEndRef = useRef(null);

  // Document requests (insurance side)
  const [docItems, setDocItems] = useState([{ itemName: "", note: "" }]);
  const [sendingDocRequest, setSendingDocRequest] = useState(false);

  // Document fulfilment (patient side)
  const [fulfillForm, setFulfillForm] = useState({ requestId: null, name: "", fileUrl: "" });
  const [fulfilling, setFulfilling] = useState(false);

  // Appeal
  const [appealReason, setAppealReason] = useState("");
  const [appealResolution, setAppealResolution] = useState({ status: "under_review", resolutionNote: "", approvedAmount: "" });
  const [appealBusy, setAppealBusy] = useState(false);

  const applyUpdatedClaim = (updated) => {
    setClaim(updated);
    onClaimUpdated?.(updated);
  };

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.getClaimMessages(claim._id, token);
      setMessages(res.data || []);
    } catch (err) {
      setError(err.message || "Failed to load messages.");
    }
  }, [api, claim._id, token]);

  const fetchClaim = useCallback(async () => {
    try {
      const res = await api.getClaim(claim._id, token);
      setClaim(res.data);
      onClaimUpdated?.(res.data);
    } catch (err) {
      setError(err.message || "Failed to refresh claim.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, claim._id, token]);

  // Load the thread once on open.
  useEffect(() => {
    setLoadingMessages(true);
    fetchMessages().finally(() => setLoadingMessages(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claim._id]);

  // Live updates: the counterparty's socket events are scoped to this
  // exact claim, so a message or status change appears the instant it
  // happens — no polling, no manual refresh.
  useEffect(() => {
    const claimId = claim._id;

    const unsubMessage = onSocketEvent("claim:message", (payload) => {
      if (payload.claimId === claimId) fetchMessages();
    });
    const unsubUpdated = onSocketEvent("claim:updated", (payload) => {
      if (payload.claimId === claimId) fetchClaim();
    });

    return () => {
      unsubMessage();
      unsubUpdated();
    };
  }, [claim._id, fetchMessages, fetchClaim]);

  useEffect(() => {
    if (tab === "messages") threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, tab]);

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!messageBody.trim()) return;
    setSending(true);
    setError("");
    try {
      await api.sendClaimMessage(claim._id, { body: messageBody.trim() }, token);
      setMessageBody("");
      await fetchMessages();
    } catch (err) {
      setError(err.message || "Failed to send message.");
    } finally {
      setSending(false);
    }
  };

  const handleRequestDocuments = async (e) => {
    e.preventDefault();
    const items = docItems.filter((i) => i.itemName.trim());
    if (items.length === 0) return;
    setSendingDocRequest(true);
    setError("");
    try {
      const res = await insuranceApi.requestClaimDocuments(claim._id, items, token);
      applyUpdatedClaim(res.data);
      setDocItems([{ itemName: "", note: "" }]);
      setNotice("Document request sent to the patient.");
    } catch (err) {
      setError(err.message || "Failed to request documents.");
    } finally {
      setSendingDocRequest(false);
    }
  };

  const handleFulfillDocument = async (e) => {
    e.preventDefault();
    if (!fulfillForm.requestId || !fulfillForm.name.trim() || !fulfillForm.fileUrl.trim()) return;
    setFulfilling(true);
    setError("");
    try {
      const res = await patientApi.fulfillClaimDocument(
        claim._id,
        fulfillForm.requestId,
        { name: fulfillForm.name.trim(), fileUrl: fulfillForm.fileUrl.trim() },
        token
      );
      applyUpdatedClaim(res.data);
      setFulfillForm({ requestId: null, name: "", fileUrl: "" });
      setNotice("Document submitted to your insurer.");
    } catch (err) {
      setError(err.message || "Failed to upload document.");
    } finally {
      setFulfilling(false);
    }
  };

  const handleFileAppeal = async (e) => {
    e.preventDefault();
    setAppealBusy(true);
    setError("");
    try {
      const res = await patientApi.appealClaim(claim._id, appealReason.trim(), token);
      applyUpdatedClaim(res.data);
      setAppealReason("");
      setNotice("Your appeal has been filed with the insurer.");
    } catch (err) {
      setError(err.message || "Failed to file appeal.");
    } finally {
      setAppealBusy(false);
    }
  };

  const handleResolveAppeal = async (e) => {
    e.preventDefault();
    setAppealBusy(true);
    setError("");
    try {
      const payload = {
        status: appealResolution.status,
        resolutionNote: appealResolution.resolutionNote || undefined,
      };
      if (appealResolution.status === "overturned") {
        payload.approvedAmount = Number(appealResolution.approvedAmount);
      }
      const res = await insuranceApi.resolveClaimAppeal(claim._id, payload, token);
      applyUpdatedClaim(res.data);
      setNotice("Appeal updated.");
    } catch (err) {
      setError(err.message || "Failed to update appeal.");
    } finally {
      setAppealBusy(false);
    }
  };

  const pendingRequests = (claim.documentRequests || []).filter((r) => r.status === "pending");
  const canAppeal =
    role === "patient" &&
    !claim.appeal?.filed &&
    (claim.status === "rejected" || (claim.status === "approved" && claim.approvedAmount < claim.claimAmount));
  const hasOpenAppeal = claim.appeal?.filed && !["upheld", "overturned"].includes(claim.appeal.status);

  const statusBadge = (status) => (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
        status === "approved"
          ? "bg-emerald-100 text-emerald-800"
          : status === "rejected"
          ? "bg-red-100 text-red-800"
          : status === "appealed"
          ? "bg-violet-100 text-violet-800"
          : "bg-amber-100 text-amber-800"
      }`}
    >
      {status?.replaceAll("_", " ")}
    </span>
  );

  const tabs = [
    { key: "timeline", label: "Timeline" },
    { key: "messages", label: `Messages${messages.length ? ` (${messages.length})` : ""}` },
    { key: "documents", label: `Documents${pendingRequests.length ? ` (${pendingRequests.length} pending)` : ""}` },
    { key: "appeal", label: "Appeal" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-slate-100 p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display text-base font-bold text-slate-900">{claim.claimNumber}</h3>
                {statusBadge(claim.status)}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {claim.hospitalName} &bull; {claim.diagnosis}
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-700">
                Claimed ₹{claim.claimAmount?.toLocaleString("en-IN")}
                {claim.approvedAmount > 0 && (
                  <span className="text-emerald-700"> &bull; Approved ₹{claim.approvedAmount.toLocaleString("en-IN")}</span>
                )}
              </p>
            </div>
            <button onClick={onClose} className="text-xl leading-none text-slate-400 hover:text-slate-700">
              &times;
            </button>
          </div>

          {/* Tabs */}
          <div className="mt-4 flex gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                  tab === t.key ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {(error || notice) && (
          <div className={`mx-5 mt-3 rounded-lg px-3 py-2 text-xs font-semibold ${error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
            {error || notice}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 text-xs">
          {/* ── Timeline ── */}
          {tab === "timeline" && (
            <ol className="relative ml-2 space-y-4 border-l border-slate-200 pl-4">
              {[...(claim.statusHistory || [])].reverse().map((h, idx) => (
                <li key={idx}>
                  <span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                  <div className="flex items-center gap-2">
                    {statusBadge(h.status)}
                    <span className="text-[10px] text-slate-400">
                      {new Date(h.timestamp).toLocaleString("en-IN")}
                    </span>
                  </div>
                  <p className="mt-1 font-semibold text-slate-700">{h.comment}</p>
                  <p className="text-[10px] text-slate-400">by {h.updatedBy}</p>
                </li>
              ))}
            </ol>
          )}

          {/* ── Messages ── */}
          {tab === "messages" && (
            <div className="flex h-full flex-col">
              <div className="flex-1 space-y-3">
                {loadingMessages ? (
                  <p className="py-6 text-center text-slate-400">Loading messages...</p>
                ) : messages.length === 0 ? (
                  <p className="py-6 text-center text-slate-400">
                    No messages yet. Start the conversation — messages are stored permanently on this claim.
                  </p>
                ) : (
                  messages.map((m) => {
                    const mine = m.senderRole === role;
                    return (
                      <div key={m._id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${
                            mine ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-800"
                          }`}
                        >
                          <p className={`text-[10px] font-bold ${mine ? "text-brand-100" : "text-slate-500"}`}>
                            {m.senderName}
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                          <p className={`mt-1 text-right text-[9px] ${mine ? "text-brand-200" : "text-slate-400"}`}>
                            {new Date(m.createdAt).toLocaleString("en-IN")}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={threadEndRef} />
              </div>
            </div>
          )}

          {/* ── Documents ── */}
          {tab === "documents" && (
            <div className="space-y-5">
              {/* Outstanding / fulfilled requests */}
              <div>
                <h4 className="mb-2 font-bold text-slate-900">Insurer document requests</h4>
                {(claim.documentRequests || []).length === 0 ? (
                  <p className="text-slate-400">No document requests raised on this claim.</p>
                ) : (
                  <div className="space-y-2">
                    {claim.documentRequests.map((r) => (
                      <div key={r._id} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-slate-800">{r.itemName}</p>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              r.status === "fulfilled" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {r.status}
                          </span>
                        </div>
                        {r.note && <p className="mt-1 text-slate-500">{r.note}</p>}
                        {r.status === "fulfilled" && r.document?.fileUrl && (
                          <a
                            href={r.document.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 inline-block font-semibold text-brand-600 hover:text-brand-700"
                          >
                            {r.document.name} ↗
                          </a>
                        )}
                        {role === "patient" && r.status === "pending" && (
                          <button
                            onClick={() => setFulfillForm({ requestId: r._id, name: "", fileUrl: "" })}
                            className="mt-2 rounded-lg bg-brand-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-brand-700"
                          >
                            Provide document
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Patient: fulfil a selected request */}
              {role === "patient" && fulfillForm.requestId && (
                <form onSubmit={handleFulfillDocument} className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
                  <h4 className="mb-2 font-bold text-slate-900">Upload requested document</h4>
                  <input
                    type="text"
                    placeholder="Document name (e.g. Discharge Summary.pdf)"
                    value={fulfillForm.name}
                    onChange={(e) => setFulfillForm({ ...fulfillForm, name: e.target.value })}
                    className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
                    required
                  />
                  <input
                    type="url"
                    placeholder="File URL (link to the uploaded file)"
                    value={fulfillForm.fileUrl}
                    onChange={(e) => setFulfillForm({ ...fulfillForm, fileUrl: e.target.value })}
                    className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
                    required
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={fulfilling}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {fulfilling ? "Submitting..." : "Submit document"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFulfillForm({ requestId: null, name: "", fileUrl: "" })}
                      className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-200"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {/* Insurance: raise new document requests */}
              {role === "insurance" && !["approved", "rejected"].includes(claim.status) && (
                <form onSubmit={handleRequestDocuments} className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
                  <h4 className="mb-2 font-bold text-slate-900">Request documents from patient</h4>
                  {docItems.map((item, idx) => (
                    <div key={idx} className="mb-2 flex gap-2">
                      <input
                        type="text"
                        placeholder="Item (e.g. Discharge summary)"
                        value={item.itemName}
                        onChange={(e) => {
                          const next = [...docItems];
                          next[idx] = { ...next[idx], itemName: e.target.value };
                          setDocItems(next);
                        }}
                        className="w-1/2 rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
                      />
                      <input
                        type="text"
                        placeholder="Note (optional)"
                        value={item.note}
                        onChange={(e) => {
                          const next = [...docItems];
                          next[idx] = { ...next[idx], note: e.target.value };
                          setDocItems(next);
                        }}
                        className="w-1/2 rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDocItems([...docItems, { itemName: "", note: "" }])}
                      className="rounded-lg bg-slate-100 px-3 py-1.5 font-semibold text-slate-600 hover:bg-slate-200"
                    >
                      + Add item
                    </button>
                    <button
                      type="submit"
                      disabled={sendingDocRequest}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {sendingDocRequest ? "Sending..." : "Send request"}
                    </button>
                  </div>
                </form>
              )}

              {/* All claim documents */}
              <div>
                <h4 className="mb-2 font-bold text-slate-900">All claim documents</h4>
                {(claim.documents || []).length === 0 ? (
                  <p className="text-slate-400">No documents attached to this claim yet.</p>
                ) : (
                  <ul className="space-y-1">
                    {claim.documents.map((d, idx) => (
                      <li key={idx}>
                        <a
                          href={d.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-brand-600 hover:text-brand-700"
                        >
                          {d.name} ↗
                        </a>
                        <span className="ml-2 text-[10px] text-slate-400">
                          {d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString("en-IN") : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ── Appeal ── */}
          {tab === "appeal" && (
            <div className="space-y-4">
              {claim.appeal?.filed ? (
                <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-[10px] font-bold uppercase text-violet-800">
                      Appeal {claim.appeal.status.replaceAll("_", " ")}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Filed {claim.appeal.filedAt ? new Date(claim.appeal.filedAt).toLocaleString("en-IN") : ""}
                    </span>
                  </div>
                  <p className="mt-2 font-semibold text-slate-700">Reason: {claim.appeal.reason}</p>
                  {claim.appeal.resolutionNote && (
                    <p className="mt-1 text-slate-600">Resolution: {claim.appeal.resolutionNote}</p>
                  )}
                </div>
              ) : (
                <p className="text-slate-400">
                  {role === "patient"
                    ? canAppeal
                      ? "You can file a formal appeal against this decision below."
                      : "No appeal filed. Appeals become available if a claim is rejected or only partially approved."
                    : "The patient has not filed an appeal on this claim."}
                </p>
              )}

              {/* Patient: file appeal */}
              {canAppeal && (
                <form onSubmit={handleFileAppeal} className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
                  <h4 className="mb-2 font-bold text-slate-900">File a formal appeal</h4>
                  <textarea
                    rows={4}
                    value={appealReason}
                    onChange={(e) => setAppealReason(e.target.value)}
                    placeholder="Explain why you believe this decision should be reconsidered (min 20 characters)..."
                    className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
                    required
                    minLength={20}
                  />
                  <button
                    type="submit"
                    disabled={appealBusy || appealReason.trim().length < 20}
                    className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {appealBusy ? "Filing..." : "File appeal"}
                  </button>
                </form>
              )}

              {/* Insurance: progress / resolve appeal */}
              {role === "insurance" && hasOpenAppeal && (
                <form onSubmit={handleResolveAppeal} className="rounded-xl border border-brand-200 bg-brand-50/40 p-3">
                  <h4 className="mb-2 font-bold text-slate-900">Update appeal</h4>
                  <select
                    value={appealResolution.status}
                    onChange={(e) => setAppealResolution({ ...appealResolution, status: e.target.value })}
                    className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
                  >
                    <option value="under_review">Mark under review</option>
                    <option value="upheld">Uphold original decision</option>
                    <option value="overturned">Overturn — approve claim</option>
                  </select>
                  {appealResolution.status === "overturned" && (
                    <input
                      type="number"
                      min="0"
                      placeholder="Approved amount (₹)"
                      value={appealResolution.approvedAmount}
                      onChange={(e) => setAppealResolution({ ...appealResolution, approvedAmount: e.target.value })}
                      className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
                      required
                    />
                  )}
                  <textarea
                    rows={2}
                    value={appealResolution.resolutionNote}
                    onChange={(e) => setAppealResolution({ ...appealResolution, resolutionNote: e.target.value })}
                    placeholder="Resolution note to the patient (optional)"
                    className="mb-2 w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-brand-500"
                  />
                  <button
                    type="submit"
                    disabled={appealBusy}
                    className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {appealBusy ? "Updating..." : "Update appeal"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Composer (always visible on Messages tab) */}
        {tab === "messages" && (
          <form onSubmit={handleSendMessage} className="border-t border-slate-100 p-4">
            <div className="flex gap-2">
              <input
                type="text"
                value={messageBody}
                onChange={(e) => setMessageBody(e.target.value)}
                placeholder={role === "patient" ? "Message your insurer..." : "Message the patient..."}
                maxLength={2000}
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:border-brand-500"
              />
              <button
                type="submit"
                disabled={sending || !messageBody.trim()}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {sending ? "..." : "Send"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
