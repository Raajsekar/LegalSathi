import React from "react";
import { signInWithPopup } from "firebase/auth";
import { auth, provider } from "../firebase";

export default function Login() {
  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error(error);
      alert("Failed to sign in");
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center bg-cover bg-center"
      style={{
        backgroundImage:
          "url('https://images.unsplash.com/photo-1589578527966-2611b67b2fa4?auto=format&fit=crop&w=1920&q=80')",
      }}
    >
      <div className="bg-black bg-opacity-70 p-10 rounded-3xl text-center shadow-xl max-w-md">
        <h1 className="text-4xl font-bold mb-4 text-white">⚖️ LegalSathi</h1>
        <p className="text-gray-300 mb-6">
          Your trusted AI legal assistant for Indian law.
        </p>
        <button
          onClick={handleLogin}
          className="bg-blue-600 hover:bg-blue-700 px-6 py-3 rounded-lg text-lg text-white font-semibold transition-all"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
