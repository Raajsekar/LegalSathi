import React, { useState } from "react";

export default function Sidebar({ chats = [], setActiveChat, setSearchQuery, fetchChats, user }) {
  const [qOpen, setQOpen] = useState(false);

  return (
    <aside className="w-80 bg-[#0f1316] border-r border-gray-800 flex flex-col">
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">⚖️ LegalSathi</div>
            <div className="text-xs text-gray-400">{user?.email}</div>
          </div>
        </div>

        <div className="mt-3">
          <button onClick={() => {
            setActiveChat(null);
            fetchChats();
          }} className="w-full text-left bg-[#06121a] px-3 py-2 rounded text-sm">+ New Chat</button>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input onFocus={()=>setQOpen(true)} onBlur={()=>setTimeout(()=>setQOpen(false),150)}
            onChange={(e)=>setSearchQuery(e.target.value)} placeholder="Search chats" className="w-full p-2 bg-[#06121a] border border-gray-700 rounded text-sm" />
        </div>
      </div>

      <div className="p-3 overflow-y-auto flex-1 space-y-2">
        {chats.length === 0 && <div className="text-sm text-gray-500">No chats yet</div>}
        {chats.map((c, idx) => (
          <button key={c._id || idx} onClick={() => setActiveChat(c)}
            className="w-full text-left p-3 bg-[#071018] hover:bg-[#0b1418] rounded">
            <div className="text-sm text-gray-200 truncate">{c.message?.slice(0, 60) || "Upload / Summary"}</div>
            <div className="text-xs text-gray-500 mt-1">{new Date((c.timestamp||Date.now())*1000).toLocaleString()}</div>
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-gray-800">
        <div className="text-xs text-gray-500 mb-1">Account</div>
        <div className="text-sm text-gray-200">{user?.displayName || user?.email}</div>
      </div>
    </aside>
  );
}
