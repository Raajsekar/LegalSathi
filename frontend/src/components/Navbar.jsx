import React from "react";

export default function Navbar({ user, onLogin, onLogout }) {
  return (
    <nav className="fixed top-0 w-full bg-black/50 backdrop-blur-md border-b border-gray-800 z-50">
      <div className="max-w-6xl mx-auto px-5 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-bold text-indigo-400">⚖️ LegalSathi</div>
          <div className="hidden md:block text-sm text-gray-400">AI Legal Assistant — India</div>
        </div>
        <div>
          {user ? (
            <div className="flex items-center gap-3">
              <img
                src={user.photoURL}
                alt="avatar"
                className="w-8 h-8 rounded-full ring-2 ring-indigo-400"
              />
              <span className="text-gray-300">{user.displayName}</span>
              <button
                onClick={onLogout}
                className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded-md text-sm text-white transition"
              >
                Logout
              </button>
            </div>
          ) : (
            <button
              onClick={onLogin}
              className="bg-gradient-to-r from-indigo-500 to-purple-600 px-5 py-2 rounded-lg text-white font-medium shadow hover:scale-105 transition-transform"
            >
              Login with Google
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
