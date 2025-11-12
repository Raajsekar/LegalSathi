import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import bubble from "../components/bubble";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:10000";

export default function Chat() {
  const [user] = useAuthState(auth);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState([]);
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    if (user) {
      axios.get(`${API_BASE}/api/history/${user.uid}`).then((res) => {
        const formatted = res.data.map((d) => ({
          userText: d.message,
          aiText: d.reply,
        }));
        setChat(formatted.reverse());
      });
    }
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const handleSend = async () => {
    if (!message.trim()) return;
    const userMsg = message;
    setChat((prev) => [...prev, { userText: userMsg }]);
    setMessage("");
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/chat`, {
        user_id: user.uid,
        message: userMsg,
      });
      setChat((prev) => [
        ...prev.slice(0, -1),
        { userText: userMsg, aiText: res.data.reply },
      ]);
    } catch {
      setChat((prev) => [
        ...prev,
        { aiText: "⚠️ Something went wrong. Please try again later." },
      ]);
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 text-white">
      <header className="p-4 border-b border-gray-700 flex justify-between items-center">
        <h1 className="text-xl font-semibold">⚖️ LegalSathi AI Assistant</h1>
        <button
          onClick={() => signOut(auth)}
          className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm"
        >
          Logout
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        {chat.map((msg, i) => (
          <React.Fragment key={i}>
            {msg.userText && <MessageBubble text={msg.userText} isUser />}
            {msg.aiText && <MessageBubble text={msg.aiText} isUser={false} />}
          </React.Fragment>
        ))}
        {loading && (
          <div className="text-gray-400 animate-pulse">AI is typing...</div>
        )}
        <div ref={chatEndRef} />
      </main>

      <footer className="p-4 border-t border-gray-700 bg-gray-900">
        <div className="flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask LegalSathi about a law or upload document..."
            className="flex-1 bg-gray-800 p-3 rounded-lg focus:outline-none"
          />
          <button
            onClick={handleSend}
            className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
