import React from "react";

export default function TypingDots() {
  return (
    <div className="flex items-center space-x-2 mb-4 ml-4">
      <div className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"></div>
      <div
        className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"
        style={{ animationDelay: "0.2s" }}
      ></div>
      <div
        className="w-2.5 h-2.5 bg-gray-400 rounded-full animate-bounce"
        style={{ animationDelay: "0.4s" }}
      ></div>
      <p className="ml-2 text-sm text-gray-400">AI is typing...</p>
    </div>
  );
}
