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
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const validatePassword = (pw) => {
    if (pw.length < 8) return "Password should be at least 8 characters.";
    if (!/[A-Z]/.test(pw)) return "Include at least 1 uppercase letter.";
    if (!/[0-9]/.test(pw)) return "Include at least 1 digit.";
    return null;
  };

  const google = async () => {
    try {
      setError(""); setLoading(true);
      await signInWithPopup(auth, provider);
    } catch (e) {
      setError(e.message || "Google sign-in failed.");
    } finally { setLoading(false); }
  };

  const doSignup = async () => {
    setError("");
    const pwErr = validatePassword(password);
    if (pwErr) return setError(pwErr);
    try {
      setLoading(true);
      const res = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(res.user, { displayName: name });
      await sendEmailVerification(res.user);
      setError("Verification email sent. Please verify to continue.");
    } catch (e) {
      setError(e.message || "Signup failed");
    } finally { setLoading(false); }
  };

  const doLogin = async () => {
    try {
      setLoading(true); setError("");
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setError(e.message || "Login failed");
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md bg-[#0f1720] border border-gray-800 p-8 rounded-2xl shadow-lg">
        <h2 className="text-2xl font-semibold text-white mb-4 text-center">⚖️ LegalSathi</h2>

        <div className="flex flex-col gap-3">
          <button onClick={google}
            className="w-full flex items-center justify-center gap-3 bg-white text-black py-2 rounded-md">
            Continue with Google
          </button>

          <div className="flex items-center gap-2 text-sm text-gray-400 my-2">
            <span className="flex-1 border-b border-gray-700" />
            <span>OR</span>
            <span className="flex-1 border-b border-gray-700" />
          </div>

          {mode === "signup" && (
            <input className="p-3 bg-[#071018] border border-gray-700 rounded text-white"
              placeholder="Full name" value={name} onChange={(e)=>setName(e.target.value)} />
          )}

          <input className="p-3 bg-[#071018] border border-gray-700 rounded text-white"
            placeholder="Email address" value={email} onChange={(e)=>setEmail(e.target.value)} />
          <input type="password" className="p-3 bg-[#071018] border border-gray-700 rounded text-white"
            placeholder="Password" value={password} onChange={(e)=>setPassword(e.target.value)} />

          {error && <div className="text-sm text-red-400">{error}</div>}

          {mode === "signup" ? (
            <button onClick={doSignup} disabled={loading}
              className="w-full bg-blue-600 py-2 rounded text-white">Create account</button>
          ) : (
            <button onClick={doLogin} disabled={loading}
              className="w-full bg-blue-600 py-2 rounded text-white">Continue</button>
          )}

          <div className="text-sm text-gray-400 text-center mt-2">
            {mode === "signup" ? (
              <>Already have an account? <button onClick={()=>{setMode("login"); setError("")}} className="text-blue-400">Log in</button></>
            ) : (
              <>Don't have an account? <button onClick={()=>{setMode("signup"); setError("")}} className="text-blue-400">Sign up</button></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
