import React, { useState, useEffect } from "react";
import axios from "axios";
import { auth, provider } from "./firebase";
import { signInWithPopup, signOut } from "firebase/auth";
import { useAuthState } from "react-firebase-hooks/auth";
import Navbar from "./components/Navbar";

const API_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:10000";

export default function App() {
  const [user] = useAuthState(auth);
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState("");
  const [file, setFile] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) {
      axios.get(`${API_BASE}/api/history/${user.uid}`)
        .then(r => setHistory(r.data || []))
        .catch(() => {});
    }
  }, [user]);

  const login = async () => await signInWithPopup(auth, provider);
  const logout = async () => await signOut(auth);

  const send = async () => {
    if (!user || !message.trim()) return alert("Please login and type a query");
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/chat`, {
        user_id: user.uid,
        message,
      });
      setReply(res.data.reply);
      setHistory([{ message, reply: res.data.reply, timestamp: Date.now()/1000 }, ...history]);
    } catch {
      setReply("⚠️ Something went wrong.");
    }
    setLoading(false);
  };

  const uploadFile = async () => {
    if (!user || !file) return alert("Please login and upload a file");
    setLoading(true);
    const fd = new FormData();
    fd.append("user_id", user.uid);
    fd.append("task", "summarize");
    fd.append("file", file);
    try {
      const res = await axios.post(`${API_BASE}/api/upload`, fd);
      setReply(res.data.reply);
      setHistory([{ message: `📎 ${file.name}`, reply: res.data.reply, timestamp: Date.now()/1000 }, ...history]);
    } catch {
      setReply("⚠️ Upload failed.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0D] text-gray-100">
      <Navbar user={user} onLogin={login} onLogout={logout} />

      <main className="flex-grow pt-24 px-6 max-w-5xl mx-auto w-full">
        {/* Hero Section */}
        <div className="text-center mb-10">
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-600">
            Your AI-Powered Legal Partner
          </h1>
          <p className="mt-3 text-gray-400 text-lg">Summarize, draft, or explain legal documents instantly.</p>
        </div>

        {/* Input Area */}
        <div className="bg-black/40 backdrop-blur-md rounded-2xl p-6 border border-gray-700 shadow-xl">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a legal query or contract request..."
            className="w-full p-3 rounded-lg bg-black/40 text-gray-200 border border-gray-600 focus:ring-2 focus:ring-indigo-500 h-32 resize-none"
          />
          <div className="flex flex-wrap gap-3 mt-3 items-center">
            <button onClick={send} className="bg-indigo-600 hover:bg-indigo-700 px-5 py-2 rounded-lg text-white font-medium shadow-md">Ask AI</button>
            <input type="file" onChange={(e) => setFile(e.target.files[0])} className="text-sm text-gray-400" />
            <button onClick={uploadFile} className="bg-green-600 hover:bg-green-700 px-5 py-2 rounded-lg text-white font-medium shadow-md">Upload & Summarize</button>
            {loading && <div className="ml-2 text-indigo-400 animate-pulse">🤖 Thinking...</div>}
          </div>
        </div>

        {/* Response Section */}
        {reply && (
          <div className="mt-8 bg-gradient-to-b from-[#111111] to-[#1A1A1A] p-6 rounded-xl border border-gray-700 shadow-lg whitespace-pre-wrap">
            <h2 className="font-semibold text-indigo-400 mb-3">🧠 AI Response</h2>
            <div className="animate-fadeIn">{reply}</div>
          </div>
        )}

        {/* History Section */}
        <section className="mt-10">
          <h3 className="text-xl font-semibold text-gray-400 mb-3">📜 Recent Activity</h3>
          <div className="space-y-3">
            {history.map((h, i) => (
              <div key={i} className="bg-black/40 p-4 rounded-lg border border-gray-700">
                <div className="text-xs text-gray-500 mb-1">{new Date(h.timestamp * 1000).toLocaleString()}</div>
                <div><span className="text-indigo-400 font-semibold">Q:</span> {h.message}</div>
                <div className="mt-1"><span className="text-green-400 font-semibold">A:</span> {h.reply.slice(0, 300)}...</div>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-12 text-center text-gray-500 py-4 border-t border-gray-800">
        <p>Made with ⚖️ by <span className="text-indigo-400">LegalSathi</span> | © {new Date().getFullYear()}</p>
        <p className="text-sm mt-1">
          <a href="https://github.com/Raajsekar/LegalSathi" target="_blank" className="hover:text-indigo-400">GitHub</a> · 
          <a href="mailto:contact@legalsathi.in" className="hover:text-indigo-400 ml-2">Contact</a>
        </p>
      </footer>
    </div>
  );
}
