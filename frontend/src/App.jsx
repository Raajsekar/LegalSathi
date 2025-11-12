import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "./firebase";
import Login from "./pages/login";
import Chat from "./pages/chat";
import Loader from "./components/Loader";

export default function App() {
  const [user, loading] = useAuthState(auth);

  if (loading) return <Loader />;

  return (
    <Router>
      <Routes>
        <Route path="/" element={user ? <Chat /> : <Navigate to="/login" />} />
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
      </Routes>
    </Router>
  );
}
