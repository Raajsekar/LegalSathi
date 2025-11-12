import React, { useEffect, useState, useRef } from "react";
import axios from "axios";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import { LogOut, PlusCircle, FileUp, Search, Folder } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE;

export default function Chat() {
  const [user] = useAuthState(auth);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [chats, setChats] = useState([]);
  const [activeChat, setActiveChat] = useState(null);
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  const scrollRef = useRef(null);

  // fetch chats on login
  useEffect(() => { if (user) fetchChats(); }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [activeChat]);

  const fetchChats = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/history/${user.uid}`);
      setChats(res.data || []);
    } catch (e) {
      console.error("Fetch chats error", e);
    }
  };

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
      console.error("Send message error", e);
      alert("Failed to send message");
    }
    setLoading(false);
  };

  const handleUpload = async () => {
    if (!file) return;
    const fd = new FormData();
    fd.append("user_id", user.uid);
    fd.append("task", "summarize");
    fd.append("file", file);
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const newChat = {
        message: `📄 Uploaded: ${file.name}`,
        reply: res.data.reply,
        pdf: res.data.pdf_url,
        timestamp: Date.now(),
      };
      setChats([newChat, ...chats]);
      setActiveChat(newChat);
      setFile(null);
    } catch (e) {
      console.error("Upload error", e);
      alert("Upload failed");
    }
    setLoading(false);
  };

  const filteredChats = chats.filter(
    (c) =>
      c.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.reply?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const Bubble = ({ who, text }) => (
    <div
      className={`p-4 max-w-[75%] whitespace-pre-wrap leading-relaxed rounded-2xl ${
        who === "user"
          ? "self-end bg-blue-600 text-white"
          : "self-start bg-[#1a1a1d] text-gray-200 border border-gray-700"
      }`}
    >
      {text}
    </div>
  );

  return (
    <div className="flex h-screen bg-[#0b0b0d] text-gray-100">
      {/* Sidebar */}
      <aside className="w-72 bg-[#101012] border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800 flex justify-between items-center">
          <h1 className="text-lg font-semibold">⚖️ LegalSathi</h1>
          <button
            onClick={() => {
              setActiveChat(null);
              setReply("");
            }}
            className="hover:text-blue-400"
          >
            <PlusCircle size={20} />
          </button>
        </div>

        <div className="px-3 py-2">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-3 text-gray-400" />
            <input
              placeholder="Search chats"
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-2 bg-[#161618] text-sm rounded-lg border border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-600"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 p-3">
          {filteredChats.map((c, idx) => (
            <button
              key={idx}
              onClick={() => setActiveChat(c)}
              className={`w-full text-left p-3 rounded-lg ${
                activeChat === c ? "bg-[#1f1f23]" : "hover:bg-[#151517]"
              }`}
            >
              <div className="text-sm truncate">{c.message || "Upload summary"}</div>
              <div className="text-xs text-gray-500">
                {new Date(c.timestamp || Date.now()).toLocaleString()}
              </div>
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-gray-800 flex items-center justify-between text-sm">
          <button
            onClick={() => setShowLibrary(!showLibrary)}
            className="flex items-center gap-2 hover:text-blue-400"
          >
            <Folder size={16} /> Library
          </button>
          <button onClick={() => auth.signOut()} className="flex items-center gap-2 hover:text-red-500">
            <LogOut size={16} /> Logout
          </button>
        </div>
      </aside>

      {/* Main Chat Window */}
      <main className="flex flex-col flex-grow">
        <div className="flex-1 overflow-y-auto p-8 space-y-6 flex flex-col" ref={scrollRef}>
          {!activeChat ? (
            <div className="text-center text-gray-400 mt-20">
              {showLibrary
                ? "📂 Your uploaded documents and summaries will appear here."
                : "Start a new chat or upload a document 📄"}
            </div>
          ) : (
            <>
              <Bubble who="user" text={activeChat.message} />
              <Bubble who="ai" text={activeChat.reply} />
            </>
          )}
        </div>

        <div className="border-t border-gray-800 bg-[#0f0f10] p-4">
          <div className="flex items-center justify-between gap-3">
            <textarea
              className="flex-grow bg-[#1a1a1d] border border-gray-700 rounded-xl p-3 resize-none text-white placeholder-gray-400 h-20 focus:ring-1 focus:ring-blue-600 focus:outline-none"
              placeholder="Ask LegalSathi..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
            <div className="flex flex-col gap-2">
              <label className="bg-gray-800 hover:bg-gray-700 cursor-pointer text-xs text-gray-300 py-2 px-3 rounded-lg flex items-center gap-2">
                <FileUp size={14} />
                <input
                  type="file"
                  accept=".pdf,.docx,.txt"
                  onChange={(e) => setFile(e.target.files[0])}
                  className="hidden"
                />
                Upload
              </label>
              <button
                onClick={file ? handleUpload : sendMessage}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 rounded-lg py-2 text-sm"
              >
                {loading ? "Thinking..." : file ? "Summarize" : "Send"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
