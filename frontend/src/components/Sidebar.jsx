import React from "react";

export default function Sidebar({ chats, setActiveChat, setSearchQuery, fetchChats, user }) {
  return (
    <div className="w-72 border-r border-gray-800 bg-gray-950 flex flex-col">
      <div className="p-4 border-b border-gray-800 flex justify-between items-center">
        <h2 className="text-xl font-bold">Chats</h2>
        <button
          onClick={fetchChats}
          className="text-sm bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded"
        >
          🔄
        </button>
      </div>
      <div className="p-3">
        <input
          type="text"
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search chats..."
          className="w-full p-2 rounded bg-gray-800 text-gray-200 text-sm"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 && (
          <div className="text-gray-500 text-center mt-10">No chats yet</div>
        )}
        {chats.map((c, i) => (
          <div
            key={i}
            onClick={() => setActiveChat(c)}
            className="p-3 hover:bg-gray-800 cursor-pointer border-b border-gray-800"
          >
            <div className="text-sm text-gray-400 truncate">{c.message}</div>
            <div className="text-xs text-gray-600 truncate">{c.reply}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
