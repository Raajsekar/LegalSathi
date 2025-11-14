// src/components/Chat.jsx
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
  const [conversations, setConversations] = useState([]); // sidebar list
  const [activeConv, setActiveConv] = useState(null); // { _id, title, last_message, messages: [...] }
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredChatId, setHoveredChatId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
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
  const interimRef = useRef("");

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
        setMessage((prevBase) => {
          const base = prevBase.replace(/¶INTERIM:.*$/, "");
          if (final) {
            return (base ? base + " " : "") + final;
          }
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

  // -------- Backend interactions --------
  const fetchConversations = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/conversations/${user.uid}`);
      const convs = res.data || [];
      setConversations(convs);
      if (convs.length > 0) {
        // if there's a previously selected conversation, try to keep it selected
        if (!activeConv) {
          loadConversation(convs[0]);
        } else {
          const found = convs.find((c) => c._id === activeConv._id);
          if (found) {
            // keep active, but update title/last_message
            setActiveConv((prev) => ({ ...prev, ...found }));
          } else {
            loadConversation(convs[0]);
          }
        }
      } else {
        setActiveConv(null);
      }
    } catch (e) {
      console.error("Fetch conversations error", e);
    }
  };

  const loadConversation = async (conv) => {
    try {
      // If conv already has messages loaded and it's the same id, use it
      if (activeConv && activeConv._id === conv._id && activeConv.messages) {
        setActiveConv(activeConv);
        return;
      }
      const res = await axios.get(`${API_BASE}/api/conversation/${conv._id}`);
      const msgs = res.data || [];
      setActiveConv({ ...conv, messages: msgs });
    } catch (e) {
      console.error("Load conversation error", e);
      // still set conv as active with empty messages to allow sending (optimistic)
      setActiveConv({ ...conv, messages: activeConv?.messages || [] });
    }
  };

  // safe upsert for sidebar conversations and activeConv
  const upsertConversation = (conv) => {
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c._id === conv._id);
      if (idx !== -1) {
        const copy = prev.slice();
        copy[idx] = { ...copy[idx], ...conv };
        const moved = copy.splice(idx, 1)[0];
        return [moved, ...copy];
      }
      return [conv, ...prev];
    });
  };

  const stopGenerating = () => {
    try {
      if (abortControllerRef.current) abortControllerRef.current.abort();
    } catch (e) {
      console.warn("Abort error", e);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  };

  // ---------- Send message (stream) ----------
  const sendMessage = async () => {
    const cleanMessage = message.replace(/¶INTERIM:.*$/, "").trim();
    if (!cleanMessage) return alert("Please type a question or prompt.");
    setLoading(true);

    // determine conv id: if activeConv exists and has real _id use it, else null (backend will create)
    const existingConvId = activeConv && activeConv._id && !String(activeConv._id).startsWith("placeholder") ? activeConv._id : null;
    const localConvId = existingConvId || `local-${Date.now()}`;

    // update activeConv/messages optimistically
    const userMsg = { role: "user", content: cleanMessage, timestamp: Date.now() / 1000, _id: `m-${Date.now()}` };

    if (!activeConv || (activeConv && activeConv._id !== localConvId)) {
      // create placeholder activeConv when no active conversation
      const placeholder = {
        _id: localConvId,
        title: cleanMessage.substring(0, 40) || "Conversation",
        last_message: cleanMessage,
        messages: [userMsg],
      };
      setActiveConv(placeholder);
      upsertConversation({ _id: placeholder._id, title: placeholder.title, last_message: placeholder.last_message });
    } else {
      // append to existing activeConv messages
      setActiveConv((prev) => {
        const msgs = prev.messages ? prev.messages.concat([userMsg]) : [userMsg];
        return { ...prev, messages: msgs, last_message: cleanMessage };
      });
      upsertConversation({ _id: localConvId, last_message: cleanMessage });
    }

    setMessage("");

    // start streaming
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const payload = {
      user_id: user.uid,
      conv_id: existingConvId || null,
      message: cleanMessage,
    };

    try {
      const streamRes = await fetch(`${API_BASE}/api/stream_chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!streamRes.ok) {
        throw new Error(`Stream unavailable: ${streamRes.status}`);
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let accumulated = "";

      // create placeholder assistant message (empty) and keep its temp id
      let assistantTempId = `am-${Date.now()}`;
      // append placeholder assistant turn if not present
      setActiveConv((prev) => {
        const msgs = prev.messages ? prev.messages.slice() : [];
        // if last message already userMsg we push assistant placeholder
        msgs.push({ role: "assistant", content: "", timestamp: Date.now() / 1000, _id: assistantTempId });
        return { ...prev, messages: msgs };
      });

      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const obj = JSON.parse(line);
              if (obj.chunk) {
                accumulated += obj.chunk;

                // update assistant placeholder content
                setActiveConv((prev) => {
                  if (!prev) return prev;
                  const msgs = prev.messages ? prev.messages.slice() : [];
                  const idx = msgs.findIndex((m) => m._id === assistantTempId);
                  if (idx !== -1) {
                    msgs[idx] = { ...msgs[idx], content: accumulated };
                  } else {
                    // fallback: push
                    msgs.push({ role: "assistant", content: accumulated, timestamp: Date.now() / 1000, _id: assistantTempId });
                  }
                  // also update last_message preview
                  upsertConversation({ _id: prev._id, last_message: accumulated, title: (accumulated || prev.title).substring(0, 80) });
                  return { ...prev, messages: msgs, last_message: accumulated };
                });

              } else if (obj.done) {
                const convIdFromServer = obj.conv_id || existingConvId || localConvId;

                // move/replace local conversation id with server conv id
                // update sidebar and activeConv
                setConversations((prev) => {
                  // remove any local entry with localConvId or placeholder and replace
                  const withoutLocal = prev.filter((p) => p._id !== localConvId);
                  // insert/merge server conv
                  const found = prev.find((p) => p._id === convIdFromServer);
                  const newEntry = {
                    _id: convIdFromServer,
                    title: accumulated ? accumulated.substring(0, 80) : (found?.title || cleanMessage.substring(0, 40)),
                    last_message: accumulated || cleanMessage,
                    updated_at: Date.now() / 1000
                  };
                  return [newEntry, ...withoutLocal.filter((p) => p._id !== convIdFromServer)];
                });

                setActiveConv((prev) => {
                  if (!prev) return prev;
                  return { ...prev, _id: convIdFromServer, last_message: accumulated };
                });

                // break out: done handled after the loop naturally
              }
            } catch (e) {
              // not JSON — append raw chunk
              accumulated += line;
              setActiveConv((prev) => {
                if (!prev) return prev;
                const msgs = prev.messages ? prev.messages.slice() : [];
                const idx = msgs.findIndex((m) => m._id === assistantTempId);
                if (idx !== -1) msgs[idx] = { ...msgs[idx], content: accumulated };
                return { ...prev, messages: msgs, last_message: accumulated };
              });
            }
          }
        }
      }

      setLoading(false);
      abortControllerRef.current = null;
    } catch (err) {
      if (err.name === "AbortError") {
        console.log("Stream aborted by user.");
        setLoading(false);
        abortControllerRef.current = null;
        return;
      }

      // fallback to non-streaming endpoint (if you have /api/chat) or local ask
      try {
        const res = await axios.post(`${API_BASE}/api/chat`, {
          user_id: user.uid,
          message: task === "contract" ? `Draft a contract:\n\n${cleanMessage}` : cleanMessage,
          conv_id: existingConvId || null,
        });

        const aiReply = res.data.reply;
        const convId = res.data.conv_id || res.data._id || existingConvId || localConvId;
        const pdf_url = res.data.pdf_url || null;

        // update active conv and sidebar
        setActiveConv((prev) => {
          const msgs = prev.messages ? prev.messages.concat([{ role: "assistant", content: aiReply, timestamp: Date.now() / 1000, _id: `am-${Date.now()}` }]) : [{ role: "assistant", content: aiReply, timestamp: Date.now() / 1000, _id: `am-${Date.now()}` }];
          return { ...prev, _id: convId, last_message: aiReply, messages: msgs, pdf_url };
        });

        upsertConversation({ _id: convId, last_message: aiReply, title: (aiReply || cleanMessage).substring(0, 80) });
      } catch (e) {
        console.error("Send error (both stream & fallback):", e);
        alert("Failed to send message — try again.");
      } finally {
        setLoading(false);
        abortControllerRef.current = null;
      }
    }
  };

  // regenerate last user prompt
  const regenerateLast = async (conv) => {
    if (!conv) return;
    const msgs = conv.messages || [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const text = lastUser?.content;
    if (!text) return alert("No user message to regenerate.");
    setMessage(text);
    setTimeout(() => sendMessage(), 120);
  };

  // upload file
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
      const pdf_url = res.data.pdf_url || null;
      // new conv entry
      const newEntry = {
        _id: `local-${Date.now()}`,
        title: `File: ${file.name}`,
        last_message: aiReply,
        messages: [{ role: "assistant", content: aiReply, timestamp: Date.now() / 1000 }]
      };
      upsertConversation(newEntry);
      setActiveConv(newEntry);
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
      _id: `placeholder-${Date.now()}`,
      title: "New conversation",
      last_message: "",
      messages: []
    };
    setConversations((prev) => [placeholder, ...prev]);
    setActiveConv(placeholder);
  };

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
      setTimeout(() => setListening(false), 140);
    } catch (e) {
      console.warn("Stop recording error", e);
    }
  };

  // Filtered conversations for Sidebar search
  const filtered = conversations.filter(
    (c) =>
      (c.title && c.title.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.last_message && c.last_message.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const deleteConversation = async (id) => {
    try {
      await axios.delete(`${API_BASE}/api/conversation/${id}`);
      setConversations((prev) => prev.filter((c) => c._id !== id));
      if (activeConv?._id === id) setActiveConv(null);
    } catch (e) {
      console.error("Delete error", e);
      alert("Delete failed");
    }
  };

  // compute lastAi for control bar
  const lastAi = (() => {
    if (!activeConv) return "";
    const msgs = activeConv.messages || [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    return lastAssistant?.content?.trim() || "";
  })();

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
                activeConv?._id === c._id ? "bg-[#1b1c20]" : "bg-[#121214] hover:bg-[#18181b]"
              }`}
              onMouseEnter={() => setHoveredChatId(c._id)}
              onMouseLeave={() => { setHoveredChatId((id) => (id === c._id ? null : id)); setOpenMenuId(null); }}
              onClick={() => loadConversation(c)}
            >
              <div className="flex-1">
                <div className="truncate font-medium">
                  {c.title || "Untitled"}
                </div>
                <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                  {c.last_message || ""}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === c._id ? null : c._id); }}
                    className={`px-2 py-1 rounded hover:bg-gray-800 ${hoveredChatId === c._id || openMenuId === c._id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                    title="Options"
                  >
                    <span className="inline-block w-1 h-1 rounded-full bg-gray-300 mr-0.5"></span>
                    <span className="inline-block w-1 h-1 rounded-full bg-gray-300 mr-0.5"></span>
                    <span className="inline-block w-1 h-1 rounded-full bg-gray-300"></span>
                  </button>

                  {openMenuId === c._id && (
                    <div className="absolute right-0 top-full mt-1 w-40 bg-[#0f1012] border border-gray-700 rounded shadow-lg z-40 text-sm">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); alert('Rename - not implemented yet'); }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-800"
                      >Rename</button>

                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); alert('Share - not implemented yet'); }}
                        className="w-full text-left px-3 py-2 hover:bg-gray-800"
                      >Share</button>

                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          setOpenMenuId(null);
                          if (!confirm("Delete this chat permanently?")) return;
                          try {
                            await deleteConversation(c._id);
                          } catch (err) {
                            console.error(err);
                            alert("Delete failed");
                          }
                        }}
                        className="w-full text-left px-3 py-2 text-red-400 hover:bg-gray-800"
                      >Delete</button>
                    </div>
                  )}
                </div>
              </div>
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
            <button onClick={() => fetchConversations()} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700">Refresh</button>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto p-6 chat-content" ref={scrollRef}>
          {!activeConv ? (
            <div className="text-gray-500 text-center mt-28">Pick a chat or start a new one.</div>
          ) : (
            <article className="max-w-3xl mx-auto space-y-4">
              {activeConv.messages?.map((m, i) => (
                <div key={m._id || i} className="space-y-1">
                  {m.role === "user" && (
                    <div className="text-right text-blue-400 text-sm">{m.content}</div>
                  )}
                  {m.role === "assistant" && (
                    <div className="bg-[#151518] p-6 rounded-lg text-gray-200 whitespace-pre-wrap reply-box">
                      {m.content}
                    </div>
                  )}
                </div>
              ))}

              { lastAi ? (
                <div className="flex items-center gap-3 mt-3">
                  {activeConv.pdf_url && (
                    <a
                      href={activeConv.pdf_url.startsWith("http") ? activeConv.pdf_url : `${API_BASE}${activeConv.pdf_url}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 hover:underline flex items-center gap-2"
                    >
                      <FileText size={16} /> Download PDF
                    </a>
                  )}

                  <button onClick={() => handleCopy(lastAi)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2">
                    <Copy size={14} /> Copy
                  </button>

                  <button onClick={() => regenerateLast(activeConv)} className="text-sm px-3 py-1 rounded bg-[#121214] border border-gray-700 flex items-center gap-2">
                    <RotateCw size={14} /> Regenerate
                  </button>

                  {loading && (
                    <button onClick={stopGenerating} className="text-sm px-3 py-1 rounded bg-[#7f1d1d] hover:bg-[#9b1f1f] border border-gray-700 flex items-center gap-2">
                      <Square size={14} /> Stop
                    </button>
                  )}
                </div>
              ) : null }
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
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (file) handleUpload();
                    else sendMessage();
                  }
                }}
                placeholder={task === "contract" ? "Describe the contract you want (parties, duration, rent, deposit, special clauses)..." : "Type your question or paste text here..."}
                className="composer-textarea"
                rows={2}
              />

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
