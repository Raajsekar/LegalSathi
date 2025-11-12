import React from "react";
import { useAuthState } from "react-firebase-hooks/auth";
import { auth } from "./firebase";
import Login from "./pages/login";
import Chat from "./pages/chat";
import Loader from "./components/Loader";

export default function App() {
  const [user, loading] = useAuthState(auth);

  if (loading) return <Loader />;

  return user ? <Chat /> : <Login />;
}
