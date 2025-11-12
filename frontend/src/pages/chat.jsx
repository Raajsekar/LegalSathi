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

  // GST calculator states
  const [gstAmount, setGstAmount] = useState("");
  const [gstRate, setGstRate] = useState(18);
  const [inclusive, setInclusive] = useState(false);
  const [interstate, setInterstate] = useState(false);
  const [gstResult, setGstResult] = useState(null);
  const [gstTips, setGstTips] = useState([]);

  const scrollRef = useRef(null);

  useEffect(() => {
    if (user) fetchChats();
  }, [user]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeChat, chats]);

  // Fetch chats
  const fetchChats = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/history/${user.uid}`);
      const items = res.data || [];
      setChats(items);
      if (items.length > 0) setActiveChat(items[0]);
    } catch (e) {
      console.error("Fetch error", e);
    }
  };

  // Send message
  const sendMessage = async () => {
    if (!message.trim()) return alert("Please type a question or prompt.");
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/chat`, {
        user_id: user.uid,
        message: task === "contract" ? `Draft a contract:\n\n${message}` : message,
      });

      const newMessage = {
  message,
  reply: res.data.reply,
  pdf_url: res.data.pdf_url || res.data.pdf || null,
  timestamp: Date.now() / 1000,
};

// if a chat already exists, append to it
setChats((prev) => {
  if (activeChat) {
    const updated = [...prev];
    updated[0] = {
      ...updated[0],
      history: [
        ...(updated[0].history || []),
        { user: message, ai: res.data.reply },
      ],
    };
    return updated;
  }
  return [newMessage, ...prev];
});

setActiveChat((prev) => ({
  ...prev,
  history: [...(prev?.history || []), { user: message, ai: res.data.reply }],
}));
setMessage("");

    } catch (e) {
      console.error("Send error", e);
      alert("Failed to send message — try again.");
    } finally {
      setLoading(false);
    }
  };

  // File upload
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

      const newChat = {
        message: `📄 ${file.name}`,
        reply: res.data.reply,
        pdf_url: res.data.pdf_url || res.data.pdf || null,
        timestamp: Date.now() / 1000,
      };

      setChats((prev) => {
  if (activeChat) {
    const updated = [...prev];
    updated[0] = {
      ...updated[0],
      history: [
        ...(updated[0].history || []),
        { user: `📄 ${file.name}`, ai: res.data.reply },
      ],
    };
    return updated;
  }
  return [newChat, ...prev];
});

setActiveChat((prev) => ({
  ...prev,
  history: [
    ...(prev?.history || []),
    { user: `📄 ${file.name}`, ai: res.data.reply },
  ],
}));
setFile(null);
setFileName("");

    } catch (e) {
      console.error("Upload error", e);
      alert("Upload failed — ensure PDF/DOCX/TXT and try again.");
    } finally {
      setLoading(false);
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
      message: "New conversation",
      reply: "Start by asking a question or uploading a file.",
      timestamp: Date.now() / 1000,
      pdf_url: null,
    };
    setChats((prev) => [placeholder, ...prev]);
    setActiveChat(placeholder);
  };

  // GST calculator actions
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
  }, [showGstPanel]);

  const filtered = chats.filter(
    (c) =>
      (c.message && c.message.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.reply && c.reply.toLowerCase().includes(searchQuery.toLowerCase()))
  );

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
            <button
              title="New"
              onClick={handleResetConversation}
              className="p-2 rounded hover:bg-gray-800"
            >
              <Plus size={18} />
            </button>
            <button
              title="Library"
              onClick={() => (window.location.pathname = "/library")}
              className="p-2 rounded hover:bg-gray-800"
            >
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
            <div className="text-gray-500 px-3 text-sm">
              No chats yet — start a conversation.
            </div>
          )}

          {filtered.map((c, i) => (
            <div
              key={i}
              onClick={() => setActiveChat(c)}
              className={`p-3 rounded-lg cursor-pointer transition-colors text-sm ${
                activeChat === c
                  ? "bg-[#1b1c20]"
                  : "bg-[#121214] hover:bg-[#18181b]"
              }`}
            >
              <div className="truncate font-medium">
                {c.message || "Untitled"}
              </div>
              <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                {(c.reply || "").substring(0, 140)}
              </div>
            </div>
          ))}
        </div>

        <div className="p-3 border-t border-gray-800 flex items-center gap-2">
          <div className="flex-1 text-xs text-gray-400">
            Signed in as{" "}
            <strong className="text-gray-200">
              {user?.email || user?.displayName || "User"}
            </strong>
          </div>
          <button
            onClick={() => auth.signOut()}
            className="text-red-400 hover:text-red-300"
          >
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
            <button
              onClick={() => setShowGstPanel(!showGstPanel)}
              className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2"
            >
              <Calculator size={14} /> GST / Tax Tools
            </button>
            <button
              onClick={() => fetchChats()}
              className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700"
            >
              Refresh
            </button>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-6" ref={scrollRef}>
  {!activeChat ? (
    <div className="text-gray-500 text-center mt-28">
      Pick a chat or start a new one.
    </div>
  ) : (
    <article className="max-w-3xl mx-auto space-y-4">
      {/* Display full conversation history if available */}
      {(activeChat.history || [
        { user: activeChat.message, ai: activeChat.reply },
      ]).map((turn, i) => (
        <div key={i} className="space-y-1">
          <div className="text-right text-blue-400 text-sm">
            {turn.user}
          </div>

          <div className="bg-[#151518] p-6 rounded-lg text-gray-200 whitespace-pre-wrap">
            {turn.ai || "No reply yet."}
          </div>
        </div>
      ))}

      {/* PDF download + Copy actions (kept exactly same) */}
      <div className="flex items-center gap-3 mt-3">
        {activeChat.pdf_url && (
          <a
            href={
              activeChat.pdf_url.startsWith("http")
                ? activeChat.pdf_url
                : `${API_BASE}${activeChat.pdf_url}`
            }
            target="_blank"
            rel="noreferrer"
            className="text-blue-400 hover:underline flex items-center gap-2"
          >
            <FileText size={16} /> Download PDF
          </a>
        )}

        <button
          onClick={() => handleCopy(activeChat.reply)}
          className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2"
        >
          <Copy size={14} /> Copy
        </button>
      </div>
    </article>
  )}
</section>


        <footer className="p-4 border-t border-gray-800 bg-[#0f1012]">
          <div className="max-w-6xl mx-auto flex items-center gap-3">
            <input
              id="file-input"
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={onFileChange}
              className="hidden"
            />
            <label
              htmlFor="file-input"
              className="cursor-pointer px-3 py-2 bg-[#121214] border border-gray-700 rounded flex items-center gap-2 text-sm"
            >
              <Upload size={14} /> {fileName ? fileName : "Choose file"}
            </label>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                task === "contract"
                  ? "Describe the contract you want (parties, duration, rent, deposit, special clauses)..."
                  : "Type your question or paste text here..."
              }
              className="flex-1 bg-[#121214] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 min-h-[64px] resize-none placeholder-gray-500"
            />

            <div className="flex flex-col gap-2">
              <button
                onClick={() => (file ? handleUpload() : sendMessage())}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm"
              >
                {loading
                  ? "Processing..."
                  : file
                  ? task === "summarize"
                    ? "Summarize"
                    : task === "contract"
                    ? "Draft"
                    : "Explain"
                  : "Send"}
              </button>

              <button
                onClick={() => {
                  setMessage("");
                  setFile(null);
                  setFileName("");
                }}
                className="text-xs text-gray-400 underline"
              >
                Clear composer
              </button>
            </div>
          </div>
        </footer>
      </main>

      {/* GST / Tax Tool Panel */}
      {showGstPanel && (
        <div className="fixed bottom-6 right-6 bg-[#111113] border border-gray-700 rounded-xl p-5 w-96 shadow-2xl text-gray-100 z-50 animate-fade-in">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold text-lg flex items-center gap-2">
              <Calculator size={16} /> GST / Tax Tools
            </h3>
            <button
              onClick={() => setShowGstPanel(false)}
              className="text-gray-400 hover:text-gray-200"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-2">
            <input
              type="number"
              placeholder="Enter amount (₹)"
              value={gstAmount}
              onChange={(e) => setGstAmount(e.target.value)}
              className="w-full bg-[#1a1a1d] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            />
            <div className="flex items-center gap-2">
              <select
                value={gstRate}
                onChange={(e) => setGstRate(e.target.value)}
                className="flex-1 bg-[#1a1a1d] border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              >
                <option value="5">5%</option>
                <option value="12">12%</option>
                <option value="18">18%</option>
                <option value="28">28%</option>
              </select>
              <label className="text-xs flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={inclusive}
                  onChange={(e) => setInclusive(e.target.checked)}
                />
                Inclusive
              </label>
              <label className="text-xs flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={interstate}
                  onChange={(e) => setInterstate(e.target.checked)}
                />
                Interstate
              </label>
            </div>

            <button
              onClick={calculateGst}
              className="w-full bg-blue-600 hover:bg-blue-500 rounded py-2 mt-2 text-sm"
            >
              Calculate
            </button>

            {gstResult && (
              <div className="bg-[#1a1a1d] border border-gray-700 rounded p-3 mt-3 text-sm">
                <div>Base Amount: ₹{gstResult.base_amount}</div>
                <div>GST ({gstResult.rate_percent}%): ₹{gstResult.gst_amount}</div>
                {gstResult.igst ? (
                  <div>IGST: ₹{gstResult.igst}</div>
                ) : (
                  <>
                    <div>CGST: ₹{gstResult.cgst}</div>
                    <div>SGST: ₹{gstResult.sgst}</div>
                  </>
                )}
                <div className="mt-2 font-semibold text-blue-400">
                  Total: ₹{gstResult.total_amount}
                </div>
              </div>
            )}

            {/* Tips */}
            {gstTips.length > 0 && (
              <div className="mt-4 border-t border-gray-700 pt-3">
                <div className="text-sm font-semibold mb-1 text-gray-300">
                  GST / Tax Tips:
                </div>
                <ul className="space-y-1 text-xs text-gray-400 max-h-32 overflow-y-auto">
                  {gstTips.map((t, i) => (
                    <li key={i}>• {t.title}: {t.description}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
