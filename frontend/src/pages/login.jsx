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
      <div className="bg-black bg-opacity-70 p-10 rounded-3xl text-center shadow-2xl max-w-md backdrop-blur-md animate-fadeIn">
        <h1 className="text-4xl font-extrabold mb-3 text-white drop-shadow-md">
          ⚖️ LegalSathi
        </h1>
        <p className="text-gray-300 mb-8">
          Your trusted AI legal assistant for Indian law.
        </p>
        <button
          onClick={handleLogin}
          className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 px-8 py-3 rounded-lg text-lg font-semibold shadow-lg hover:shadow-blue-600/40 transition-all"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
