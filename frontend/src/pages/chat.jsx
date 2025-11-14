// Chat.jsx
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
  RotateCw,
  Square,
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
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  
  const [showGstPanel, setShowGstPanel] = useState(false);

  // voice states
  const [listening, setListening] = useState(false);
  const [supportsSpeech, setSupportsSpeech] = useState(false);

  // streaming/abort
  const abortControllerRef = useRef(null);

  // GST calculator states
  const [gstAmount, setGstAmount] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [inclusive, setInclusive] = useState(false);
  const [interstate, setInterstate] = useState(false);
  const [gstResult, setGstResult] = useState(null);
  const [gstTips, setGstTips] = useState([]);

  const scrollRef = useRef(null);
  const recognitionRef = useRef(null);
  const interimRef = useRef(""); // store interim between events

  // --- init: fetch chats and speech detection ---
  useEffect(() => {
    if (user) fetchChats();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSupportsSpeech(true);
      const r = new SpeechRecognition();
      r.continuous = false; // single shot per hold
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
        setMessage((prevBase) => {
          // remove any existing interim overlay
          const base = prevBase.replace(/¶INTERIM:.*$/, "");
          if (final) {
            // final results get appended permanently
            return (base ? base + " " : "") + final;
          }
          // show interim as marker appended (not committed)
          return base + (interim ? ` ¶INTERIM:${interim}` : "");
        });
      };

      r.onend = () => {
        // finalize text: remove interim marker and ensure state updates render
        setTimeout(() => {
          setListening(false);
          setMessage((m) => m.replace(/¶INTERIM:.*$/, "").trim());
          interimRef.current = "";
        }, 120);
      };

      r.onerror = (e) => {
        console.warn("Speech error", e);
        setListening(false);
        interimRef.current = "";
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }, 80);
    }
  }, [activeChat, chats]);

  // --- API: fetch history ---
  const fetchChats = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/history/${user.uid}`);
      const items = res.data || [];
      // Normalize: ensure history array and _id present
      const normalized = items.map((it) => {
        // prefer conv id fields from backend
        const id = it.conv_id || it._id || it._id_str || it._id?.toString();
        return {
          ...it,
          _id: id || it._id || undefined,
          history: it.history || (it.message ? [{ user: it.message, ai: it.reply }] : []),
        };
      });
      setChats(normalized);
      if (normalized.length > 0) setActiveChat(normalized[0]);
    } catch (e) {
      console.error("Fetch error", e);
    }
  };

  // --- Utility: save chat entry locally and keep top-most ordering ---
  const upsertChatEntry = (entry) => {
    setChats((prev) => {
      // if incoming entry has _id, merge into existing
      if (entry._id) {
        const idx = prev.findIndex((c) => c._id === entry._id);
        if (idx !== -1) {
          const updated = prev.slice();
          updated[idx] = { ...updated[idx], ...entry };
          const moved = updated.splice(idx, 1)[0];
          return [moved, ...updated];
        }
      }
      // fallback: if activeChat exists and has _id, append into it
      return [entry, ...prev];
    });
  };

  // --- STOP GENERATING (abort current request) ---
  const stopGenerating = () => {
    try {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    } catch (e) {
      console.warn("Abort error", e);
    } finally {
      setLoading(false);
    }
  };

  // --- SEND MESSAGE with streaming fallback ---
  const sendMessage = async () => {
    // remove interim overlay marker
    const cleanMessage = message.replace(/¶INTERIM:.*$/, "").trim();
    if (!cleanMessage) return alert("Please type a question or prompt.");
    setLoading(true);
    // create a provisional local entry so UI feels responsive
    const localId = `local-${Date.now()}`;
    const existingConvId = activeChat && activeChat._id ? activeChat._id : null;

    // optimistic entry
    const optimisticEntry = {
      _id: existingConvId || localId,
      message: cleanMessage,
      reply: activeChat?.reply || "",
      pdf_url: activeChat?.pdf_url || null,
      timestamp: Date.now() / 1000,
     history: [
  ...(activeChat?.history || []),
  { user: cleanMessage, ai: "" }  // added only once
]
,
    };

    upsertChatEntry(optimisticEntry);
    setActiveChat(optimisticEntry);
    setMessage("");

    // Try streaming endpoint first (backend: /api/stream_chat)
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const payload = {
      user_id: user.uid,
      conv_id: existingConvId || null,
      message: cleanMessage,
    };

    try {
      // Attempt streaming fetch
      const streamRes = await fetch(`${API_BASE}/api/stream_chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!streamRes.ok) {
        // fallback to non-streaming POST /api/chat
        throw new Error(`Stream unavailable: ${streamRes.status}`);
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulated = "";

      // ensure UI shows we are generating
      setLoading(true);

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          // server sends newline delimited JSON per your backend; handle gracefully
          const lines = chunk.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.chunk) {
                accumulated += obj.chunk;
                // update optimistic entry partial reply
                setChats((prev) => {
                  const updated = prev.slice();
                  const idx = updated.findIndex((c) => c._id === optimisticEntry._id);
                  if (idx === -1) return prev;
                  updated[idx] = {
                    ...updated[idx],
                    reply: accumulated,
                    history: [
  ...(updated[idx].history || []),
  { user: cleanMessage, ai: accumulated }
],

                  };
                  return updated;
                });
                // reflect in activeChat
                setActiveChat((prev) => {
                  if (!prev) return prev;
                  return { ...prev, reply: accumulated, history: [...(prev.history || []).slice(0, -1), { user: cleanMessage, ai: accumulated }] };
                });
              } else if (obj.done) {
                // finalization: backend may return conv_id
                const convId = obj.conv_id || existingConvId || optimisticEntry._id;
                // save final message to DB via fetch? The backend already saved on its side.
                // Update ID if needed
                setChats((prev) => {
                  const updated = prev.slice();
                  const idx = updated.findIndex((c) => c._id === optimisticEntry._id);
                  if (idx !== -1) {
                    updated[idx] = { ...updated[idx], _id: convId, reply: accumulated };
                    const moved = updated.splice(idx, 1)[0];
                    return [moved, ...updated];
                  }
                  return prev;
                });
                setActiveChat((prev) => prev ? { ...prev, _id: convId, reply: accumulated } : prev);
              }
            } catch (e) {
              // Not JSON -- try to treat as plain text chunk
              accumulated += chunk;
              setChats((prev) => {
                const updated = prev.slice();
                const idx = updated.findIndex((c) => c._id === optimisticEntry._id);
                if (idx !== -1) {
                  updated[idx] = { ...updated[idx], reply: accumulated, history: [
  ...(updated[idx].history || []).map((h, index) =>
    index === updated[idx].history.length - 1
      ? { user: cleanMessage, ai: accumulated }
      : h
  )
]
 };
                }
                return updated;
              });
              setActiveChat((prev) => prev ? { ...prev, reply: accumulated } : prev);
            }
          }
        }
      }

      setLoading(false);
      abortControllerRef.current = null;
    } catch (err) {
      // If streaming failed or aborted, fallback to simple POST /api/chat (non-stream)
      if (err.name === "AbortError") {
        console.log("Stream aborted by user.");
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }

      try {
        const res = await axios.post(`${API_BASE}/api/chat`, {
          user_id: user.uid,
          message: task === "contract" ? `Draft a contract:\n\n${cleanMessage}` : cleanMessage,
          conv_id: existingConvId || null,
        });

        const aiReply = res.data.reply;
        const convId = res.data.conv_id || res.data._id || existingConvId || optimisticEntry._id;
        const pdf_url = res.data.pdf_url || res.data.pdf || null;

        const finalEntry = {
          _id: convId,
          message: cleanMessage,
          reply: aiReply,
          pdf_url,
          timestamp: Date.now() / 1000,
          history: [
  ...(activeChat?.history || []),
  { user: cleanMessage, ai: aiReply }
],

        };

        upsertChatEntry(finalEntry);
        setActiveChat(finalEntry);
      } catch (e) {
        console.error("Send error (both stream & fallback):", e);
        alert("Failed to send message — try again.");
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  // --- REGENERATE last user prompt (resend last user message) ---
  const regenerateLast = async (chat) => {
    if (!chat) return;
    const lastTurn = (chat.history || []).slice(-1)[0];
    const lastUser = lastTurn?.user || chat.message;
    if (!lastUser) return alert("No user message to regenerate.");
    setMessage(lastUser);
    // small delay to allow UI update then send
    setTimeout(() => sendMessage(), 120);
  };

  // --- FILE UPLOAD (summarize / explain) ---
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
      const convId = res.data.conv_id || res.data._id || undefined;
      const pdf_url = res.data.pdf_url || res.data.pdf || null;

      const newEntry = {
        _id: convId || `local-${Date.now()}`,
        message: `📄 ${file.name}`,
        reply: aiReply,
        pdf_url,
        timestamp: Date.now() / 1000,
        history: [{ user: `📄 ${file.name}`, ai: aiReply }],
      };

      upsertChatEntry(newEntry);
      setActiveChat(newEntry);
      setFile(null);
      setFileName("");
    } catch (e) {
      console.error("Upload error", e);
      alert("Upload failed — ensure PDF/DOCX/TXT and try again.");
    } finally {
      setLoading(false);
    }
  };

  // --- file input change (show filename) ---
  const onFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileName(f ? f.name : "");
  };

  // copy reply
  const handleCopy = (text) => {
    copy(text || "");
    const el = document.createElement("div");
    el.textContent = "Copied to clipboard ✅";
    el.className = "copy-toast";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  };

  // Reset conversation: create placeholder new chat but do NOT delete backend history
  const handleResetConversation = () => {
    const placeholder = {
      _id: `placeholder-${Date.now()}`,
      message: "",
      reply: "",
      timestamp: Date.now() / 1000,
      pdf_url: null,
      history: [{ user: "", ai: "" }],
    };
    setChats((prev) => [placeholder, ...prev]);
    setActiveChat(placeholder);
  };

  // --- GST tools ---
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showGstPanel]);

  // --- speech handling helpers (Hold-to-record) ---
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
      // keep listening state for a short moment so animation shows
      setTimeout(() => setListening(false), 140);
    } catch (e) {
      console.warn("Stop recording error", e);
    }
  };

  // Filtered chats for Sidebar search
  const filtered = chats.filter(
    (c) =>
      (c.message && c.message.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.reply && c.reply.toLowerCase().includes(searchQuery.toLowerCase()))
  );


const deleteConversation = async (id) => {
  try {
    await axios.delete(`${API_BASE}/api/conversation/${id}`);

    // remove locally
    setChats((prev) => prev.filter((c) => c._id !== id));

    // if current chat was deleted → clear screen
    if (activeChat?._id === id) setActiveChat(null);

  } catch (e) {
    console.error("Delete error", e);
  }
};

  return (
    <div className="flex h-screen bg-[#0b0b0d] text-gray-100">
      {/* Sidebar */}
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
          {filtered.length === 0 && (
            <div className="text-gray-500 px-3 text-sm">No chats yet — start a conversation.</div>
          )}

          {filtered.map((c, i) => (
  <div
    key={c._id || i}
    className={`p-3 rounded-lg flex items-start justify-between gap-2 cursor-pointer transition-colors text-sm ${
      activeChat === c ? "bg-[#1b1c20]" : "bg-[#121214] hover:bg-[#18181b]"
    }`}
    onClick={() => setActiveChat(c)}
  >
    {/* LEFT SIDE – CHAT TITLE & PREVIEW */}
    <div className="flex-1">
      <div className="truncate font-medium">
        {c.message || "Untitled"}
      </div>
      <div className="text-xs text-gray-500 mt-1 line-clamp-2">
        {(c.reply || "").substring(0, 140)}
      </div>
    </div>

    {/* RIGHT SIDE – DELETE BUTTON */}
    <button
      title="Delete chat"
      onClick={(e) => {
        e.stopPropagation();       // prevents opening the chat
        deleteConversation(c._id); // call your delete function
      }}
      className="text-red-400 hover:text-red-300"
    >
      <X size={14} />
    </button>
  </div>
))}

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

           
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setShowGstPanel(!showGstPanel)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2">
              <Calculator size={14} /> GST / Tax Tools
            </button>
            <button onClick={() => fetchChats()} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700">Refresh</button>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-6 chat-content" ref={scrollRef}>
          {!activeChat ? (
            <div className="text-gray-500 text-center mt-28">Pick a chat or start a new one.</div>
          ) : (
            <article className="max-w-3xl mx-auto space-y-4">
              {(activeChat.history || [{ user: activeChat.message, ai: activeChat.reply }]).map((turn, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-right text-blue-400 text-sm">{turn.user}</div>
                  <div className="bg-[#151518] p-6 rounded-lg text-gray-200 whitespace-pre-wrap reply-box">{turn.ai || ""}</div>
                </div>
              ))}

              {activeChat.history && activeChat.history.length > 0 && activeChat.history[0].ai && (
  <div className="flex items-center gap-3 mt-3">
    {activeChat.pdf_url && (
      <a
        href={activeChat.pdf_url.startsWith("http") ? activeChat.pdf_url : `${API_BASE}${activeChat.pdf_url}`}
        target="_blank"
        rel="noreferrer"
        className="text-blue-400 hover:underline flex items-center gap-2"
      >
        <FileText size={16} /> Download PDF
      </a>
    )}

    <button onClick={() => handleCopy(activeChat.reply)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2">
      <Copy size={14} /> Copy
    </button>

    <button onClick={() => regenerateLast(activeChat)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2">
      <RotateCw size={14} /> Regenerate
    </button>

    {loading && (
      <button onClick={stopGenerating} className="text-sm px-3 py-1 rounded bg-[#7f1d1d] hover:bg-[#9b1f1f] border border-gray-700 flex items-center gap-2">
        <Square size={14} /> Stop
      </button>
    )}
  </div>
)}

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
