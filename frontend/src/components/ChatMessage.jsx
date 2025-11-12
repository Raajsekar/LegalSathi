import React from "react";

function Bubble({ who, text }) {
  const cls = who === "user"
    ? "self-end bg-blue-600 text-white p-3 rounded-lg max-w-[70%] whitespace-pre-wrap"
    : "self-start bg-[#0b1720] text-gray-200 p-3 rounded-lg border border-gray-800 max-w-[70%] whitespace-pre-wrap";
  return <div className={cls}>{text}</div>;
}

export default function ChatMessage({ chat }) {
  if (!chat) return null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-start gap-3">
        <Bubble who="user" text={chat.message} />
        <Bubble who="ai" text={chat.reply} />
      </div>
    </div>
  );
}
