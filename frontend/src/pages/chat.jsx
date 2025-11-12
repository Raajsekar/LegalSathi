import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import { signOut } from "firebase/auth";
import { auth } from "../firebase";
import { useAuthState } from "react-firebase-hooks/auth";
import MessageBubble from "../components/bubble";
import TypingDots from "../components/TypingDots";

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
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-gray-900 via-gray-950 to-black text-white transition-all duration-300">
      <header className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-950/80 backdrop-blur-md">
        <h1 className="text-xl font-semibold text-blue-400">⚖️ LegalSathi AI</h1>
        <div className="flex items-center gap-3">
          <img
            src={user?.photoURL}
            alt="User Avatar"
            className="w-8 h-8 rounded-full border border-gray-600"
          />
          <button
            onClick={() => signOut(auth)}
            className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-2">
        {chat.map((msg, i) => (
          <React.Fragment key={i}>
            {msg.userText && <MessageBubble text={msg.userText} isUser />}
            {msg.aiText && <MessageBubble text={msg.aiText} />}
          </React.Fragment>
        ))}
        {loading && <TypingDots />}
        <div ref={chatEndRef} />
      </main>

      <footer className="p-4 border-t border-gray-800 bg-gray-950/80 backdrop-blur-md">
        <div className="flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Ask LegalSathi about a law or contract..."
            className="flex-1 bg-gray-800 p-3 rounded-lg focus:outline-none text-white placeholder-gray-400"
          />
          <button
            onClick={handleSend}
            className="bg-blue-600 hover:bg-blue-700 px-5 py-2 rounded-lg font-semibold shadow-md hover:shadow-blue-500/30 transition-all"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
