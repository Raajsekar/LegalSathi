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
      axios.get(`${API_BASE}/api/history/${user.uid}`).then((r) => {
        setHistory(r.data || []);
      }).catch(err => {
        console.error("History error", err);
      });
    }
  }, [user]);

  const login = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      alert("Login failed");
    }
  };

  const logout = async () => {
    await signOut(auth);
    setHistory([]);
    setReply("");
  };

  const send = async () => {
    if (!user) return alert("Please login");
    if (!message.trim()) return alert("Type something");

    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/api/chat`, {
        user_id: user.uid,
        message,
      });
      setReply(res.data.reply);
      setMessage("");
      // update history locally
      setHistory(prev => [{ message, reply: res.data.reply, timestamp: Date.now()/1000, _id: Math.random().toString(36).slice(2) }, ...prev]);
    } catch (e) {
      console.error(e);
      alert("Error calling API");
    }
    setLoading(false);
  };

  const uploadFile = async () => {
    if (!user) return alert("Please login");
    if (!file) return alert("Choose a file");
    setLoading(true);
    const fd = new FormData();
    fd.append("user_id", user.uid);
    fd.append("task", "summarize");
    fd.append("file", file);
    try {
      const res = await axios.post(`${API_BASE}/api/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setReply(res.data.reply);
      setHistory(prev => [{ message: `Uploaded: ${file.name}`, reply: res.data.reply, timestamp: Date.now()/1000, _id: Math.random().toString(36).slice(2) }, ...prev]);
    } catch (e) {
      console.error(e);
      alert("Upload failed");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar user={user} onLogin={login} onLogout={logout} />
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-3xl font-bold mb-4">⚖️ LegalSathi — AI Legal Assistant</h1>

        <div className="bg-white p-4 rounded shadow">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type a question: 'Draft a rent agreement between A and B for 6 months' or paste clauses..."
            className="w-full p-3 border rounded h-28"
          />
          <div className="flex gap-2 mt-3">
            <button onClick={send} className="bg-blue-600 text-white px-4 py-2 rounded">Ask AI</button>
            <input type="file" onChange={(e) => setFile(e.target.files[0])} />
            <button onClick={uploadFile} className="bg-green-600 text-white px-4 py-2 rounded">Upload & Summarize</button>
            {loading && <div className="text-gray-600 ml-3">Processing...</div>}
          </div>
        </div>

        {reply && (
          <div className="mt-6 bg-white p-4 rounded shadow whitespace-pre-wrap">
            <h2 className="font-semibold mb-2">🧠 AI Reply</h2>
            <div>{reply}</div>
          </div>
        )}

        <section className="mt-6">
          <h3 className="text-xl font-semibold mb-2">Recent Activity</h3>
          <div className="space-y-3">
            {history.length === 0 && <div className="text-gray-600">No recent activity — login and try a query.</div>}
            {history.map((h) => (
              <div key={h._id} className="bg-white p-3 rounded shadow">
                <div className="text-sm text-gray-500">{new Date(h.timestamp * 1000).toLocaleString()}</div>
                <div className="mt-1"><strong>Q:</strong> {h.message}</div>
                <div className="mt-1"><strong>A:</strong> {h.reply?.slice(0, 400)}{h.reply && h.reply.length > 400 ? "..." : ""}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
