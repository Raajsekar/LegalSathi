import React, { useEffect, useRef, useState } from "react";
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

  // conversations / active conversation
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null); // { _id, title, history: [{user, ai}], snippet }

  // composer / file / task
  const [message, setMessage] = useState("");
  const [file, setFile] = useState(null);
  const [fileName, setFileName] = useState("");
  const [task, setTask] = useState("summarize");

  // UI states
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [supportsSpeech, setSupportsSpeech] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showGstPanel, setShowGstPanel] = useState(false);

  // GST states
  const [gstAmount, setGstAmount] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [inclusive, setInclusive] = useState(false);
  const [interstate, setInterstate] = useState(false);
  const [gstResult, setGstResult] = useState(null);
  const [gstTips, setGstTips] = useState([]);

  // helpers
  const recognitionRef = useRef(null);
  const interimRef = useRef("");
  const abortRef = useRef(null);
  const scrollRef = useRef(null);

  // ---------- init: load conversations + speech ----------
  useEffect(() => {
    if (user) fetchConversations();

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
  }, [activeConv, conversations]);

  // ---------- API: conversations ----------
  const fetchConversations = async () => {
    if (!user) return;
    try {
      const res = await axios.get(`${API_BASE}/api/conversations/${user.uid}`);
      const convs = (res.data || []).map((c) => ({
        ...c,
        title: c.title || (c.reply || "").substring(0, 60) || "Untitled",
        snippet: c.reply ? c.reply.substring(0, 200) : "",
      }));
      setConversations(convs);
      if (convs.length) loadConversation(convs[0]._id);
    } catch (e) {
      console.error("fetchConversations", e);
    }
  };

  const loadConversation = async (convId) => {
    if (!convId) return;
    try {
      const res = await axios.get(`${API_BASE}/api/conversation/${convId}`);
      const msgs = res.data || [];
      // convert messages into history [{user, ai}]
      const history = [];
      let pendingUser = null;
      for (const m of msgs) {
        if (m.role === "user") {
          pendingUser = (m.content || "").trim();
        } else if (m.role === "assistant") {
          history.push({ user: pendingUser || "", ai: m.content || "" });
          pendingUser = null;
        }
      }
      if (pendingUser) history.push({ user: pendingUser, ai: "" });

      setActiveConv({ _id: convId, title: (msgs[0] && msgs[0].content) || "Conversation", history });
    } catch (e) {
      console.error("loadConversation", e);
    }
  };

  const createNewConversation = async () => {
    if (!user) return;
    try {
      await axios.post(`${API_BASE}/api/newchat/${user.uid}`);
      await fetchConversations();
    } catch (e) {
      console.error("createNewConversation", e);
    }
  };

  // ---------- send message (stream) ----------
  const sendMessage = async () => {
    const clean = message.replace(/¶INTERIM:.*$/, "").trim();
    if (!clean) return alert("Please type a question or prompt.");

    setMessage("");
    setLoading(true);

    const convId = activeConv?._id || null;

    // append user turn locally
    setActiveConv((prev) => {
      const h = [...(prev?.history || [])];
      h.push({ user: (task === "contract" ? `Draft a contract:\n\n${clean}` : clean), ai: "" });
      return { ...prev, history: h };
    });

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_BASE}/api/stream_chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ user_id: user.uid, conv_id: convId, message: (task === "contract" ? `Draft a contract:\n\n${clean}` : clean) }),
      });

      if (!res.ok) throw new Error("stream failed");

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let done = false;
      let accumulated = "";
      let newConvId = convId;

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = dec.decode(value, { stream: true });
          const lines = chunk.split("\n").filter(Boolean);
          for (const l of lines) {
            let obj;
            try {
              obj = JSON.parse(l);
            } catch (e) {
              continue;
            }
            if (obj.chunk) {
              accumulated += obj.chunk;
              // update last turn
              setActiveConv((prev) => {
                const h = [...(prev?.history || [])];
                const last = h[h.length - 1] || { user: "", ai: "" };
                last.ai = accumulated;
                h[h.length - 1] = last;
                return { ...prev, history: h };
              });
            }
            if (obj.done) {
              newConvId = obj.conv_id || newConvId;
            }
          }
        }
      }

      // finalize
      if (!convId && newConvId) {
        setActiveConv((prev) => ({ ...prev, _id: newConvId }));
        fetchConversations();
      } else {
        fetchConversations();
      }
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("stream aborted");
      } else {
        console.error("sendMessage stream failed", err);
        // fallback to non-stream
        try {
          const fallback = await axios.post(`${API_BASE}/api/chat`, { user_id: user.uid, conv_id: convId, message: (task === "contract" ? `Draft a contract:\n\n${clean}` : clean) });
          const ai = fallback.data.reply;
          setActiveConv((prev) => {
            const h = [...(prev?.history || [])];
            h[h.length - 1] = { user: clean, ai };
            return { ...prev, history: h };
          });
          fetchConversations();
        } catch (e) {
          console.error("fallback failed", e);
        }
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const stopGenerating = () => {
    try {
      if (abortRef.current) abortRef.current.abort();
    } catch (e) {
      console.warn(e);
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  };

  const regenerateLast = () => {
    if (!activeConv) return;
    const lastTurn = (activeConv.history || []).slice(-1)[0];
    if (!lastTurn?.user) return;
    setMessage(lastTurn.user.replace(/^Draft a contract:\n\n/, ""));
    setTimeout(() => sendMessage(), 120);
  };

  // ---------- upload file ----------
  const handleUpload = async () => {
    if (!file) return alert("Choose a file first");
    setLoading(true);
    const fd = new FormData();
    fd.append("user_id", user.uid);
    fd.append("task", task);
    fd.append("file", file);
    try {
      const res = await axios.post(`${API_BASE}/api/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      // open as a new conversation entry (backend already stored)
      await fetchConversations();
    } catch (e) {
      console.error("upload", e);
      alert("Upload failed");
    } finally {
      setFile(null);
      setFileName("");
      setLoading(false);
    }
  };

  const onFileChange = (e) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setFileName(f ? f.name : "");
  };

  // ---------- GST ----------
  const calculateGst = async () => {
    if (!gstAmount) return alert("Enter an amount first.");
    try {
      const res = await axios.post(`${API_BASE}/api/gst/calc`, { amount: parseFloat(gstAmount), rate: gstRate, inclusive, interstate });
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
      console.error("GST tips", e);
    }
  };

  useEffect(() => { if (showGstPanel) loadGstTips(); }, [showGstPanel]);

  // ---------- speech helpers ----------
  const startHoldRecording = async () => {
    if (!recognitionRef.current) return alert("Speech unsupported");
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      setMessage((m) => m.replace(/¶INTERIM:.*$/, ""));
      interimRef.current = "";
      recognitionRef.current.start();
      setListening(true);
    } catch (e) {
      console.warn("mic err", e);
    }
  };

  const stopHoldRecording = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
      setTimeout(() => setListening(false), 120);
    } catch (e) { console.warn(e); }
  };

  const handleCopy = (txt) => {
    copy(txt || "");
    const el = document.createElement("div");
    el.className = "copy-toast";
    el.textContent = "Copied ✅";
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  };

  // sidebar search
  const filtered = conversations.filter(
    (c) => (c.title && c.title.toLowerCase().includes(searchQuery.toLowerCase())) || (c.snippet && c.snippet.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex h-screen bg-[#0b0b0d] text-gray-100">
      {/* Sidebar */}
      <aside className="w-80 bg-[#0f1012] border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">⚖️ LegalSathi</h1>
            <div className="text-xs text-gray-400">AI legal assistant</div>
          </div>
          <div className="flex gap-2">
            <button title="New" onClick={createNewConversation} className="p-2 rounded hover:bg-gray-800"><Plus size={18} /></button>
            <button title="Library" onClick={() => (window.location.pathname = "/library")} className="p-2 rounded hover:bg-gray-800"><BookOpen size={18} /></button>
          </div>
        </div>

        <div className="p-3 border-b border-gray-800">
          <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search..." className="w-full bg-[#0f1012] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200" />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {filtered.length === 0 && <div className="text-gray-500 px-3 text-sm">No conversations yet.</div>}
          {filtered.map((c, i) => (
            <div key={c._id || i} onClick={() => loadConversation(c._id)} className={`p-3 rounded-lg cursor-pointer transition-colors text-sm ${activeConv?._id === c._id ? "bg-[#1b1c20]" : "bg-[#121214] hover:bg-[#18181b]"}`}>
              <div className="truncate font-medium">{c.title || "Untitled"}</div>
              <div className="text-xs text-gray-500 mt-1 line-clamp-2">{c.snippet || ""}</div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-gray-800 flex items-center gap-2">
          <div className="flex-1 text-xs text-gray-400">Signed in as <strong className="text-gray-200">{user?.email || "User"}</strong></div>
          <button onClick={() => auth.signOut()} className="text-red-400 hover:text-red-300"><LogOut size={16} /></button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col">
        <header className="px-6 py-4 border-b border-gray-800 flex items-center justify-between bg-[#0f1012]">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Chat</h2>
            <select value={task} onChange={(e) => setTask(e.target.value)} className="bg-[#121214] border border-gray-700 text-sm text-gray-200 px-2 py-1 rounded">
              <option value="summarize">Summarize Document</option>
              <option value="contract">Draft Contract / Agreement</option>
              <option value="explain">Explain Clause / Law</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => setShowGstPanel(!showGstPanel)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2"><Calculator size={14} /> GST</button>
            <button onClick={() => fetchConversations()} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700">Refresh</button>
          </div>
        </header>

        <section ref={scrollRef} className="flex-1 overflow-y-auto p-6 chat-content">
          {!activeConv ? (
            <div className="text-gray-500 text-center mt-28">Pick a conversation or create a new one.</div>
          ) : (
            <article className="max-w-3xl mx-auto space-y-4">
              {activeConv.history?.map((turn, i) => (
                <div key={i} className="space-y-1">
                  <div className="text-right text-blue-400 text-sm">{turn.user}</div>
                  <div className="bg-[#151518] p-6 rounded-lg text-gray-200 whitespace-pre-wrap reply-box">{turn.ai || "..."}</div>
                </div>
              ))}

              <div className="flex items-center gap-3 mt-3">
                <button onClick={() => handleCopy((activeConv.history?.slice(-1)[0] || {}).ai)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2"><Copy size={14} /> Copy</button>
                <button onClick={regenerateLast} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2"><RotateCw size={14} /> Regenerate</button>
                {loading && (<button onClick={stopGenerating} className="text-sm px-3 py-1 rounded bg-[#7f1d1d] border border-gray-700 flex items-center gap-2"><Square size={14} /> Stop</button>)}
              </div>
            </article>
          )}
        </section>

        {/* composer */}
        <footer className="p-4 border-t border-gray-800 bg-[#0f1012]">
          <div className="max-w-6xl mx-auto flex items-center gap-3 composer-row">
            <input id="file-input" type="file" accept=".pdf,.docx,.txt" onChange={onFileChange} className="hidden" />
            <label htmlFor="file-input" className="cursor-pointer px-3 py-2 bg-[#121214] border border-gray-700 rounded flex items-center gap-2 text-sm"><Upload size={14} /> {fileName ? fileName : "Choose file"}</label>

            <div className="flex-1 relative textarea-wrapper">
              <textarea value={message.replace(/¶INTERIM:.*$/, "")} onChange={(e) => setMessage(e.target.value)} placeholder={task === "contract" ? "Describe the contract you want (parties, duration, rent, deposit, special clauses)..." : "Type your question or paste text here..."} className="composer-textarea" rows={2} />

              {supportsSpeech && (
                <button title={listening ? "Release to stop" : "Hold to record"} onMouseDown={(e) => { e.preventDefault(); startHoldRecording(); }} onMouseUp={(e) => { e.preventDefault(); stopHoldRecording(); }} onMouseLeave={(e) => { if (listening) stopHoldRecording(); }} onTouchStart={(e) => { e.preventDefault(); startHoldRecording(); }} onTouchEnd={(e) => { e.preventDefault(); stopHoldRecording(); }} className={`textarea-mic ${listening ? "listening" : ""}`}>
                  {listening ? <MicOff size={16} /> : <Mic size={16} />}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <button onClick={() => (file ? handleUpload() : sendMessage())} disabled={loading} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm">{loading ? "Processing..." : file ? (task === "summarize" ? "Summarize" : task === "contract" ? "Draft" : "Explain") : "Send"}</button>
              <button onClick={() => { setMessage(""); setFile(null); setFileName(""); }} className="text-xs text-gray-400 underline">Clear</button>
            </div>
          </div>

          <div className="max-w-6xl mx-auto mt-3 text-xs text-gray-400 disclaimer">⚠️ <strong>LegalSathi can make mistakes.</strong> Cross-check important advice before acting.</div>
        </footer>
      </main>

      {/* GST Panel */}
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
                <ul className="space-y-1 text-xs text-gray-400 max-h-32 overflow-y-auto">{gstTips.map((t, i) => <li key={i}>• {t.title}: {t.description}</li>)}</ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
