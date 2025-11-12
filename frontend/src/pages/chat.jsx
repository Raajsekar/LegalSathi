import React, { useEffect, useState } from "react";
import axios from "axios";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import Sidebar from "../components/Sidebar";
import ChatMessage from "../components/ChatMessage";
import Loader from "../components/Loader";
import { Clipboard, Download, Plus } from "lucide-react";

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
  const [copied, setCopied] = useState(false);

  // Fetch user chats from backend
  useEffect(() => {
    if (user) fetchChats();
  }, [user]);

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
      alert("Failed to send message. Try again later.");
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
      alert("Upload failed. Try again.");
    }
    setLoading(false);
  };

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("Clipboard error", e);
    }
  };

  const handleNewChat = () => {
    setActiveChat(null);
    setMessage("");
    setReply("");
  };

  const filteredChats = chats.filter(
    (c) =>
      c.message?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.reply?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-[#0b1120] text-gray-100">
      {/* Sidebar */}
      <Sidebar
        chats={filteredChats}
        setActiveChat={setActiveChat}
        setSearchQuery={setSearchQuery}
        fetchChats={fetchChats}
        user={user}
        onNewChat={handleNewChat}
      />

      {/* Chat Window */}
      <div className="flex flex-col flex-grow">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 bg-[#0f172a]">
          <h2 className="text-lg font-semibold text-cyan-400">⚖️ LegalSathi</h2>
          <button
            onClick={() => auth.signOut()}
            className="bg-red-600 hover:bg-red-500 px-3 py-1 rounded text-sm"
          >
            Logout
          </button>
        </div>

        {/* Messages Section */}
        <div className="flex-grow overflow-y-auto p-6 space-y-4">
          {activeChat ? (
            <div className="space-y-6">
              <div className="bg-[#13203a] p-4 rounded-lg">
                <div className="font-semibold text-blue-300 mb-2">You:</div>
                <p className="text-gray-100 whitespace-pre-wrap">{activeChat.message}</p>
              </div>

              <div className="bg-[#0d152a] p-4 rounded-lg border border-gray-700 relative">
                <div className="font-semibold text-cyan-300 mb-2">LegalSathi:</div>
                <p className="whitespace-pre-wrap leading-relaxed text-gray-200">
                  {activeChat.reply}
                </p>

                {/* Action buttons */}
                <div className="absolute top-3 right-3 flex gap-2">
                  <button
                    onClick={() => handleCopy(activeChat.reply)}
                    className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded"
                    title="Copy"
                  >
                    <Clipboard size={18} />
                  </button>
                  <a
                    href={activeChat.pdf}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 bg-gray-800 hover:bg-gray-700 rounded"
                    title="Download PDF"
                  >
                    <Download size={18} />
                  </a>
                </div>
              </div>
              {copied && (
                <div className="text-green-400 text-sm animate-pulse">Copied to clipboard!</div>
              )}
            </div>
          ) : (
            <div className="text-gray-500 text-center mt-20">
              Start a conversation or upload a document 📄
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-gray-800 bg-[#0f172a] p-4">
          <textarea
            className="w-full bg-[#0b1120] text-white placeholder-gray-400 border border-gray-700 rounded p-3 resize-none h-24 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:shadow-[0_0_10px_#0ea5a4]"
            placeholder="Ask LegalSathi to draft an agreement, summarize a legal case, or explain Indian laws..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center justify-between mt-3">
            <div className="flex items-center gap-3">
              <input
                type="file"
                accept=".pdf,.docx,.txt"
                onChange={(e) => setFile(e.target.files[0])}
                className="text-sm text-gray-400"
              />
              <button
                onClick={handleUpload}
                className="bg-green-600 hover:bg-green-500 px-3 py-1 rounded text-sm"
              >
                Upload & Summarize
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleNewChat}
                className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded flex items-center gap-1 text-sm"
              >
                <Plus size={16} /> New Chat
              </button>
              <button
                onClick={sendMessage}
                disabled={loading}
                className="bg-cyan-600 hover:bg-cyan-500 px-5 py-2 rounded text-white transition"
              >
                {loading ? "Thinking..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
