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
  const [mode, setMode] = useState("login"); // "login" or "signup"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const validatePassword = (pw) => {
    if (pw.length < 8) return "Password must be at least 8 characters long.";
    if (!/[A-Z]/.test(pw)) return "Include at least 1 uppercase letter.";
    if (!/[0-9]/.test(pw)) return "Include at least 1 digit.";
    return null;
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      setError("Google sign-in failed. Please try again or check domain setup.");
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
      setError("✅ Verification email sent. Please verify before logging in.");
    } catch (err) {
      if (err.code === "auth/email-already-in-use")
        setError("Email already in use. Please log in.");
      else setError("Signup failed. Check your details.");
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
      if (err.code === "auth/invalid-credential")
        setError("Invalid email or password.");
      else setError("Login failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-b from-[#0b0b0d] to-[#111113] text-white">
      <div className="bg-[#151519] border border-gray-800 rounded-2xl p-8 w-[380px] shadow-2xl">
        <h1 className="text-3xl font-semibold text-center mb-2">⚖️ LegalSathi</h1>
        <p className="text-center text-gray-400 mb-6">
          AI legal assistant — login to continue
        </p>

        <div className="space-y-3">
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Full name"
              className="w-full p-3 bg-[#0e0e10] border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}

          <input
  type="email"
  placeholder="Email"
  className="w-full p-3 bg-[#0f0f12] border border-gray-700 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
  value={email}
  onChange={(e) => setEmail(e.target.value)}
/>

          <input
  type="password"
  placeholder="Password"
  className="w-full p-3 bg-[#0f0f12] border border-gray-700 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
  value={password}
  onChange={(e) => setPassword(e.target.value)}
/>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {mode === "signup" ? (
            <button
              onClick={handleSignup}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-medium"
            >
              {loading ? "Creating..." : "Create account"}
            </button>
          ) : (
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-medium"
            >
              {loading ? "Logging in..." : "Login"}
            </button>
          )}

          <button
            onClick={handleGoogleLogin}
            className="w-full bg-white text-black py-3 rounded-lg mt-2 font-medium hover:bg-gray-100"
          >
            Continue with Google
          </button>

          <p className="text-center text-gray-400 text-sm mt-3">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <span
                  className="text-blue-400 cursor-pointer"
                  onClick={() => {
                    setMode("login");
                    setError("");
                  }}
                >
                  Log in
                </span>
              </>
            ) : (
              <>
                Don’t have an account?{" "}
                <span
                  className="text-blue-400 cursor-pointer"
                  onClick={() => {
                    setMode("signup");
                    setError("");
                  }}
                >
                  Sign up
                </span>
              </>
            )}
          </p>
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          By continuing, you agree to our Terms & Privacy Policy.
        </p>
      </div>
    </div>
  );
}
