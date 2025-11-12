import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import { Plus, LogOut, Upload, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import copy from "copy-to-clipboard";
import "./chat.css";

const API_BASE = import.meta.env.VITE_API_BASE;

export default function Chat() {
  const [user] = useAuthState(auth);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const scrollRef = useRef(null);

  // 🔹 Load chat history
  useEffect(() => {
    if (user) fetchChats();
  }, [user]);

  // 🔹 Auto-scroll to bottom on new chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chats]);

  // 🔹 Fetch all chat history
  const fetchChats = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/history/${user.uid}`);
      setChats(res.data || []);
    } catch (e) {
      console.error("Fetch error", e);
    }
  };

  // 🔹 Send a message
  const sendMessage = async () => {
    if (!message.trim()) return;
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/chat`, {
        user_id: user.uid,
        message,
      });
      const newChat = {
        message,
        reply: res.data.reply,
        pdf: res.data.pdf_url,
        timestamp: Date.now(),
      };
      setChats([newChat, ...chats]);
      setActiveChat(newChat);
      setMessage("");
    } catch (e) {
      console.error(e);
      alert("Failed to send message");
    } finally {
      setLoading(false);
    }
  };

  // 🔹 Upload and summarize file
  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    const fd = new FormData();
    fd.append("user_id", user.uid);
    fd.append("file", file);
    fd.append("task", "summarize");
    try {
      const res = await axios.post(`${API_BASE}/api/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const newChat = {
        message: `📄 ${file.name}`,
        reply: res.data.reply,
        pdf: res.data.pdf_url,
        timestamp: Date.now(),
      };
      setChats([newChat, ...chats]);
      setFile(null);
      setActiveChat(newChat);
    } catch (e) {
      console.error(e);
      alert("Upload failed");
    } finally {
      setLoading(false);
    }
  };

  // 🔹 Copy AI reply
  const handleCopy = (text) => {
    copy(text || "");
    alert("Copied to clipboard ✅");
  };

  return (
    <div className="flex h-screen bg-[#0b0b0d] text-gray-100">
      {/* Sidebar */}
      <div className="w-72 bg-[#101012] border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800 flex justify-between items-center">
          <h2 className="text-lg font-semibold">⚖️ LegalSathi</h2>
          <button
            onClick={() => {
              setChats([]);
              setActiveChat(null);
            }}
            className="hover:text-blue-400 transition-colors"
          >
            <Plus size={20} />
          </button>
        </div>

        {/* Chat history list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {chats.length === 0 && (
            <div className="text-gray-500 text-sm px-2">No chats yet.</div>
          )}
          {chats.map((c, i) => (
            <div
              key={i}
              onClick={() => setActiveChat(c)}
              className={`p-3 rounded-lg text-sm cursor-pointer ${
                activeChat === c
                  ? "bg-[#1f1f23]"
                  : "bg-[#141417] hover:bg-[#1c1c1f]"
              }`}
            >
              <p className="truncate">{c.message}</p>
            </div>
          ))}
        </div>

        {/* Logout */}
        <div className="p-4 border-t border-gray-800">
          <button
            onClick={() => auth.signOut()}
            className="flex items-center justify-center w-full gap-2 text-red-400 hover:text-red-300 transition-colors"
          >
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-6 space-y-4" ref={scrollRef}>
          {!activeChat ? (
            <div className="text-gray-500 text-center mt-40">
              Start chatting or upload a legal document 📄
            </div>
          ) : (
            <div>
              <div className="text-right mb-2 text-blue-400 font-medium">
                {activeChat.message}
              </div>
              <div className="p-4 bg-[#1a1a1d] rounded-xl text-gray-200 prose prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {activeChat.reply || "No reply yet"}
                </ReactMarkdown>

                {activeChat.pdf && (
                  <a
                    href={`${API_BASE}${activeChat.pdf}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline text-sm mt-2 inline-block"
                  >
                    📄 Download PDF
                  </a>
                )}
                <button
                  onClick={() => handleCopy(activeChat.reply)}
                  className="block text-xs text-gray-400 hover:text-gray-200 mt-3"
                >
                  <Copy size={14} className="inline mr-1" /> Copy Response
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-gray-800 bg-[#101012]">
          <div className="flex items-center gap-2">
            <input
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={(e) => setFile(e.target.files[0])}
              className="hidden"
              id="upload"
            />
            <label
              htmlFor="upload"
              className="cursor-pointer px-3 py-2 bg-[#1a1a1d] border border-gray-700 rounded-lg text-sm hover:bg-[#232326] flex items-center gap-2"
            >
              <Upload size={14} /> Upload
            </label>

            <textarea
              className="flex-1 bg-[#1a1a1d] border border-gray-700 rounded-lg px-3 py-2 resize-none text-gray-100 placeholder-gray-500 focus:ring-1 focus:ring-blue-600 outline-none"
              placeholder="Ask LegalSathi..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />

            <button
              onClick={file ? handleUpload : sendMessage}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg"
            >
              {loading ? "Thinking..." : file ? "Summarize" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
