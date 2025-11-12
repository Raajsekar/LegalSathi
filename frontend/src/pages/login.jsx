import React, { useState } from "react";
import { auth, provider } from "../firebase";
import {
  signInWithPopup,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from "firebase/auth";

export default function Login() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const validatePassword = (pw) => {
    if (pw.length < 8) return "Password must be at least 8 characters long.";
    if (!/[A-Z]/.test(pw)) return "Include at least one uppercase letter.";
    if (!/[0-9]/.test(pw)) return "Include at least one number.";
    return null;
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      setError("⚠️ Google sign-in failed. Check Firebase domain settings.");
    } finally {
      setLoading(false);
    }
  };

  const handleSignup = async () => {
    setError("");
    const pwErr = validatePassword(password);
    if (pwErr) return setError(pwErr);
    try {
      setLoading(true);
      const userCred = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(userCred.user, { displayName: name });
      await sendEmailVerification(userCred.user);
      setError("✅ Verification email sent. Please verify to log in.");
    } catch (err) {
      if (err.code === "auth/email-already-in-use") setError("Email already in use.");
      else setError("Signup failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    setError("");
    try {
      setLoading(true);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      if (err.code === "auth/invalid-credential") setError("Invalid email or password.");
      else setError("Login failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0b0d] flex flex-col items-center justify-center text-gray-100">
      <div className="bg-[#121214]/90 backdrop-blur-lg border border-gray-800 rounded-2xl shadow-xl w-[400px] p-8">
        <h1 className="text-3xl font-semibold text-center mb-2">⚖️ LegalSathi</h1>
        <p className="text-gray-400 text-center mb-6">AI Legal Assistant — Sign in to continue</p>

        {mode === "signup" && (
          <input
            type="text"
            placeholder="Full name"
            className="w-full mb-3 bg-[#1a1a1d] text-gray-100 placeholder-gray-400 border border-gray-700 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-600 outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}

        <input
          type="email"
          placeholder="Email"
          className="w-full mb-3 bg-[#1a1a1d] text-gray-100 placeholder-gray-400 border border-gray-700 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-600 outline-none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          placeholder="Password"
          className="w-full mb-3 bg-[#1a1a1d] text-gray-100 placeholder-gray-400 border border-gray-700 rounded-lg px-3 py-2 focus:ring-1 focus:ring-blue-600 outline-none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

        {mode === "login" ? (
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 py-2 rounded-lg mb-3"
          >
            {loading ? "Logging in..." : "Login"}
          </button>
        ) : (
          <button
            onClick={handleSignup}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 py-2 rounded-lg mb-3"
          >
            {loading ? "Creating..." : "Create account"}
          </button>
        )}

        <button
          onClick={handleGoogleLogin}
          className="w-full bg-white text-black hover:bg-gray-100 py-2 rounded-lg font-medium"
        >
          Continue with Google
        </button>

        <p className="text-gray-400 text-center mt-4 text-sm">
          {mode === "login" ? (
            <>
              Don’t have an account?{" "}
              <span
                onClick={() => {
                  setMode("signup");
                  setError("");
                }}
                className="text-blue-400 cursor-pointer"
              >
                Sign up
              </span>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <span
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
                className="text-blue-400 cursor-pointer"
              >
                Log in
              </span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
