import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "../firebase";
import { Plus, LogOut, Upload } from "lucide-react";
import copy from "copy-to-clipboard";
import "./chat.css";

const API_BASE = import.meta.env.VITE_API_BASE;

export default function Chat() {
  const [user] = useAuthState(auth);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [chats, setChats] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (user) fetchChats();
  }, [user]);

  const fetchChats = async () => {
    try {
      const res = await axios.get(`${API_BASE}/api/history/${user.uid}`);
      setChats(res.data || []);
    } catch (e) {
      console.error("Fetch error", e);
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
      const newChat = { message, reply: res.data.reply, timestamp: Date.now() };
      setChats([newChat, ...chats]);
      setMessage("");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

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
      const newChat = { message: `📄 ${file.name}`, reply: res.data.reply };
      setChats([newChat, ...chats]);
      setFile(null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const sendMessageStream = async () => {
  if (!message.trim()) return;
  setLoading(true);

  // ensure a conv exists
  let convId = activeChat?._id || null;

  // optimistic UI: create temporary active chat object
  const tempChat = {
    _id: convId || "temp-" + Math.random().toString(36).slice(2),
    message,
    reply: "",
    timestamp: Date.now() / 1000
  };
  setActiveChat(tempChat);
  setChats([tempChat, ...chats]);
  setMessage("");

  try {
    const res = await fetch(`${API_BASE}/api/stream_chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_id: user.uid,
        conv_id: convId,
        message,
      }),
    });

    if (!res.ok) throw new Error("Stream failed");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let done = false;
    let assistantText = "";

    while (!done) {
      const { value, done: doneReading } = await reader.read();
      done = doneReading;
      if (value) {
        const chunkString = decoder.decode(value, { stream: true });
        // the server yields newline-separated JSON objects. Split carefully.
        const lines = chunkString.split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.chunk) {
              assistantText += obj.chunk;
              // update UI with partial assistant text
              setActiveChat((prev) => ({ ...prev, reply: assistantText }));
              setChats((prev) => {
                const updated = prev.slice();
                updated[0] = { ...updated[0], reply: assistantText }; // head is this chat
                return updated;
              });
            } else if (obj.done) {
              // stream finished; obj.conv_id returned
              convId = obj.conv_id || convId;
              // refresh results/history
              fetchChats();
            }
          } catch (e) {
            console.warn("Stream chunk parse error", e, line);
          }
        }
      }
    }

    setLoading(false);
  } catch (err) {
    console.error("Streaming send error", err);
    alert("Failed to send/stream message");
    setLoading(false);
  }
};

// Example: when user clicks "Edit" on a past message:
const handleEditMessage = (oldMessage) => {
  setMessage(oldMessage);        // put the message into text area
  // Optionally set a flag to replace the message rather than append
  // On send, you can record that this is an edit and append new assistant messages.
};


  return (
    <div className="flex h-screen bg-[#0b0b0d] text-gray-100">
      {/* Sidebar */}
      <div className="w-72 bg-[#101012] border-r border-gray-800 flex flex-col">
        <div className="p-4 border-b border-gray-800 flex justify-between items-center">
          <h2 className="text-lg font-semibold">⚖️ LegalSathi</h2>
          <button
            onClick={() => setChats([])}
            className="hover:text-blue-400 transition-colors"
          >
            <Plus size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {chats.map((c, i) => (
            <div
              key={i}
              className="p-3 bg-[#141417] hover:bg-[#1c1c1f] rounded-lg text-sm cursor-pointer"
            >
              <p className="truncate">{c.message}</p>
            </div>
          ))}
        </div>
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
          {chats.length === 0 ? (
            <div className="text-gray-500 text-center mt-40">
              Start chatting or upload a legal document 📄
            </div>
          ) : (
            chats.map((c, i) => (
              <div key={i}>
                <div className="text-right mb-2 text-blue-400">{c.message}</div>
                <div className="p-4 bg-[#1a1a1d] rounded-xl text-gray-200">
                  {c.reply}
                </div>
              </div>
            ))
          )}
        </div>

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
