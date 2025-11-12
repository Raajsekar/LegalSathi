import React from "react";

export default function Navbar({ user, onLogin, onLogout }) {
  return (
    <nav className="bg-white shadow">
      <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="text-2xl font-bold">⚖️ LegalSathi</div>
          <div className="text-sm text-gray-500">AI legal assistant — India</div>
        </div>

        <div>
          {user ? (
            <div className="flex items-center gap-3">
              <img src={user.photoURL} alt="avatar" className="w-8 h-8 rounded-full" />
              <span className="mr-2">{user.displayName}</span>
              <button onClick={onLogout} className="bg-red-500 text-white px-3 py-1 rounded">Logout</button>
            </div>
          ) : (
            <button onClick={onLogin} className="bg-blue-600 text-white px-3 py-1 rounded">Login with Google</button>
          )}
        </div>
      </div>
    </nav>
  );
}
