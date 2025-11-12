import React, { useEffect, useState } from "react";
import axios from "axios";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import Sidebar from "../components/Sidebar";
import ChatMessage from "../components/ChatMessage";
import Loader from "../components/Loader";

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
      setReply(res.data.reply);
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
      setReply(res.data.reply);
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

  return (
    <div className="flex h-screen bg-gray-900 text-white">
      <Sidebar
        chats={filteredChats}
        setActiveChat={setActiveChat}
        setSearchQuery={setSearchQuery}
        fetchChats={fetchChats}
        user={user}
      />
      <div className="flex flex-col flex-grow">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
          <h2 className="text-lg font-semibold">⚖️ LegalSathi</h2>
          <button
            onClick={() => auth.signOut()}
            className="bg-red-600 hover:bg-red-500 px-3 py-1 rounded text-sm"
          >
            Logout
          </button>
        </div>

        <div className="flex-grow overflow-y-auto p-6 space-y-4">
          {activeChat ? (
            <ChatMessage chat={activeChat} />
          ) : (
            <div className="text-gray-400 text-center mt-20">
              Start a conversation or upload a file 📄
            </div>
          )}
        </div>

        <div className="border-t border-gray-700 bg-gray-800 p-4">
          <textarea
            className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-white resize-none h-24"
            placeholder="Ask LegalSathi..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-2">
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
            <button
              onClick={sendMessage}
              disabled={loading}
              className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded"
            >
              {loading ? "Thinking..." : "Send"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
