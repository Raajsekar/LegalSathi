import React from "react";

export default function ChatMessage({ chat }) {
  const copyText = () => {
    navigator.clipboard.writeText(chat.reply);
    alert("Copied to clipboard!");
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-gray-800 p-4 rounded-md shadow">
        <div className="font-semibold text-blue-400">You:</div>
        <div>{chat.message}</div>
      </div>
      <div className="bg-gray-700 p-4 rounded-md shadow relative">
        <div className="font-semibold text-green-400">LegalSathi:</div>
        <div className="whitespace-pre-wrap">{chat.reply}</div>
        <button
          onClick={copyText}
          className="absolute top-2 right-2 bg-gray-600 hover:bg-gray-500 px-2 py-1 rounded text-sm"
        >
          Copy
        </button>
      </div>
    </div>
  );
}
