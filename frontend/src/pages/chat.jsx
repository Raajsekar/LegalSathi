// frontend/src/pages/chat.jsx
import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import {
  Plus,
  LogOut,
  Upload,
  Copy,
  FileText,
  BookOpen,
  Calculator,
  X,
  Mic,
  MicOff,
} from "lucide-react";
import copy from "copy-to-clipboard";
import "./chat.css";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export default function Chat() {
  const [user] = useAuthState(auth);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [task, setTask] = useState("summarize");
  const [loading, setLoading] = useState(false);
  const [activeChat, setActiveChat] = useState(null); // single thread for Option A
  const [searchQuery, setSearchQuery] = useState("");
  const [showGstPanel, setShowGstPanel] = useState(false);

  // voice states
  const [listening, setListening] = useState(false);
  const [supportsSpeech, setSupportsSpeech] = useState(false);

  // GST calculator states
  const [gstAmount, setGstAmount] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [inclusive, setInclusive] = useState(false);
  const [interstate, setInterstate] = useState(false);
  const [gstResult, setGstResult] = useState(null);
  const [gstTips, setGstTips] = useState([]);

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const interimRef = useRef("");
  const abortRef = useRef(null); // for canceling axios requests

  // Load user's latest conversation (single-thread) and set up speech rec
  useEffect(() => {
    if (user) loadConversation();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSupportsSpeech(true);
      const r = new SpeechRecognition();
      r.continuous = false;
      r.interimResults = true;
      r.lang = "en-IN";
      recognitionRef.current = r;

      r.onresult = (ev) => {
        let interim = "";
        let final = "";
        for (let i = 0; i < ev.results.length; i++) {
          const res = ev.results[i];
          if (res.isFinal) final += res[0].transcript;
          else interim += res[0].transcript;
        }
        interimRef.current = interim || "";
        setMessage((prev) => {
          const base = prev.replace(/¶INTERIM:.*$/, "");
          if (final) return (base ? base + " " : "") + final;
          return base + (interim ? ` ¶INTERIM:${interim}` : "");
        });
      };

      r.onend = () => {
        setListening(false);
        setMessage((m) => m.replace(/¶INTERIM:.*$/, "").trim());
        interimRef.current = "";
      };

      r.onerror = (e) => {
        console.warn("Speech error", e);
        setListening(false);
        interimRef.current = "";
      };
    }
    // eslint-disable-next-line
  }, [user]);

  // autoscroll after new message/reply
  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 80);
    }
  }, [activeChat]);

  async function loadConversation() {
    try {
      const res = await axios.get(`${API_BASE}/api/history/${user.uid}`);
      // backend returns array of chat records. For Option A we want a single continuous thread:
      // choose the most recent chat (or merge if you prefer). We'll load the most recent record if exists,
      // otherwise create empty activeChat
      const items = res.data || [];
      if (items.length > 0) {
        // pick the most recent saved chat (assuming saved with timestamp)
        const sorted = items.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const top = sorted[0];
        // normalize history (some records may not have history)
        top.history = top.history || (top.message ? [{ user: top.message, ai: top.reply }] : []);
        setActiveChat(top);
      } else {
        setActiveChat({
          _id: `local-${Date.now()}`,
          message: "New conversation",
          reply: "Start by asking a question or uploading a file.",
          history: [],
          timestamp: Date.now() / 1000,
          pdf_url: null,
        });
      }
    } catch (e) {
      console.error("Load conv error", e);
      // initialize empty thread
      setActiveChat({
        _id: `local-${Date.now()}`,
        message: "New conversation",
        reply: "Start by asking a question or uploading a file.",
        history: [],
        timestamp: Date.now() / 1000,
        pdf_url: null,
      });
    }
  }

  // --- helper to persist conversation on backend (so history remains across login/logout) ---
  const persistChat = async (chat) => {
    try {
      // If backend expects chats.insert_one elsewhere, this endpoint may be custom.
      // We'll call /api/chat to persist when sending; for uploads it's also stored.
      // Here we keep a light-weight save endpoint if exists, otherwise ignore.
      // Attempt optional upsert save: /api/chat/save (non-breaking if not present)
      await axios.post(`${API_BASE}/api/chat/save`, {
        user_id: user?.uid,
        chat,
      }).catch(() => {
        // ignore if endpoint doesn't exist
      });
    } catch (e) {
      // ignore silently
    }
  };

  // --- Cancel / Stop generator ---
  const stopGeneration = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      setLoading(false);
    }
  };

  // --- Send text message (or re-generate) ---
  const sendMessage = async ({ messageOverride = null, isRegenerate = false } = {}) => {
    // strip interim overlay and trim
    const rawMessage = (messageOverride ?? message).replace(/¶INTERIM:.*$/, "").trim();
    if (!rawMessage) {
      // for regenerate we silently return instead of alert
      if (isRegenerate) return;
      return alert("Please type a question or prompt.");
    }

    // add user's message to activeChat.history (but avoid duplicate if same as last)
    const userTurn = { user: rawMessage, ai: null, generating: true };
    setActiveChat((prev) => {
      const copy = { ...(prev || {}) };
      copy.history = copy.history || [];
      // do not duplicate if last user entry identical
      const last = copy.history[copy.history.length - 1];
      if (!last || last.user !== rawMessage) copy.history.push(userTurn);
      else {
        // if regenerating, set last.ai = null and set generating flag
        last.ai = null;
        last.generating = true;
      }
      return copy;
    });

    setMessage("");
    setLoading(true);

    // create AbortController for the axios call
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payload = {
        user_id: user.uid,
        message: task === "contract" ? `Draft a contract:\n\n${rawMessage}` : rawMessage,
      };

      const res = await axios.post(`${API_BASE}/api/chat`, payload, {
        signal: controller.signal,
        timeout: 0, // no extra axios timeout
      });

      const aiReply = res.data.reply;
      const pdf_url = res.data.pdf_url || res.data.pdf || null;

      // update history: find last user entry without ai and set ai
      setActiveChat((prev) => {
        const copy = { ...(prev || {}) };
        copy.history = copy.history || [];
        // find last entry where ai is null (the one we just added)
        for (let i = copy.history.length - 1; i >= 0; i--) {
          if (!copy.history[i].ai) {
            copy.history[i] = { user: copy.history[i].user, ai: aiReply };
            break;
          }
        }
        copy.reply = aiReply;
        copy.pdf_url = pdf_url;
        copy.timestamp = Date.now() / 1000;
        return copy;
      });

      // try to persist if desired (non-breaking)
      await persistChat({
        ...activeChat,
        reply: res.data.reply,
        pdf_url,
        history: (activeChat?.history || []).map((h) => ({ user: h.user, ai: h.ai })),
      });
    } catch (err) {
      if (axios.isCancel?.(err) || err.name === "CanceledError") {
        console.log("Generation canceled.");
        // mark last user turn as ai = "[cancelled]" or leave it blank
        setActiveChat((prev) => {
          const copy = { ...(prev || {}) };
          copy.history = copy.history || [];
          const last = copy.history[copy.history.length - 1];
          if (last && !last.ai) last.ai = "[Generation stopped]";
          return copy;
        });
      } else {
        console.error("Send error", err);
        // show an inline error in the AI reply
        setActiveChat((prev) => {
          const copy = { ...(prev || {}) };
          copy.history = copy.history || [];
          const last = copy.history[copy.history.length - 1];
          if (last && !last.ai) last.ai = "[Failed to generate response — try again]";
          return copy;
        });
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  };

  // --- Regenerate: re-run the last user message (no popup, no duplicates) ---
  const handleRegenerate = async () => {
    if (!activeChat || !activeChat.history || activeChat.history.length === 0) return;
    // find the last user turn (the last history entry)
    const last = activeChat.history[activeChat.history.length - 1];
    if (!last || !last.user) return;

    // stop any ongoing generation first
    stopGeneration();

    // call sendMessage with last.user and isRegenerate flag to avoid alerts
    await sendMessage({ messageOverride: last.user, isRegenerate: true });
  };

  // --- File upload handler (preserve your existing API structure) ---
  const handleUpload = async () => {
    if (!file) return alert("Please select a file first.");
    setLoading(true);
    const fd = new FormData();
    fd.append("user_id", user.uid);
    fd.append("task", task);
    fd.append("file", file);

    try {
      const res = await axios.post(`${API_BASE}/api/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const aiReply = res.data.reply;
      const pdf_url = res.data.pdf_url || res.data.pdf || null;

      setActiveChat((prev) => {
        const copy = { ...(prev || {}) };
        copy.history = copy.history || [];
        copy.history.push({ user: `📄 ${file.name}`, ai: aiReply });
        copy.reply = aiReply;
        copy.pdf_url = pdf_url;
        copy.timestamp = Date.now() / 1000;
        return copy;
      });

      // persist optional
      await persistChat(activeChat);
      setFile(null);
      setFileName("");
    } catch (e) {
      console.error("Upload error", e);
      alert("Upload failed — ensure PDF/DOCX/TXT and try again.");
    } finally {
      setLoading(false);
    }
  };

  // hold-to-record helpers
  const startHoldRecording = () => {
    if (!recognitionRef.current) return alert("Speech recognition not supported in this browser.");
    try {
      setMessage((m) => m.replace(/¶INTERIM:.*$/, ""));
      interimRef.current = "";
      recognitionRef.current.start();
      setListening(true);
    } catch (e) {
      console.warn("Start recording error", e);
    }
  };
  const stopHoldRecording = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
      setListening(false);
    } catch (e) {
      console.warn("Stop recording error", e);
    }
  };

  const onFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileName(f ? f.name : "");
  };

  const handleCopy = (text) => {
    copy(text || "");
    const el = document.createElement("div");
    el.textContent = "Copied to clipboard ✅";
    el.className = "copy-toast";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  };

  const handleResetConversation = () => {
    const placeholder = {
      _id: `placeholder-${Date.now()}`,
      message: "New conversation",
      reply: "Start by asking a question or uploading a file.",
      timestamp: Date.now() / 1000,
      pdf_url: null,
      history: [],
    };
    setActiveChat(placeholder);
  };

  // GST helpers
  const calculateGst = async () => {
    if (!gstAmount) return alert("Enter an amount first.");
    try {
      const res = await axios.post(`${API_BASE}/api/gst/calc`, {
        amount: parseFloat(gstAmount),
        rate: gstRate,
        inclusive,
        interstate,
      });
      setGstResult(res.data);
    } catch (e) {
      console.error("GST calc error", e);
      alert("Calculation failed.");
    }
  };
  const loadGstTips = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/gst/tips`);
      setGstTips(res.data || []);
    } catch (e) {
      console.error("GST tips fetch error", e);
    }
  };
  useEffect(() => {
    if (showGstPanel) loadGstTips();
    // eslint-disable-next-line
  }, [showGstPanel]);

  return (
    <div className="flex h-screen bg-[#0b0b0d] text-gray-100">
      {/* Sidebar minimal (keeps design but Option A single thread) */}
      <aside className="w-80 bg-[#0f1012] border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">⚖️ LegalSathi</h1>
            <div className="text-xs text-gray-400 mt-1">AI legal assistant</div>
          </div>
          <div className="flex gap-2">
            <button title="New" onClick={handleResetConversation} className="p-2 rounded hover:bg-gray-800">
              <Plus size={18} />
            </button>
            <button title="Library" onClick={() => (window.location.pathname = "/library")} className="p-2 rounded hover:bg-gray-800">
              <BookOpen size={18} />
            </button>
          </div>
        </div>

        <div className="p-3 border-b border-gray-800">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search chats / docs..."
            className="w-full bg-[#0f1012] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          <div className="text-gray-500 px-3 text-sm">This app uses a single continuous thread per user. History loads on login.</div>
        </div>

        <div className="p-3 border-t border-gray-800 flex items-center gap-2">
          <div className="flex-1 text-xs text-gray-400">
            Signed in as <strong className="text-gray-200">{user?.email || user?.displayName || "User"}</strong>
          </div>
          <button onClick={() => auth.signOut()} className="text-red-400 hover:text-red-300">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col">
        <header className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-[#0f1012]">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Chat</h2>

            <select
              value={task}
              onChange={(e) => setTask(e.target.value)}
              className="bg-[#121214] border border-gray-700 text-sm text-gray-200 px-2 py-1 rounded"
              title="Choose task"
            >
              <option value="summarize">Summarize Document</option>
              <option value="contract">Draft Contract / Agreement</option>
              <option value="explain">Explain Clause / Law</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setShowGstPanel(!showGstPanel)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2">
              <Calculator size={14} /> GST / Tax Tools
            </button>
            <button onClick={() => loadConversation()} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700">Refresh</button>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-6 chat-content" ref={scrollRef}>
          {!activeChat ? (
            <div className="text-gray-500 text-center mt-28">Loading...</div>
          ) : (
            <article className="max-w-3xl mx-auto space-y-4">
              {/* Render entire conversation history */}
              {(activeChat.history || []).map((turn, i) => (
                <div key={i} className="space-y-2">
                  <div className="text-right text-blue-400 text-sm">{turn.user}</div>
                  <div className="bg-[#151518] p-6 rounded-lg text-gray-200 whitespace-pre-wrap reply-box">
                    {turn.ai ?? (turn.generating ? "Generating..." : "No reply yet.")}
                  </div>
                </div>
              ))}

              {/* PDF download + Copy + Regenerate + Stop */}
              <div className="flex items-center gap-3 mt-3">
                {activeChat.pdf_url && (
                  <a href={activeChat.pdf_url.startsWith("http") ? activeChat.pdf_url : `${API_BASE}${activeChat.pdf_url}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline flex items-center gap-2">
                    <FileText size={16} /> Download PDF
                  </a>
                )}

                <button onClick={() => handleCopy(activeChat.reply)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2">
                  <Copy size={14} /> Copy
                </button>

                <button
                  onClick={handleRegenerate}
                  disabled={loading}
                  className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2"
                  title="Regenerate last response"
                >
                  🔄 Regenerate
                </button>

                <button
                  onClick={stopGeneration}
                  disabled={!loading}
                  className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2"
                  title="Stop generating"
                >
                  ⏹ Stop
                </button>
              </div>
            </article>
          )}
        </section>

        {/* composer */}
        <footer className="p-4 border-t border-gray-800 bg-[#0f1012]">
          <div className="max-w-6xl mx-auto flex items-center gap-3 composer-row">
            <input id="file-input" type="file" accept=".pdf,.docx,.txt" onChange={onFileChange} className="hidden" />
            <label htmlFor="file-input" className="cursor-pointer px-3 py-2 bg-[#121214] border border-gray-700 rounded flex items-center gap-2 text-sm">
              <Upload size={14} /> {fileName ? fileName : "Choose file"}
            </label>

            <div className="flex-1 relative textarea-wrapper">
              <textarea
                value={message.replace(/¶INTERIM:.*$/, "")}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={task === "contract" ? "Describe the contract you want (parties, duration, rent, deposit, special clauses)..." : "Type your question or paste text here..."}
                className="composer-textarea"
                rows={2}
              />

              {/* inline mic inside textarea corner: hold to record */}
              {supportsSpeech && (
                <button
                  title={listening ? "Release to stop" : "Hold to record"}
                  onMouseDown={(e) => { e.preventDefault(); startHoldRecording(); }}
                  onMouseUp={(e) => { e.preventDefault(); stopHoldRecording(); }}
                  onMouseLeave={(e) => { if (listening) stopHoldRecording(); }}
                  onTouchStart={(e) => { e.preventDefault(); startHoldRecording(); }}
                  onTouchEnd={(e) => { e.preventDefault(); stopHoldRecording(); }}
                  className={`textarea-mic ${listening ? "listening" : ""}`}
                >
                  {listening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button onClick={() => (file ? handleUpload() : sendMessage())} disabled={loading} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm">
                {loading ? "Processing..." : file ? (task === "summarize" ? "Summarize" : task === "contract" ? "Draft" : "Explain") : "Send"}
              </button>

              <button onClick={() => { setMessage(""); setFile(null); setFileName(""); }} className="text-xs text-gray-400 underline">Clear composer</button>
            </div>
          </div>

          {/* centered disclaimer */}
          <div className="max-w-6xl mx-auto mt-3 text-xs text-gray-400 disclaimer">
            ⚠️ <strong>LegalSathi can make mistakes.</strong> Check important info and cross-verify before using for legal decisions.
          </div>
        </footer>
      </main>

      {/* GST / Tax Tool Panel */}
      {showGstPanel && (
        <div className="fixed bottom-6 right-6 bg-[#111113] border border-gray-700 rounded-xl p-5 w-96 shadow-2xl text-gray-100 z-50 animate-fade-in">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-lg flex items-center gap-2"><Calculator size={16} /> GST / Tax Tools</h3>
            <button onClick={() => setShowGstPanel(false)} className="text-gray-400 hover:text-gray-200"><X size={16} /></button>
          </div>

          <div className="space-y-2">
            <input type="number" placeholder="Enter amount (₹)" value={gstAmount} onChange={(e) => setGstAmount(e.target.value)} className="w-full bg-[#1a1a1d] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200" />
            <div className="flex items-center gap-2">
              <select value={gstRate} onChange={(e) => setGstRate(e.target.value)} className="flex-1 bg-[#1a1a1d] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200">
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} /> Inclusive</label>
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={interstate} onChange={(e) => setInterstate(e.target.checked)} /> Interstate</label>
            </div>

            <button onClick={calculateGst} className="w-full bg-blue-600 hover:bg-blue-500 rounded py-2 mt-2 text-sm">Calculate</button>

            {gstResult && (
              <div className="bg-[#1a1a1d] border border-gray-700 rounded p-3 mt-3 text-sm">
                <div>Base Amount: ₹{gstResult.base_amount}</div>
                <div>GST ({gstResult.rate_percent}%): ₹{gstResult.gst_amount}</div>
                {gstResult.igst ? <div>IGST: ₹{gstResult.igst}</div> : <>
                  <div>CGST: ₹{gstResult.cgst}</div>
                  <div>SGST: ₹{gstResult.sgst}</div>
                </>}
                <div className="mt-2 font-semibold text-blue-400">Total: ₹{gstResult.total_amount}</div>
              </div>
            )}

            {gstTips.length > 0 && (
              <div className="mt-4 border-t border-gray-700 pt-3">
                <div className="text-sm font-semibold mb-1 text-gray-300">GST / Tax Tips:</div>
                <ul className="space-y-1 text-xs text-gray-400 max-h-32 overflow-y-auto">
                  {gstTips.map((t, i) => <li key={i}>• {t.title}: {t.description}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
