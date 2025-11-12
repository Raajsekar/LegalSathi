import React, { useState } from "react";
import { auth, provider } from "../firebase";
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [signupMode, setSignupMode] = useState(false);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      alert("Google sign-in failed: " + e.message);
    }
  };

  const emailAuth = async () => {
    try {
      if (signupMode) {
        await createUserWithEmailAndPassword(auth, email, pwd);
      } else {
        await signInWithEmailAndPassword(auth, email, pwd);
      }
    } catch (e) {
      alert("Email auth failed: " + e.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[url('/hero-legal.jpg')] bg-cover bg-center">
      <div className="bg-black/60 p-8 rounded max-w-md w-full">
        <h1 className="text-3xl text-white font-semibold mb-4">⚖️ LegalSathi</h1>
        <p className="text-gray-300 mb-6">AI legal assistant — login to continue</p>

        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full p-3 mb-3 rounded" />
        <input value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="Password" type="password" className="w-full p-3 mb-4 rounded" />

        <div className="flex gap-2">
          <button onClick={emailAuth} className="bg-blue-600 text-white px-4 py-2 rounded">
            {signupMode ? "Sign up" : "Login"}
          </button>
          <button onClick={() => setSignupMode(!signupMode)} className="px-3 py-2 bg-gray-700 rounded text-white">
            {signupMode ? "Have account? Login" : "Create account"}
          </button>
        </div>

        <div className="mt-4">
          <button onClick={loginWithGoogle} className="w-full bg-white text-black py-2 rounded mt-2">Continue with Google</button>
        </div>

        <p className="text-gray-400 text-sm mt-4">By continuing you accept our Terms and Privacy.</p>
      </div>
    </div>
  );
}
